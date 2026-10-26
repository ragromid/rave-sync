const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const db = require('./src/db');
const z01 = require('./src/z01');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.json({ limit: '2mb' }));

// Защита от индексации поисковиками и DMCA-ботами
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Active rooms in memory
// roomCode -> roomObject
const rooms = new Map();
// userId -> Set of socketIds
const userSockets = new Map();
// socketId -> { userId, roomCode }
const socketMeta = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function getEffectiveTime(playback) {
  if (!playback) return 0;
  if (!playback.playing) return playback.currentTime || 0;
  const elapsed = Math.max(0, (Date.now() - (playback.updatedAt || Date.now())) / 1000);
  return (playback.currentTime || 0) + elapsed * (playback.rate || 1);
}

function serializeRoom(room, brief = false) {
  if (!room) return null;
  const participants = Array.from(room.participants.values());
  const effectiveTime = getEffectiveTime(room.playback);
  const base = {
    code: room.code,
    name: room.name,
    isPublic: room.isPublic,
    hostId: room.hostId,
    hostOnlyControl: !!room.hostOnlyControl,
    createdAt: room.createdAt,
    participantCount: participants.length,
    participants,
    media: room.media,
    playback: {
      ...room.playback,
      currentTime: effectiveTime,
      serverTime: Date.now()
    }
  };
  if (brief) return base;
  return {
    ...base,
    messages: room.messages.slice(-80)
  };
}

function broadcastPublicRooms() {
  const list = [];
  for (const r of rooms.values()) {
    if (r.isPublic && r.participants.size > 0) {
      list.push(serializeRoom(r, true));
    }
  }
  list.sort((a, b) => b.participantCount - a.participantCount || b.createdAt - a.createdAt);
  io.emit('rooms:public_list', list);
}

function getUserPresence(userId) {
  const sockets = userSockets.get(userId);
  const online = !!(sockets && sockets.size > 0);
  let currentRoom = null;
  if (online) {
    for (const sid of sockets) {
      const meta = socketMeta.get(sid);
      if (meta && meta.roomCode && rooms.has(meta.roomCode)) {
        const r = rooms.get(meta.roomCode);
        currentRoom = {
          code: r.code,
          name: r.name,
          isPublic: r.isPublic,
          mediaTitle: r.media?.title || r.name,
          poster: r.media?.poster || ''
        };
        break;
      }
    }
  }
  return { online, currentRoom };
}

function notifyFriendsPresence(userId) {
  const data = db.getFriendsData(userId);
  for (const f of data.friends) {
    const fSockets = userSockets.get(f.id);
    if (fSockets) {
      for (const sid of fSockets) {
        io.to(sid).emit('friends:update');
      }
    }
  }
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  });
  return out;
}

function setAuthCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `ravelampa_token=${encodeURIComponent(token)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`
  );
}

function clearAuthCookie(res) {
  res.setHeader(
    'Set-Cookie',
    'ravelampa_token=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly'
  );
}

// Auth Middleware (reads Server HttpOnly Cookie or Bearer token)
function authMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (cookies.ravelampa_token || req.query.token || '');
  const payload = db.verifyToken(token);
  if (!payload || !payload.id) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const user = db.getUserById(payload.id);
  if (!user) {
    return res.status(401).json({ error: 'Пользователь не найден' });
  }
  req.user = user;
  req.token = token;
  next();
}

// ================= AUTH & PROFILE ROUTES =================

app.post('/api/auth/register', (req, res) => {
  try {
    const result = db.registerUser(req.body || {});
    setAuthCookie(res, result.token);
    res.json({
      ...result,
      bookmarks: db.getBookmarks(result.user.id),
      history: db.getWatchHistory(result.user.id),
      progress: db.getUserProgress(result.user.id)
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const result = db.loginUser(req.body || {});
    setAuthCookie(res, result.token);
    res.json({
      ...result,
      bookmarks: db.getBookmarks(result.user.id),
      history: db.getWatchHistory(result.user.id),
      progress: db.getUserProgress(result.user.id)
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({
    user: req.user,
    token: req.token,
    bookmarks: db.getBookmarks(req.user.id),
    history: db.getWatchHistory(req.user.id),
    progress: db.getUserProgress(req.user.id)
  });
});

app.put('/api/auth/profile', authMiddleware, (req, res) => {
  try {
    const { user: updated, token } = db.updateUserProfile(req.user.id, req.body || {});
    setAuthCookie(res, token);
    // Also update user info in any active room
    for (const r of rooms.values()) {
      for (const [sid, p] of r.participants.entries()) {
        if (p.id === req.user.id) {
          r.participants.set(sid, {
            ...p,
            displayName: updated.displayName,
            avatar: updated.avatar,
            avatarUrl: updated.avatarUrl || '',
            bio: updated.bio || '',
            color: updated.color
          });
          io.to(r.code).emit('room:participants', Array.from(r.participants.values()));
        }
      }
    }
    notifyFriendsPresence(req.user.id);
    res.json({ user: updated, token });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/users/search', authMiddleware, (req, res) => {
  const results = db.searchUsers(req.query.q || '', req.user.id);
  res.json({ users: results });
});

app.get('/api/users/:id', authMiddleware, (req, res) => {
  const u = db.getUserById(req.params.id);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user: u, presence: getUserPresence(u.id) });
});

// ================= FRIENDS & INVITES ROUTES =================

app.get('/api/friends', authMiddleware, (req, res) => {
  const data = db.getFriendsData(req.user.id);
  const friendsWithPresence = data.friends.map(f => ({
    ...f,
    ...getUserPresence(f.id)
  }));
  res.json({
    friends: friendsWithPresence,
    incoming: data.incoming,
    outgoing: data.outgoing
  });
});

app.post('/api/friends/request', authMiddleware, (req, res) => {
  try {
    const { target } = req.body || {};
    const result = db.sendFriendRequest(req.user.id, target);
    const targetSockets = userSockets.get(result.friend.id);
    if (targetSockets) {
      for (const sid of targetSockets) {
        io.to(sid).emit('friends:update');
        io.to(sid).emit('toast', {
          type: 'friend_request',
          text: `${req.user.avatar} ${req.user.displayName} отправил(а) заявку в друзья`
        });
      }
    }
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/friends/respond', authMiddleware, (req, res) => {
  try {
    const { requestId, accept } = req.body || {};
    const rel = db.respondFriendRequest(req.user.id, requestId, !!accept);
    const otherSockets = userSockets.get(rel.fromId);
    if (otherSockets) {
      for (const sid of otherSockets) {
        io.to(sid).emit('friends:update');
        if (accept) {
          io.to(sid).emit('toast', {
            type: 'friend_accepted',
            text: `${req.user.avatar} ${req.user.displayName} принял(а) заявку в друзья!`
          });
        }
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/friends/:friendId', authMiddleware, (req, res) => {
  db.removeFriend(req.user.id, req.params.friendId);
  const otherSockets = userSockets.get(req.params.friendId);
  if (otherSockets) {
    for (const sid of otherSockets) {
      io.to(sid).emit('friends:update');
    }
  }
  res.json({ ok: true });
});

app.get('/api/dms/:friendId', authMiddleware, (req, res) => {
  const friend = db.getUserById(req.params.friendId);
  if (!friend) return res.status(404).json({ error: 'Друг не найден' });
  const messages = db.getDirectMessages(req.user.id, friend.id);
  res.json({
    friend: {
      ...friend,
      ...getUserPresence(friend.id)
    },
    messages
  });
});

app.post('/api/dms/:friendId', authMiddleware, (req, res) => {
  try {
    const { text } = req.body || {};
    const msg = db.sendDirectMessage(req.user.id, req.params.friendId, text);
    // Emit to all sockets of recipient and sender
    for (const uid of [req.user.id, req.params.friendId]) {
      const sids = userSockets.get(uid);
      if (sids) {
        for (const sid of sids) {
          io.to(sid).emit('dm:message', msg);
        }
      }
    }
    res.json({ message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ================= BOOKMARKS & HISTORY ROUTES =================

app.get('/api/bookmarks', authMiddleware, (req, res) => {
  res.json({ bookmarks: db.getBookmarks(req.user.id) });
});

app.post('/api/bookmarks/toggle', authMiddleware, (req, res) => {
  const { movie } = req.body || {};
  if (!movie || !movie.id) return res.status(400).json({ error: 'Invalid movie' });
  const result = db.toggleBookmark(req.user.id, movie);
  res.json(result);
});

app.get('/api/history', authMiddleware, (req, res) => {
  res.json({ history: db.getWatchHistory(req.user.id) });
});

app.post('/api/history', authMiddleware, (req, res) => {
  const list = db.addWatchHistory(req.user.id, req.body || {});
  res.json({
    history: list,
    progress: db.getUserProgress(req.user.id)
  });
});

app.post('/api/user/progress', authMiddleware, (req, res) => {
  const entry = db.updatePlaybackProgress(req.user.id, req.body || {});
  res.json({ progress: entry });
});

// ================= ADMIN PANEL & USER MANAGEMENT ROUTES =================

const ADMIN_KEY = process.env.ADMIN_KEY || 'admin2026';

function setAdminCookie(res, key) {
  res.setHeader(
    'Set-Cookie',
    `ravelampa_admin_key=${encodeURIComponent(key)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`
  );
}

function adminMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const providedKey = req.headers['x-admin-key'] || cookies.ravelampa_admin_key || req.query.key || '';
  if (providedKey === ADMIN_KEY) {
    return next();
  }
  // Also allow logged-in users with isAdmin === true
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (cookies.ravelampa_token || '');
  const payload = db.verifyToken(token);
  if (payload && payload.id) {
    const allUsers = db.adminListUsers();
    const u = allUsers.find(x => x.id === payload.id);
    if (u && u.isAdmin) return next();
  }
  return res.status(403).json({ error: 'Неверный ключ администратора' });
}

app.get('/admin', (req, res) => {
  if (req.query.key === ADMIN_KEY) {
    setAdminCookie(res, ADMIN_KEY);
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/admin/login', (req, res) => {
  const { key } = req.body || {};
  if (String(key || '').trim() !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Неверный мастер-ключ администратора' });
  }
  setAdminCookie(res, ADMIN_KEY);
  res.json({ ok: true });
});

app.get('/api/admin/overview', adminMiddleware, (req, res) => {
  const users = db.adminListUsers().map(u => ({
    ...u,
    ...getUserPresence(u.id)
  }));
  const activeRooms = Array.from(rooms.values()).map(r => serializeRoom(r, true));
  res.json({
    users,
    rooms: activeRooms,
    stats: {
      totalUsers: users.length,
      onlineUsers: users.filter(u => u.online).length,
      activeRooms: activeRooms.length
    }
  });
});

app.post('/api/admin/users', adminMiddleware, (req, res) => {
  try {
    const { username, password, displayName, isAdmin } = req.body || {};
    const { user } = db.registerUser({ username, password, displayName });
    if (isAdmin) db.adminUpdateUser(user.id, { isAdmin: true });
    res.json({ user: db.getUserById(user.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/users/:id/password', adminMiddleware, (req, res) => {
  try {
    const { password } = req.body || {};
    const user = db.adminResetPassword(req.params.id, password);
    res.json({ ok: true, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/admin/users/:id', adminMiddleware, (req, res) => {
  try {
    const user = db.adminUpdateUser(req.params.id, req.body || {});
    res.json({ ok: true, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/users/:id/impersonate', adminMiddleware, (req, res) => {
  try {
    const { user, token } = db.adminImpersonateUser(req.params.id);
    setAuthCookie(res, token);
    res.json({ ok: true, user, token });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/admin/users/:id', adminMiddleware, (req, res) => {
  try {
    const userId = req.params.id;
    db.adminDeleteUser(userId);
    const sids = userSockets.get(userId);
    if (sids) {
      for (const sid of sids) {
        const s = io.sockets.sockets.get(sid);
        if (s) s.disconnect(true);
      }
      userSockets.delete(userId);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/admin/rooms/:code', adminMiddleware, (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (rooms.has(code)) {
    io.to(code).emit('toast', { text: 'Комната закрыта администратором' });
    rooms.delete(code);
    broadcastPublicRooms();
  }
  res.json({ ok: true });
});

// ================= CATALOG & Z01 STREAMING ROUTES =================

app.get('/api/catalog/feed', async (req, res) => {
  try {
    const { category = 'trending', page = 1 } = req.query;
    const data = await z01.getCatalogFeed(category, page);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Ошибка загрузки каталога' });
  }
});

app.get('/api/catalog/search', async (req, res) => {
  try {
    const { q = '', page = 1 } = req.query;
    const data = await z01.searchCatalog(q, page);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Ошибка поиска' });
  }
});

app.get('/api/catalog/details', async (req, res) => {
  try {
    const { id, type = 'movie' } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const card = await z01.getCatalogDetails(id, type);
    res.json({ movie: card });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Ошибка получения деталей' });
  }
});

app.post('/api/z01/sources', async (req, res) => {
  try {
    const { movie } = req.body || {};
    if (!movie) return res.status(400).json({ error: 'Missing movie object' });
    const data = await z01.getZ01Sources(movie);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Не удалось получить источники Z01' });
  }
});

app.post('/api/z01/balancer', async (req, res) => {
  try {
    const { url, movie, uid } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Missing balancer url' });
    const data = await z01.queryZ01Balancer({ url, movie, uid });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Ошибка опроса балансера' });
  }
});

function buildProxyStreamUrl(rawUrl, headers) {
  if (!rawUrl) return '';
  const q = new URLSearchParams();
  q.set('url', rawUrl);
  if (headers && Object.keys(headers).length > 0) {
    q.set('headers', JSON.stringify(headers));
  }
  return `/api/stream-proxy?${q.toString()}`;
}

app.post('/api/z01/resolve', async (req, res) => {
  try {
    const resolved = await z01.resolveZ01Stream(req.body || {});
    const proxyUrl = buildProxyStreamUrl(resolved.url, resolved.headers);
    const proxiedQualities = {};
    for (const [qk, qv] of Object.entries(resolved.qualities || {})) {
      proxiedQualities[qk] = {
        raw: qv,
        proxy: buildProxyStreamUrl(qv, resolved.headers)
      };
    }
    const needsProxy =
      (resolved.headers && Object.keys(resolved.headers).length > 0) ||
      /srcIp=|werkecdn|rstprgapipt|okcdn|vkvd|geosaitebi|^http:\/\//i.test(resolved.url || '');
    res.json({
      ...resolved,
      proxyUrl,
      proxiedQualities,
      recommendedUrl: needsProxy ? proxyUrl : resolved.url
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Не удалось извлечь видеопоток' });
  }
});

// Smart HLS (.m3u8) & MP4 Range Stream Proxy for balancers that need custom Origin/Referer/CORS
app.get('/api/stream-proxy', async (req, res) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return res.status(400).send('Invalid stream URL');
    }

    let customHeaders = {};
    if (req.query.headers) {
      try {
        customHeaders = JSON.parse(req.query.headers);
      } catch {}
    }

    const fetchHeaders = {
      'User-Agent': customHeaders['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': '*/*'
    };

    for (const [k, v] of Object.entries(customHeaders)) {
      if (v && typeof v === 'string') fetchHeaders[k] = v;
    }

    if (req.headers.range) {
      fetchHeaders['Range'] = req.headers.range;
    }

    const upstream = await fetch(targetUrl, {
      headers: fetchHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(25000)
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    const contentType = upstream.headers.get('content-type') || '';
    const finalTargetUrl = upstream.url || targetUrl;

    // Check if this is an HLS M3U8 playlist
    const isM3u8 =
      /mpegurl|m3u8/i.test(contentType) ||
      /\.m3u8(\?|$)/i.test(finalTargetUrl);

    if (isM3u8) {
      const text = await upstream.text();
      if (text.trim().startsWith('#EXTM3U')) {
        const baseUrl = new URL(finalTargetUrl);
        const headersParam = req.query.headers ? `&headers=${encodeURIComponent(req.query.headers)}` : '';

        const resolveAndWrap = (uri) => {
          try {
            const abs = new URL(uri.trim(), baseUrl).toString();
            return `/api/stream-proxy?url=${encodeURIComponent(abs)}${headersParam}`;
          } catch {
            return uri;
          }
        };

        const rewritten = text
          .split(/\r?\n/)
          .map(line => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (trimmed.startsWith('#')) {
              // Rewrite URI="..." inside #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA
              return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${resolveAndWrap(u)}"`);
            }
            return resolveAndWrap(trimmed);
          })
          .join('\n');

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        return res.status(200).send(rewritten);
      }
    }

    // Binary stream (MP4, TS segment, AAC, WebVTT, etc.)
    res.status(upstream.status);
    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of forwardHeaders) {
      const val = upstream.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.writableEnded) {
            res.write(Buffer.from(value));
          } else {
            break;
          }
        }
        if (!res.writableEnded) res.end();
      } catch {
        if (!res.writableEnded) res.end();
      }
    };
    req.on('close', () => {
      try { reader.cancel(); } catch {}
    });
    pump();
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).send('Stream proxy error: ' + e.message);
    }
  }
});

// ================= ROOMS REST API =================

app.get('/api/rooms', (req, res) => {
  const list = [];
  for (const r of rooms.values()) {
    if (r.isPublic && r.participants.size > 0) {
      list.push(serializeRoom(r, true));
    }
  }
  list.sort((a, b) => b.participantCount - a.participantCount || b.createdAt - a.createdAt);
  res.json({ rooms: list });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Комната не найдена' });
  res.json({ room: serializeRoom(room, false) });
});

app.post('/api/rooms', authMiddleware, (req, res) => {
  const { name, isPublic = true, hostOnlyControl = false, media = null } = req.body || {};
  const code = generateRoomCode();
  const room = {
    code,
    name: String(name || (media && media.title) || `Комната ${req.user.displayName}`).trim().slice(0, 60),
    isPublic: !!isPublic,
    hostId: req.user.id,
    hostOnlyControl: !!hostOnlyControl,
    createdAt: Date.now(),
    participants: new Map(), // socketId -> userObj
    media: media || null,
    playback: {
      playing: false,
      currentTime: 0,
      rate: 1,
      updatedAt: Date.now()
    },
    messages: []
  };
  rooms.set(code, room);
  db.incrementUserStat(req.user.id, 'roomsCreated', 1);
  res.json({ room: serializeRoom(room, false) });
});

// ================= SOCKET.IO REAL-TIME ENGINE =================

io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('auth:identify', ({ token }) => {
    const payload = db.verifyToken(token);
    if (!payload || !payload.id) return;
    const user = db.getUserById(payload.id);
    if (!user) return;
    currentUser = user;
    socketMeta.set(socket.id, { userId: user.id, roomCode: null });

    if (!userSockets.has(user.id)) userSockets.set(user.id, new Set());
    userSockets.get(user.id).add(socket.id);

    notifyFriendsPresence(user.id);
  });

  function leaveCurrentRoom() {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode) return;
    const code = meta.roomCode;
    meta.roomCode = null;
    socket.leave(code);

    const room = rooms.get(code);
    if (!room) return;

    const departing = room.participants.get(socket.id);
    room.participants.delete(socket.id);

    if (departing) {
      socket.to(code).emit('voice:peer_left', { socketId: socket.id });
    }

    if (room.participants.size === 0) {
      // Keep room for 2 minutes in case of page refresh, then clean up
      setTimeout(() => {
        const r = rooms.get(code);
        if (r && r.participants.size === 0) {
          rooms.delete(code);
          broadcastPublicRooms();
        }
      }, 120000);
    } else {
      // If host left, assign next participant as host
      const remaining = Array.from(room.participants.values());
      if (!remaining.some(p => p.id === room.hostId)) {
        room.hostId = remaining[0].id;
        addSystemMessage(room, `${remaining[0].displayName} теперь хост комнаты`);
      }
      io.to(code).emit('room:state', serializeRoom(room, false));
    }

    broadcastPublicRooms();
    if (currentUser) notifyFriendsPresence(currentUser.id);
  }

  function addSystemMessage(room, text) {
    const msg = {
      id: 'm_' + crypto.randomBytes(4).toString('hex'),
      system: true,
      text,
      createdAt: Date.now()
    };
    room.messages.push(msg);
    if (room.messages.length > 100) room.messages.shift();
    io.to(room.code).emit('chat:message', msg);
  }

  socket.on('room:join', ({ code, token }) => {
    if (!currentUser && token) {
      const payload = db.verifyToken(token);
      if (payload && payload.id) currentUser = db.getUserById(payload.id);
    }
    if (!currentUser) {
      return socket.emit('room:error', { error: 'Войдите в аккаунт для входа в комнату' });
    }

    const cleanCode = String(code || '').trim().toUpperCase();
    let room = rooms.get(cleanCode);
    if (!room) {
      return socket.emit('room:error', { error: 'Комната не найдена или уже закрыта' });
    }

    leaveCurrentRoom();

    socket.join(cleanCode);
    socketMeta.set(socket.id, { userId: currentUser.id, roomCode: cleanCode });

    room.participants.set(socket.id, {
      socketId: socket.id,
      id: currentUser.id,
      username: currentUser.username,
      displayName: currentUser.displayName,
      avatar: currentUser.avatar,
      avatarUrl: currentUser.avatarUrl || '',
      bio: currentUser.bio || '',
      color: currentUser.color,
      inVoice: false,
      muted: false
    });

    socket.emit('room:joined', serializeRoom(room, false));
    io.to(cleanCode).emit('room:participants', Array.from(room.participants.values()));
    addSystemMessage(room, `${currentUser.avatar} ${currentUser.displayName} в комнате`);

    broadcastPublicRooms();
    notifyFriendsPresence(currentUser.id);
  });

  socket.on('room:leave', () => {
    leaveCurrentRoom();
  });

  // Synchronized playback (Play, Pause, Seek, Rate)
  socket.on('player:sync', ({ action, currentTime, playing, rate }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;

    if (room.hostOnlyControl && room.hostId !== currentUser.id) {
      // Send current room playback back to non-host to resync them
      return socket.emit('player:sync', {
        ...room.playback,
        currentTime: getEffectiveTime(room.playback),
        serverTime: Date.now(),
        actor: null
      });
    }

    const effectiveNow = getEffectiveTime(room.playback);

    // Prevent a newly joined or unmuting device at 0:00 from resetting a room that is already playing past 5s
    if (action === 'play' && typeof currentTime === 'number' && currentTime < 2 && effectiveNow > 5 && room.playback.playing) {
      return socket.emit('player:sync', {
        ...room.playback,
        currentTime: effectiveNow,
        serverTime: Date.now(),
        action: 'resync'
      });
    }

    room.playback = {
      playing: typeof playing === 'boolean' ? playing : room.playback.playing,
      currentTime: typeof currentTime === 'number' && !isNaN(currentTime) ? Math.max(0, currentTime) : effectiveNow,
      rate: typeof rate === 'number' ? rate : (room.playback.rate || 1),
      updatedAt: Date.now()
    };

    socket.to(room.code).emit('player:sync', {
      ...room.playback,
      action: action || 'sync',
      serverTime: Date.now(),
      actor: {
        id: currentUser.id,
        displayName: currentUser.displayName,
        avatar: currentUser.avatar
      }
    });
  });

  // Continuous heartbeat from host / active player to keep all devices tightly in sync
  socket.on('player:heartbeat', ({ currentTime, playing, rate }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;

    // Only accept authoritative heartbeat from host (or anyone if host isn't in room)
    if (room.hostId !== currentUser.id) return;
    if (typeof currentTime !== 'number' || isNaN(currentTime)) return;

    room.playback = {
      playing: typeof playing === 'boolean' ? playing : room.playback.playing,
      currentTime: Math.max(0, currentTime),
      rate: typeof rate === 'number' ? rate : (room.playback.rate || 1),
      updatedAt: Date.now()
    };

    socket.to(room.code).emit('player:heartbeat', {
      ...room.playback,
      serverTime: Date.now()
    });
  });

  socket.on('player:request_sync', () => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;
    socket.emit('player:sync', {
      ...room.playback,
      currentTime: getEffectiveTime(room.playback),
      serverTime: Date.now(),
      action: 'resync'
    });
  });

  // Change media / Z01 balancer / voice / episode / custom link in room
  socket.on('room:set_media', ({ media }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;

    if (room.hostOnlyControl && room.hostId !== currentUser.id) {
      return socket.emit('toast', { type: 'warn', text: 'Только хост может менять видео в этой комнате' });
    }

    room.media = media;
    if (media && media.title && room.name.startsWith('Комната ')) {
      room.name = media.title;
    }
    room.playback = {
      playing: true,
      currentTime: 0,
      rate: 1,
      updatedAt: Date.now()
    };

    const epTag = media?.season && media?.episode ? ` (S${media.season}E${media.episode})` : '';
    const voiceTag = media?.voiceName ? ` · ${media.voiceName}` : '';
    addSystemMessage(room, `🎬 ${currentUser.displayName} включил(а): ${media?.title || 'Видео'}${epTag}${voiceTag}`);

    io.to(room.code).emit('room:media_changed', {
      media: room.media,
      playback: {
        ...room.playback,
        serverTime: Date.now()
      }
    });

    broadcastPublicRooms();
    notifyFriendsPresence(currentUser.id);
  });

  // Room settings update (public/private, hostOnlyControl, room name)
  socket.on('room:settings', ({ isPublic, hostOnlyControl, name }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room || room.hostId !== currentUser.id) return;

    if (typeof isPublic === 'boolean') room.isPublic = isPublic;
    if (typeof hostOnlyControl === 'boolean') room.hostOnlyControl = hostOnlyControl;
    if (typeof name === 'string' && name.trim()) room.name = name.trim().slice(0, 60);

    io.to(room.code).emit('room:state', serializeRoom(room, false));
    broadcastPublicRooms();
  });

  // Chat messages
  socket.on('chat:send', ({ text }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;

    const clean = String(text || '').trim().slice(0, 500);
    if (!clean) return;

    const msg = {
      id: 'm_' + crypto.randomBytes(4).toString('hex'),
      system: false,
      user: {
        id: currentUser.id,
        displayName: currentUser.displayName,
        avatar: currentUser.avatar,
        avatarUrl: currentUser.avatarUrl || '',
        color: currentUser.color
      },
      text: clean,
      createdAt: Date.now()
    };
    db.incrementUserStat(currentUser.id, 'messagesSent', 1);
    room.messages.push(msg);
    if (room.messages.length > 100) room.messages.shift();
    io.to(room.code).emit('chat:message', msg);
  });

  // Floating emoji reactions over the video player
  socket.on('room:reaction', ({ emoji }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;

    db.incrementUserStat(currentUser.id, 'reactionsSent', 1);
    io.to(room.code).emit('room:reaction', {
      id: 'rx_' + crypto.randomBytes(3).toString('hex'),
      emoji: String(emoji || '🔥').slice(0, 8),
      user: {
        id: currentUser.id,
        displayName: currentUser.displayName,
        avatar: currentUser.avatar
      }
    });
  });

  // Invite friend to room
  socket.on('room:invite', ({ friendId }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;

    const targetSockets = userSockets.get(friendId);
    if (!targetSockets || targetSockets.size === 0) {
      return socket.emit('toast', { type: 'info', text: 'Друг сейчас не в сети' });
    }

    for (const sid of targetSockets) {
      io.to(sid).emit('room:invite_received', {
        from: {
          id: currentUser.id,
          displayName: currentUser.displayName,
          avatar: currentUser.avatar
        },
        room: {
          code: room.code,
          name: room.name,
          mediaTitle: room.media?.title || room.name,
          poster: room.media?.poster || ''
        }
      });
    }
    socket.emit('toast', { type: 'success', text: 'Приглашение отправлено!' });
  });

  // Direct Messages (Friends Private Chat)
  socket.on('dm:send', ({ toId, text }) => {
    if (!currentUser || !toId) return;
    try {
      const msg = db.sendDirectMessage(currentUser.id, toId, text);
      for (const uid of [currentUser.id, toId]) {
        const sids = userSockets.get(uid);
        if (sids) {
          for (const sid of sids) {
            io.to(sid).emit('dm:message', msg);
          }
        }
      }
    } catch (e) {
      socket.emit('toast', { type: 'error', text: e.message });
    }
  });

  socket.on('dm:read', ({ friendId }) => {
    if (!currentUser || !friendId) return;
    db.markDirectMessagesRead(currentUser.id, friendId);
  });

  // WebRTC Voice Chat signaling inside room
  socket.on('voice:toggle', ({ active, muted }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;
    const p = room.participants.get(socket.id);
    if (!p) return;

    const wasInVoice = p.inVoice;
    p.inVoice = !!active;
    p.muted = !!muted;
    room.participants.set(socket.id, p);

    io.to(room.code).emit('room:participants', Array.from(room.participants.values()));

    if (!wasInVoice && p.inVoice) {
      socket.to(room.code).emit('voice:peer_joined', { socketId: socket.id, user: p });
    } else if (wasInVoice && !p.inVoice) {
      socket.to(room.code).emit('voice:peer_left', { socketId: socket.id });
    }
  });

  socket.on('voice:signal', ({ toSocketId, data }) => {
    io.to(toSocketId).emit('voice:signal', {
      fromSocketId: socket.id,
      data
    });
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom();
    if (currentUser && userSockets.has(currentUser.id)) {
      const set = userSockets.get(currentUser.id);
      set.delete(socket.id);
      if (set.size === 0) userSockets.delete(currentUser.id);
      notifyFriendsPresence(currentUser.id);
    }
    socketMeta.delete(socket.id);
  });
});

// Healthcheck endpoint for Render.com
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Keep-alive on Render while there are active rooms so the instance doesn't sleep mid-movie
setInterval(() => {
  let activeUsers = 0;
  for (const r of rooms.values()) activeUsers += r.participants.size;
  if (activeUsers > 0 && process.env.RENDER_EXTERNAL_URL) {
    fetch(`${process.env.RENDER_EXTERNAL_URL}/healthz`).catch(() => {});
  }
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
db.initCloudDb().finally(() => {
  server.listen(PORT, () => {
    console.log(`Rave x Lampa (Z01) server running at http://localhost:${PORT}`);
  });
});
