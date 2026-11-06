const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const db = require('./src/db');
const z01 = require('./src/z01');
const webPush = require('./src/push');

async function sendPushToUser(userId, payload) {
  if (!userId || !payload) return;
  const subs = db.getUserPushSubscriptions(userId);
  if (!subs || subs.length === 0) return;
  await Promise.all(subs.map(async (sub) => {
    const res = await webPush.sendWebPush(sub, payload);
    if (res.status === 404 || res.status === 410) {
      db.removeUserPushSubscription(userId, sub.endpoint);
    }
  }));
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.json({ limit: '5mb' }));

// Canonical Domain Redirect (redirect raw IP to rave-sync.duckdns.org)
const CANONICAL_DOMAIN = process.env.CANONICAL_DOMAIN || 'rave-sync.duckdns.org';
app.use((req, res, next) => {
  const rawHost = String(req.headers.host || '').trim().toLowerCase();
  const hostname = rawHost.split(':')[0];
  const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname === '130.61.47.155';
  if (isIp && hostname !== '127.0.0.1' && hostname !== 'localhost') {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    return res.redirect(301, `${protocol}://${CANONICAL_DOMAIN}${req.originalUrl}`);
  }
  next();
});

// Защита от индексации поисковиками и DMCA-ботами
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // Always revalidate HTML/JS/CSS so phones & TVs never run a stale app version
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// Active rooms in memory (also persisted to DB for Vercel Serverless compatibility)
// roomCode -> roomObject
const rooms = new Map();
// userId -> Set of socketIds
const userSockets = new Map();
// socketId -> { userId, roomCode }
const socketMeta = new Map();
// HTTP presence map for serverless / polling clients: userId -> { lastSeen, roomCode }
const httpPresence = new Map();

function persistRoomsToDb(immediate = true) {
  const out = {};
  for (const [code, r] of rooms.entries()) {
    out[code] = {
      code: r.code,
      name: r.name,
      isPublic: r.isPublic,
      creatorId: r.creatorId || r.hostId,
      hostId: r.hostId,
      hostOnlyControl: !!r.hostOnlyControl,
      createdAt: r.createdAt,
      participants: Array.from(r.participants.values()).map(p => ({
        socketId: p.socketId,
        id: p.id,
        username: p.username,
        displayName: p.displayName,
        avatar: p.avatar,
        color: p.color,
        inVoice: !!p.inVoice,
        muted: !!p.muted
      })),
      media: r.media,
      playback: r.playback,
      messages: (r.messages || []).slice(-30).map(m => ({
        id: m.id,
        system: !!m.system,
        user: m.user ? {
          id: m.user.id,
          displayName: m.user.displayName,
          avatar: m.user.avatar,
          color: m.user.color
        } : null,
        text: m.text,
        hasPhoto: !!m.hasPhoto,
        imageUrl: (m.imageUrl && !m.imageUrl.startsWith('data:')) ? m.imageUrl : '',
        createdAt: m.createdAt,
        reactions: m.reactions || {}
      })),
      viewOnceStore: r.viewOnceStore || {}
    };
  }
  db.saveRoomsSnapshot(out, immediate);
}

function hydrateRoomsFromDb() {
  const saved = db.getSavedRoomsSnapshot();
  for (const [code, sr] of Object.entries(saved)) {
    if (!sr || !sr.code) continue;
    if (!rooms.has(code)) {
      const pMap = new Map();
      if (Array.isArray(sr.participants)) {
        sr.participants.forEach(p => {
          if (p && (p.socketId || p.id)) pMap.set(p.socketId || `http_${p.id}`, p);
        });
      }
      rooms.set(code, {
        code: sr.code,
        name: sr.name || 'Комната',
        isPublic: sr.isPublic !== false,
        creatorId: sr.creatorId || sr.hostId,
        hostId: sr.hostId,
        hostOnlyControl: !!sr.hostOnlyControl,
        createdAt: sr.createdAt || Date.now(),
        participants: pMap,
        media: sr.media || null,
        playback: sr.playback || { playing: false, currentTime: 0, rate: 1, updatedAt: Date.now() },
        messages: Array.isArray(sr.messages) ? sr.messages : [],
        viewOnceStore: sr.viewOnceStore || {}
      });
    } else {
      // Merge newer messages and playback state from Cloud DB into warm in-memory room
      const existing = rooms.get(code);
      if (Array.isArray(sr.messages) && sr.messages.length > 0) {
        const msgMap = new Map();
        for (const m of (existing.messages || [])) {
          if (m && m.id) msgMap.set(m.id, m);
        }
        for (const m of sr.messages) {
          if (m && m.id) msgMap.set(m.id, m);
        }
        existing.messages = Array.from(msgMap.values())
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
          .slice(-80);
      }
      if (sr.playback && (sr.playback.updatedAt || 0) > (existing.playback?.updatedAt || 0)) {
        existing.playback = sr.playback;
        if (sr.media) existing.media = sr.media;
      }
      if (Array.isArray(sr.participants)) {
        for (const p of sr.participants) {
          if (p && p.id && !Array.from(existing.participants.values()).some(ep => ep.id === p.id)) {
            existing.participants.set(p.socketId || `http_${p.id}`, p);
          }
        }
      }
    }
  }
}

// Middleware to ensure Cloud DB is loaded before DB-backed API requests (crucial on Vercel Serverless cold starts)
app.use(async (req, res, next) => {
  const p = req.path || '';
  const isStatelessMediaRoute = p.startsWith('/api/catalog') || p.startsWith('/api/z01') || p.startsWith('/api/stream');
  if (!isStatelessMediaRoute && (p.startsWith('/api/') || p === '/admin')) {
    await db.ensureCloudLoaded();
    hydrateRoomsFromDb();
  }
  next();
});

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
    messages: (room.messages || []).slice(-80).map(m => ({
      ...m,
      imageUrl: m.viewOnce ? '' : (m.imageUrl || '')
    }))
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
  const hasSocket = !!(sockets && sockets.size > 0);
  const online = hasSocket || db.isUserRecentlyActive(userId, 45000);
  let currentRoom = null;
  if (hasSocket) {
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
  if (!currentRoom) {
    for (const r of rooms.values()) {
      for (const p of r.participants.values()) {
        if (p.id === userId) {
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
      if (currentRoom) break;
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
  db.touchUserOnline(user.id);
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

// Fast 1-click Guest login (for Smart TV & immediate watch party)
app.post('/api/auth/guest', (req, res) => {
  try {
    hydrateRoomsFromDb();
    const guestNum = Math.floor(1000 + Math.random() * 9000);
    const guestUser = 'guest_' + crypto.randomBytes(3).toString('hex');
    const guestPass = crypto.randomBytes(8).toString('hex');
    const result = db.registerUser({
      username: guestUser,
      password: guestPass,
      displayName: `Гость #${guestNum}`,
      avatar: '🦊',
      color: '#7c5cff'
    });
    setAuthCookie(res, result.token);
    res.json({
      ...result,
      bookmarks: [],
      history: [],
      progress: {}
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Ошибка гостевого входа' });
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

// ================= WEB PUSH (VAPID) ROUTES =================

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: webPush.vapidPublicKey });
});

app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
  const { subscription } = req.body || {};
  const ok = db.saveUserPushSubscription(req.user.id, subscription);
  if (ok && process.env.VERCEL) await db.flushCloudDb();
  res.json({ ok });
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
    outgoing: data.outgoing,
    notifications: db.popUserNotifications(req.user.id)
  });
});

app.post('/api/friends/request', authMiddleware, async (req, res) => {
  try {
    const { target } = req.body || {};
    const result = db.sendFriendRequest(req.user.id, target);
    const targetSockets = userSockets.get(result.friend.id);
    if (targetSockets && targetSockets.size > 0) {
      for (const sid of targetSockets) {
        io.to(sid).emit('friends:update');
        io.to(sid).emit('toast', {
          type: 'friend_request',
          text: `${req.user.avatar} ${req.user.displayName} отправил(а) заявку в друзья`
        });
      }
    } else {
      db.pushUserNotification(result.friend.id, {
        type: 'friend_request',
        title: 'Заявка в друзья',
        body: `${req.user.avatar} ${req.user.displayName} хочет добавить вас в друзья`
      });
    }
    await Promise.all([
      sendPushToUser(result.friend.id, {
        title: 'Новая заявка в друзья 👋',
        body: `${req.user.avatar} ${req.user.displayName} (@${req.user.username}) хочет добавить вас в друзья`,
        tag: 'freq-' + (result.request?.id || Date.now()),
        data: { view: 'friends' }
      }),
      process.env.VERCEL ? db.flushCloudDb() : Promise.resolve()
    ]);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/friends/respond', authMiddleware, async (req, res) => {
  try {
    const { requestId, accept } = req.body || {};
    const rel = db.respondFriendRequest(req.user.id, requestId, !!accept);
    const otherSockets = userSockets.get(rel.fromId);
    if (otherSockets && otherSockets.size > 0) {
      for (const sid of otherSockets) {
        io.to(sid).emit('friends:update');
        if (accept) {
          io.to(sid).emit('toast', {
            type: 'friend_accepted',
            text: `${req.user.avatar} ${req.user.displayName} принял(а) заявку в друзья!`
          });
        }
      }
    } else if (accept) {
      db.pushUserNotification(rel.fromId, {
        type: 'friend_accepted',
        title: 'Новый друг!',
        body: `${req.user.avatar} ${req.user.displayName} принял(а) вашу заявку в друзья`
      });
    }
    await Promise.all([
      accept ? sendPushToUser(rel.fromId, {
        title: 'Новый друг! 🎉',
        body: `${req.user.avatar} ${req.user.displayName} принял(а) вашу заявку в друзья`,
        tag: 'facc-' + Date.now(),
        data: { view: 'friends' }
      }) : Promise.resolve(),
      process.env.VERCEL ? db.flushCloudDb() : Promise.resolve()
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/friends/:friendId', authMiddleware, async (req, res) => {
  db.removeFriend(req.user.id, req.params.friendId);
  const otherSockets = userSockets.get(req.params.friendId);
  if (otherSockets) {
    for (const sid of otherSockets) {
      io.to(sid).emit('friends:update');
    }
  }
  if (process.env.VERCEL) await db.flushCloudDb();
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

app.post('/api/dms/:friendId', authMiddleware, async (req, res) => {
  try {
    const msg = db.sendDirectMessage(req.user.id, req.params.friendId, req.body || {});
    // Emit to all sockets of recipient and sender
    for (const uid of [req.user.id, req.params.friendId]) {
      const sids = userSockets.get(uid);
      if (sids) {
        for (const sid of sids) {
          io.to(sid).emit('dm:message', msg);
        }
      }
    }
    const preview = msg.text || (msg.viewOnce ? '💣 Одноразовое фото' : (msg.hasImage ? '📷 Фотография' : 'Новое сообщение'));
    const targetSockets = userSockets.get(req.params.friendId);
    if (!targetSockets || targetSockets.size === 0) {
      db.pushUserNotification(req.params.friendId, {
        type: 'dm_message',
        msgId: msg.id,
        fromId: req.user.id,
        from: msg.sender,
        title: msg.sender?.displayName || req.user.displayName,
        body: preview
      });
    }
    // Fire real-time Web Push (<200ms) + Cloud DB flush in parallel
    await Promise.all([
      sendPushToUser(req.params.friendId, {
        type: 'dm_message',
        title: msg.sender?.displayName || req.user.displayName,
        body: preview,
        tag: 'dm-msg-' + msg.id,
        data: { friendId: req.user.id },
        msg: {
          ...msg,
          imageUrl: '', // keep push payload under 4KB limit
          sender: {
            id: req.user.id,
            username: req.user.username,
            displayName: req.user.displayName,
            avatar: req.user.avatar,
            color: req.user.color
          }
        }
      }),
      process.env.VERCEL ? db.flushCloudDb() : Promise.resolve()
    ]);
    res.json({ message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/dms/:friendId/react', authMiddleware, async (req, res) => {
  try {
    const { messageId, emoji } = req.body || {};
    const msg = db.toggleDmReaction(req.user.id, req.params.friendId, messageId, emoji);
    for (const uid of [req.user.id, req.params.friendId]) {
      const sids = userSockets.get(uid);
      if (sids) {
        for (const sid of sids) {
          io.to(sid).emit('dm:updated', msg);
        }
      }
    }
    if (process.env.VERCEL) await db.flushCloudDb();
    res.json({ message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/dms/:friendId/view-once', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.body || {};
    const result = db.consumeDmViewOnce(req.user.id, req.params.friendId, messageId);
    for (const uid of [req.user.id, req.params.friendId]) {
      const sids = userSockets.get(uid);
      if (sids) {
        for (const sid of sids) {
          if (result.message) io.to(sid).emit('dm:updated', result.message);
        }
      }
    }
    if (process.env.VERCEL) await db.flushCloudDb();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/dms/:friendId/:messageId', authMiddleware, async (req, res) => {
  try {
    const msg = db.editDirectMessage(req.user.id, req.params.friendId, req.params.messageId, req.body?.text);
    for (const uid of [req.user.id, req.params.friendId]) {
      const sids = userSockets.get(uid);
      if (sids) {
        for (const sid of sids) {
          io.to(sid).emit('dm:updated', msg);
        }
      }
    }
    if (process.env.VERCEL) await db.flushCloudDb();
    res.json({ message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/dms/:friendId/:messageId', authMiddleware, async (req, res) => {
  try {
    const result = db.deleteDirectMessage(req.user.id, req.params.friendId, req.params.messageId);
    for (const uid of [req.user.id, req.params.friendId]) {
      const sids = userSockets.get(uid);
      if (sids) {
        for (const sid of sids) {
          io.to(sid).emit('dm:deleted', result);
        }
      }
    }
    if (process.env.VERCEL) await db.flushCloudDb();
    res.json(result);
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
  const code = String(req.params.code || '').replace(/^#/, '').trim().toUpperCase();
  hydrateRoomsFromDb();
  const room = rooms.get(code);

  const reason = 'Комната закрыта администратором';

  // 1. Notify room channel directly
  io.to(code).emit('room:closed', { code, reason });
  io.to(code).emit('room:kicked', { code, reason });
  io.to(code).emit('room:evicted', { code, reason });
  io.to(code).emit('toast', { text: reason });

  // 2. Global broadcast to catch any clients whose socket adapter got desynced
  io.emit('room:closed', { code, reason });
  io.emit('room:kicked', { code, reason });
  io.emit('room:evicted', { code, reason });

  if (room) {
    if (room._cleanupTimer) clearTimeout(room._cleanupTimer);
    if (room._hostTransferTimer) clearTimeout(room._hostTransferTimer);
    const sids = io.sockets.adapter.rooms.get(code);
    if (sids) {
      for (const sid of Array.from(sids)) {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.emit('room:closed', { code, reason });
          s.emit('room:kicked', { code, reason });
          s.emit('room:evicted', { code, reason });
          try { s.leave(code); } catch {}
          socketMeta.delete(sid);
        }
      }
    }
    rooms.delete(code);
  }
  db.deleteSavedRoom(code);
  persistRoomsToDb(true);
  broadcastPublicRooms();
  res.json({ ok: true, code });
});

app.delete('/api/admin/rooms', adminMiddleware, (req, res) => {
  hydrateRoomsFromDb();
  const reason = 'Все комнаты закрыты администратором';
  io.emit('room:closed', { reason });
  io.emit('room:kicked', { reason });
  io.emit('room:evicted', { reason });
  io.emit('toast', { text: reason });

  for (const [code, room] of Array.from(rooms.entries())) {
    if (room._cleanupTimer) clearTimeout(room._cleanupTimer);
    if (room._hostTransferTimer) clearTimeout(room._hostTransferTimer);
    io.to(code).emit('room:closed', { code, reason });
    io.to(code).emit('room:kicked', { code, reason });
    io.to(code).emit('room:evicted', { code, reason });
    const sids = io.sockets.adapter.rooms.get(code);
    if (sids) {
      for (const sid of Array.from(sids)) {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.emit('room:closed', { code, reason });
          s.emit('room:kicked', { code, reason });
          s.emit('room:evicted', { code, reason });
          try { s.leave(code); } catch {}
        }
      }
    }
    rooms.delete(code);
    db.deleteSavedRoom(code);
  }
  persistRoomsToDb(true);
  broadcastPublicRooms();
  res.json({ ok: true, message: 'Все комнаты закрыты' });
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
    if (/\.(ts|m4s|mp4|aac|vtt)(\?|$)/i.test(finalTargetUrl)) {
      res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
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

// ================= ROOMS REST API & SERVERLESS SYNC =================

function createRoomChatMessage(room, user, payload = {}) {
  const raw = typeof payload === 'string' ? { text: payload } : (payload || {});
  const text = String(raw.text || '').trim().slice(0, 800);
  const imageUrl = String(raw.imageUrl || '').trim();
  const viewOnce = !!raw.viewOnce && !!imageUrl;

  if (!text && !imageUrl) {
    throw new Error('Сообщение не может быть пустым');
  }
  if (imageUrl && imageUrl.length > 2500000) {
    throw new Error('Фото слишком большое');
  }

  let replyTo = null;
  if (raw.replyTo && raw.replyTo.id) {
    replyTo = {
      id: String(raw.replyTo.id),
      senderName: String(raw.replyTo.senderName || 'Участник').slice(0, 40),
      text: String(raw.replyTo.text || (raw.replyTo.hasPhoto ? '📷 Фото' : '')).slice(0, 120),
      hasPhoto: !!raw.replyTo.hasPhoto
    };
  }

  const msgId = 'm_' + crypto.randomBytes(5).toString('hex');
  if (!room.viewOnceStore) room.viewOnceStore = {};
  if (viewOnce) {
    room.viewOnceStore[msgId] = imageUrl;
  }

  const msg = {
    id: msgId,
    system: false,
    user: {
      id: user.id,
      displayName: user.displayName,
      avatar: user.avatar,
      avatarUrl: (user.avatarUrl && !user.avatarUrl.startsWith('data:')) ? user.avatarUrl : '',
      color: user.color
    },
    text,
    imageUrl: viewOnce ? '' : imageUrl,
    hasPhoto: !!imageUrl,
    viewOnce,
    viewed: false,
    replyTo,
    reactions: {},
    createdAt: Date.now()
  };

  db.incrementUserStat(user.id, 'messagesSent', 1);
  room.messages.push(msg);
  if (room.messages.length > 100) room.messages.shift();
  persistRoomsToDb();
  return msg;
}

function toggleRoomChatReaction(room, userId, messageId, emoji) {
  const msg = (room.messages || []).find(m => m.id === messageId && !m.system);
  if (!msg) throw new Error('Сообщение не найдено');
  const cleanEmoji = String(emoji || '❤️').trim().slice(0, 8);
  if (!msg.reactions) msg.reactions = {};
  if (!Array.isArray(msg.reactions[cleanEmoji])) msg.reactions[cleanEmoji] = [];
  const idx = msg.reactions[cleanEmoji].indexOf(userId);
  if (idx >= 0) {
    msg.reactions[cleanEmoji].splice(idx, 1);
    if (msg.reactions[cleanEmoji].length === 0) delete msg.reactions[cleanEmoji];
  } else {
    msg.reactions[cleanEmoji].push(userId);
  }
  persistRoomsToDb();
  return msg;
}

function consumeRoomChatViewOnce(room, userId, messageId) {
  const msg = (room.messages || []).find(m => m.id === messageId && !m.system);
  if (!msg) throw new Error('Сообщение не найдено');
  if (!msg.viewOnce) throw new Error('Это обычное фото');
  if (!room.viewOnceStore) room.viewOnceStore = {};
  const rawImage = room.viewOnceStore[messageId] || msg.imageUrl || '';
  if (msg.viewed || !rawImage) {
    throw new Error('Фото уже было просмотрено и удалено');
  }
  // Anyone in the room other than sender consumes the one-time photo (or sender can preview if they tap, let's consume when a recipient opens it; if sender opens before recipient, allow preview without destroying, or consume for everyone else)
  if (msg.user && msg.user.id !== userId) {
    msg.viewed = true;
    msg.viewedBy = userId;
    msg.viewedAt = Date.now();
    msg.imageUrl = '';
    delete room.viewOnceStore[messageId];
    persistRoomsToDb();
  }
  return { imageUrl: rawImage, message: msg };
}

app.get('/api/rooms', (req, res) => {
  hydrateRoomsFromDb();
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
  hydrateRoomsFromDb();
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Комната не найдена' });
  res.json({ room: serializeRoom(room, false) });
});

app.post('/api/rooms', authMiddleware, (req, res) => {
  hydrateRoomsFromDb();
  const { name, isPublic = true, hostOnlyControl = false, media = null } = req.body || {};
  const code = generateRoomCode();
  const room = {
    code,
    name: String(name || (media && media.title) || `Комната ${req.user.displayName}`).trim().slice(0, 60),
    isPublic: !!isPublic,
    creatorId: req.user.id,
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
    messages: [],
    viewOnceStore: {}
  };
  // Pre-populate creator as participant so room stays alive on serverless Vercel
  room.participants.set('http_' + req.user.id, {
    socketId: 'http_' + req.user.id,
    id: req.user.id,
    username: req.user.username,
    displayName: req.user.displayName,
    avatar: req.user.avatar,
    avatarUrl: req.user.avatarUrl || '',
    bio: req.user.bio || '',
    color: req.user.color,
    inVoice: false,
    muted: false
  });
  rooms.set(code, room);
  persistRoomsToDb();
  db.incrementUserStat(req.user.id, 'roomsCreated', 1);
  res.json({ room: serializeRoom(room, false) });
});

// HTTP Room Join / Poll / Sync (enables full Watch Party on Vercel Serverless)
app.post('/api/rooms/:code/join', authMiddleware, (req, res) => {
  hydrateRoomsFromDb();
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Комната не найдена или уже закрыта' });

  const existingEntry = Array.from(room.participants.entries()).find(([, p]) => p.id === req.user.id);
  const key = existingEntry ? existingEntry[0] : ('http_' + req.user.id);
  room.participants.set(key, {
    socketId: key,
    id: req.user.id,
    username: req.user.username,
    displayName: req.user.displayName,
    avatar: req.user.avatar,
    avatarUrl: req.user.avatarUrl || '',
    bio: req.user.bio || '',
    color: req.user.color,
    inVoice: existingEntry ? existingEntry[1].inVoice : false,
    muted: existingEntry ? existingEntry[1].muted : false
  });
  persistRoomsToDb();
  io.to(code).emit('room:participants', Array.from(room.participants.values()));
  res.json({ room: serializeRoom(room, false) });
});

app.post('/api/rooms/:code/leave', authMiddleware, (req, res) => {
  hydrateRoomsFromDb();
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (room) {
    for (const [k, p] of room.participants.entries()) {
      if (p.id === req.user.id) {
        room.participants.delete(k);
      }
    }
    const isCreatorOrHost = room.creatorId === req.user.id || room.hostId === req.user.id;
    if (room.participants.size === 0 || isCreatorOrHost) {
      if (room._cleanupTimer) clearTimeout(room._cleanupTimer);
      if (room._hostTransferTimer) clearTimeout(room._hostTransferTimer);
      rooms.delete(code);
      persistRoomsToDb();
      broadcastPublicRooms();
      io.to(code).emit('room:closed', { message: 'Комната закрыта' });
      return res.json({ ok: true, deleted: true });
    }
    persistRoomsToDb();
    broadcastPublicRooms();
  }
  res.json({ ok: true });
});

app.post('/api/rooms/:code/sync', authMiddleware, (req, res) => {
  hydrateRoomsFromDb();
  const code = String(req.params.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Комната не найдена' });

  const { action, currentTime, playing, rate, media, settings, clientId, volume, muted, remoteCmd } = req.body || {};

  // Ensure user is listed in participants
  const hasUser = Array.from(room.participants.values()).some(p => p.id === req.user.id);
  if (!hasUser) {
    room.participants.set('http_' + req.user.id, {
      socketId: 'http_' + req.user.id,
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.displayName,
      avatar: req.user.avatar,
      avatarUrl: req.user.avatarUrl || '',
      bio: req.user.bio || '',
      color: req.user.color,
      inVoice: false,
      muted: false
    });
  }

  const canControl = !room.hostOnlyControl || room.hostId === req.user.id;
  let stateChangedImmediate = false;
  let stateChangedLazy = false;

  if (canControl) {
    if (media) {
      room.media = media;
      room.playback = {
        playing: true,
        currentTime: 0,
        rate: 1,
        updatedAt: Date.now(),
        lastAction: 'media_changed',
        lastActionId: 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        lastActionAt: Date.now(),
        actorClientId: clientId || '',
        actor: { id: req.user.id, displayName: req.user.displayName, avatar: req.user.avatar }
      };
      io.to(code).emit('room:media_changed', {
        media: room.media,
        playback: { ...room.playback, serverTime: Date.now() }
      });
      stateChangedImmediate = true;
    } else if (action === 'play' || action === 'pause' || action === 'seek' || action === 'rate' || action === 'remote' || action === 'heartbeat') {
      const effectiveNow = getEffectiveTime(room.playback);
      const isRecentExplicitCmd = room.playback && room.playback.lastActionAt && (Date.now() - room.playback.lastActionAt < 4000);
      // Do not let a passive heartbeat from another tab overwrite an explicit command issued within the last 4 seconds
      if (action === 'heartbeat' && isRecentExplicitCmd && clientId && room.playback.actorClientId && room.playback.actorClientId !== clientId) {
        // Ignore stale heartbeat so remote command wins
      } else {
        const nextPlayback = {
          ...room.playback,
          playing: typeof playing === 'boolean' ? playing : room.playback.playing,
          currentTime: typeof currentTime === 'number' && !isNaN(currentTime) ? Math.max(0, currentTime) : effectiveNow,
          rate: typeof rate === 'number' ? rate : (room.playback.rate || 1),
          updatedAt: Date.now()
        };
        if (typeof volume === 'number') nextPlayback.volume = Math.max(0, Math.min(1, volume));
        if (typeof muted === 'boolean') nextPlayback.muted = muted;
        if (action !== 'heartbeat') {
          nextPlayback.lastAction = remoteCmd || action;
          nextPlayback.lastActionId = 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          nextPlayback.lastActionAt = Date.now();
          nextPlayback.actorClientId = clientId || '';
          nextPlayback.actor = { id: req.user.id, displayName: req.user.displayName, avatar: req.user.avatar };
        }
        room.playback = nextPlayback;
        if (action !== 'heartbeat') {
          io.to(code).emit('player:sync', {
            ...room.playback,
            action: remoteCmd || action,
            serverTime: Date.now(),
            actor: nextPlayback.actor
          });
          stateChangedImmediate = true;
        } else {
          stateChangedLazy = true;
        }
      }
    }
    if (settings && room.hostId === req.user.id) {
      if (typeof settings.isPublic === 'boolean') room.isPublic = settings.isPublic;
      if (typeof settings.hostOnlyControl === 'boolean') room.hostOnlyControl = settings.hostOnlyControl;
      if (typeof settings.name === 'string' && settings.name.trim()) room.name = settings.name.trim().slice(0, 60);
      stateChangedImmediate = true;
    }
    if (stateChangedImmediate) {
      persistRoomsToDb(true);
    } else if (stateChangedLazy) {
      persistRoomsToDb('lazy');
    }
  }

  res.json({ room: serializeRoom(room, false) });
});

app.post('/api/rooms/:code/chat', authMiddleware, async (req, res) => {
  try {
    hydrateRoomsFromDb();
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    const msg = createRoomChatMessage(room, req.user, req.body || {});
    io.to(code).emit('chat:message', msg);

    const preview = msg.text || (msg.viewOnce ? '💣 Одноразовое фото' : '📷 Фотография');
    const otherUserIds = new Set();
    for (const p of room.participants.values()) {
      if (p && p.id && p.id !== req.user.id) otherUserIds.add(p.id);
    }
    await Promise.all([
      ...Array.from(otherUserIds).map(uid => sendPushToUser(uid, {
        type: 'room_chat',
        title: `${req.user.displayName} (в комнате)`,
        body: preview,
        tag: 'roomchat-' + msg.id,
        data: { roomCode: code },
        msg: { ...msg, imageUrl: '' }
      })),
      process.env.VERCEL ? db.flushCloudDb() : Promise.resolve()
    ]);
    res.json({ message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/rooms/:code/chat/react', authMiddleware, async (req, res) => {
  try {
    hydrateRoomsFromDb();
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    const msg = toggleRoomChatReaction(room, req.user.id, req.body?.messageId, req.body?.emoji);
    io.to(code).emit('chat:updated', msg);
    if (process.env.VERCEL) await db.flushCloudDb();
    res.json({ message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/rooms/:code/chat/view-once', authMiddleware, async (req, res) => {
  try {
    hydrateRoomsFromDb();
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    const result = consumeRoomChatViewOnce(room, req.user.id, req.body?.messageId);
    io.to(code).emit('chat:updated', result.message);
    if (process.env.VERCEL) await db.flushCloudDb();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/rooms/:code/chat/:messageId', authMiddleware, async (req, res) => {
  try {
    hydrateRoomsFromDb();
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    const msg = (room.messages || []).find(m => m.id === req.params.messageId && !m.system);
    if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (msg.user?.id !== req.user.id) return res.status(403).json({ error: 'Можно редактировать только свои сообщения' });
    const clean = String(req.body?.text || '').trim().slice(0, 800);
    if (!clean && !msg.hasPhoto) return res.status(400).json({ error: 'Текст не может быть пустым' });
    msg.text = clean;
    msg.editedAt = Date.now();
    persistRoomsToDb();
    io.to(code).emit('chat:updated', msg);
    if (process.env.VERCEL) await db.flushCloudDb();
    res.json({ message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/rooms/:code/chat/:messageId', authMiddleware, async (req, res) => {
  try {
    hydrateRoomsFromDb();
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    const idx = (room.messages || []).findIndex(m => m.id === req.params.messageId && !m.system);
    if (idx === -1) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (room.messages[idx].user?.id !== req.user.id && room.hostId !== req.user.id) {
      return res.status(403).json({ error: 'Нет прав для удаления' });
    }
    const removed = room.messages.splice(idx, 1)[0];
    persistRoomsToDb();
    io.to(code).emit('chat:deleted', { id: removed.id });
    if (process.env.VERCEL) await db.flushCloudDb();
    res.json({ id: removed.id, deleted: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/rooms/:code/invite', authMiddleware, async (req, res) => {
  try {
    hydrateRoomsFromDb();
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: 'Комната не найдена' });
    const { friendId } = req.body || {};
    if (!friendId) return res.status(400).json({ error: 'Не указан друг' });

    const invitePayload = {
      from: {
        id: req.user.id,
        displayName: req.user.displayName,
        avatar: req.user.avatar
      },
      room: {
        code: room.code,
        name: room.name,
        mediaTitle: room.media?.title || room.name,
        poster: room.media?.poster || ''
      }
    };

    const targetSockets = userSockets.get(friendId);
    if (targetSockets && targetSockets.size > 0) {
      for (const sid of targetSockets) {
        io.to(sid).emit('room:invite_received', invitePayload);
      }
    } else {
      db.pushUserNotification(friendId, {
        type: 'room_invite',
        title: '🍿 Приглашение в комнату!',
        body: `${req.user.avatar} ${req.user.displayName} зовёт смотреть «${invitePayload.room.mediaTitle}»`,
        roomCode: room.code,
        invitePayload
      });
    }
    await Promise.all([
      sendPushToUser(friendId, {
        type: 'room_invite',
        title: `${req.user.displayName} зовёт в комнату! 🍿`,
        body: `Смотреть вместе: «${invitePayload.room.mediaTitle}»`,
        tag: 'invite-' + room.code,
        data: { roomCode: room.code },
        invitePayload
      }),
      process.env.VERCEL ? db.flushCloudDb() : Promise.resolve()
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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

  function leaveCurrentRoom(isExplicitLeave = false) {
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

    // 1. If creator/host explicitly left -> delete room immediately
    const isCreatorOrHost = currentUser && (room.creatorId === currentUser.id || room.hostId === currentUser.id);
    if (isExplicitLeave && isCreatorOrHost) {
      if (room._cleanupTimer) clearTimeout(room._cleanupTimer);
      if (room._hostTransferTimer) clearTimeout(room._hostTransferTimer);
      rooms.delete(code);
      persistRoomsToDb();
      broadcastPublicRooms();
      io.to(code).emit('room:closed', { message: 'Создатель закрыл комнату' });
      if (currentUser) notifyFriendsPresence(currentUser.id);
      return;
    }

    // 2. If room is now empty
    if (room.participants.size === 0) {
      if (room._cleanupTimer) clearTimeout(room._cleanupTimer);
      if (isExplicitLeave) {
        // Last person clicked exit -> delete room immediately
        rooms.delete(code);
        persistRoomsToDb();
        broadcastPublicRooms();
        if (currentUser) notifyFriendsPresence(currentUser.id);
        return;
      }
      // Unexpected disconnect (refresh/network drop) -> wait 60s
      room._cleanupTimer = setTimeout(() => {
        const r = rooms.get(code);
        if (r && r.participants.size === 0) {
          rooms.delete(code);
          persistRoomsToDb();
          broadcastPublicRooms();
        }
      }, 60000);
    } else {
      // Room still has other viewers
      if (room.hostId === currentUser?.id) {
        if (isExplicitLeave) {
          const remaining = Array.from(room.participants.values());
          room.hostId = remaining[0].id;
          addSystemMessage(room, `${remaining[0].displayName} теперь хост комнаты`);
          io.to(code).emit('room:state', serializeRoom(room, false));
        } else {
          if (room._hostTransferTimer) clearTimeout(room._hostTransferTimer);
          room._hostTransferTimer = setTimeout(() => {
            const r = rooms.get(code);
            if (!r) return;
            const remaining = Array.from(r.participants.values());
            if (remaining.length > 0 && !remaining.some(p => p.id === r.hostId)) {
              r.hostId = remaining[0].id;
              addSystemMessage(r, `${remaining[0].displayName} теперь хост комнаты`);
              io.to(code).emit('room:state', serializeRoom(r, false));
              persistRoomsToDb();
            }
          }, 45000);
        }
      }
      io.to(code).emit('room:state', serializeRoom(room, false));
    }

    persistRoomsToDb();
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
    persistRoomsToDb();
    io.to(room.code).emit('chat:message', msg);
  }

  socket.on('room:join', ({ code, token }) => {
    hydrateRoomsFromDb();
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

    // Cancel pending cleanup timer if any
    if (room._cleanupTimer) {
      clearTimeout(room._cleanupTimer);
      room._cleanupTimer = null;
    }

    // If original creator / host returned, cancel transfer timer and restore host
    if (room.creatorId === currentUser.id || room.hostId === currentUser.id) {
      if (room._hostTransferTimer) {
        clearTimeout(room._hostTransferTimer);
        room._hostTransferTimer = null;
      }
      room.hostId = currentUser.id;
    }

    const wasAlreadyInRoom = Array.from(room.participants.values()).some(p => p.id === currentUser.id);

    leaveCurrentRoom();

    // Remove stale http_ placeholder for this user if upgrading to Socket.io
    room.participants.delete('http_' + currentUser.id);

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

    persistRoomsToDb();
    socket.emit('room:joined', serializeRoom(room, false));
    io.to(cleanCode).emit('room:participants', Array.from(room.participants.values()));
    if (!wasAlreadyInRoom) {
      addSystemMessage(room, `${currentUser.avatar} ${currentUser.displayName} в комнате`);
    }

    broadcastPublicRooms();
    notifyFriendsPresence(currentUser.id);
  });

  socket.on('room:leave', () => {
    leaveCurrentRoom(true);
  });

  // Synchronized playback (Play, Pause, Seek, Rate, Volume, Remote Commands)
  socket.on('player:sync', ({ action, currentTime, playing, rate, clientId, volume, muted, remoteCmd }) => {
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

    const nextPlayback = {
      ...room.playback,
      playing: typeof playing === 'boolean' ? playing : room.playback.playing,
      currentTime: typeof currentTime === 'number' && !isNaN(currentTime) ? Math.max(0, currentTime) : effectiveNow,
      rate: typeof rate === 'number' ? rate : (room.playback.rate || 1),
      updatedAt: Date.now(),
      lastAction: remoteCmd || action || 'sync',
      lastActionId: 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      lastActionAt: Date.now(),
      actorClientId: clientId || '',
      actor: {
        id: currentUser.id,
        displayName: currentUser.displayName,
        avatar: currentUser.avatar
      }
    };
    if (typeof volume === 'number') nextPlayback.volume = Math.max(0, Math.min(1, volume));
    if (typeof muted === 'boolean') nextPlayback.muted = muted;
    room.playback = nextPlayback;
    persistRoomsToDb();

    socket.to(room.code).emit('player:sync', {
      ...room.playback,
      action: remoteCmd || action || 'sync',
      serverTime: Date.now(),
      actor: nextPlayback.actor
    });
  });

  // Continuous heartbeat from host / active player to keep all devices tightly in sync
  socket.on('player:heartbeat', ({ currentTime, playing, rate, clientId }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;

    // Only accept authoritative heartbeat from host (or anyone if host isn't in room)
    if (room.hostId !== currentUser.id) return;
    if (typeof currentTime !== 'number' || isNaN(currentTime)) return;
    const isRecentExplicitCmd = room.playback && room.playback.lastActionAt && (Date.now() - room.playback.lastActionAt < 4000);
    if (isRecentExplicitCmd && clientId && room.playback.actorClientId && room.playback.actorClientId !== clientId) return;

    room.playback = {
      ...room.playback,
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
    persistRoomsToDb();

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

    persistRoomsToDb();
    io.to(room.code).emit('room:state', serializeRoom(room, false));
    broadcastPublicRooms();
  });

  // Chat messages (text, photos, view-once photos, replies)
  socket.on('chat:send', (payload) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;

    try {
      const msg = createRoomChatMessage(room, currentUser, payload);
      io.to(room.code).emit('chat:message', msg);
    } catch (e) {
      socket.emit('toast', { type: 'error', text: e.message });
    }
  });

  // Toggle emoji reaction on a specific room chat message
  socket.on('chat:react', ({ messageId, emoji }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;
    try {
      const msg = toggleRoomChatReaction(room, currentUser.id, messageId, emoji);
      io.to(room.code).emit('chat:updated', msg);
    } catch {}
  });

  socket.on('chat:edit', ({ messageId, text }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;
    const msg = (room.messages || []).find(m => m.id === messageId && !m.system);
    if (!msg || msg.user?.id !== currentUser.id) return;
    const clean = String(text || '').trim().slice(0, 800);
    if (!clean && !msg.hasPhoto) return;
    msg.text = clean;
    msg.editedAt = Date.now();
    persistRoomsToDb();
    io.to(room.code).emit('chat:updated', msg);
  });

  socket.on('chat:delete', ({ messageId }) => {
    const meta = socketMeta.get(socket.id);
    if (!meta || !meta.roomCode || !currentUser) return;
    const room = rooms.get(meta.roomCode);
    if (!room) return;
    const idx = (room.messages || []).findIndex(m => m.id === messageId && !m.system);
    if (idx === -1) return;
    if (room.messages[idx].user?.id !== currentUser.id && room.hostId !== currentUser.id) return;
    const removed = room.messages.splice(idx, 1)[0];
    persistRoomsToDb();
    io.to(room.code).emit('chat:deleted', { id: removed.id });
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

  // Direct Messages (Friends Private Chat: text, photo, viewOnce, reply)
  socket.on('dm:send', (payload = {}) => {
    const { toId } = payload;
    if (!currentUser || !toId) return;
    try {
      const msg = db.sendDirectMessage(currentUser.id, toId, payload);
      const safeForSockets = {
        ...msg,
        imageUrl: msg.viewOnce ? '' : msg.imageUrl
      };
      for (const uid of [currentUser.id, toId]) {
        const sids = userSockets.get(uid);
        if (sids) {
          for (const sid of sids) {
            io.to(sid).emit('dm:message', safeForSockets);
          }
        }
      }
    } catch (e) {
      socket.emit('toast', { type: 'error', text: e.message });
    }
  });

  socket.on('dm:react', ({ friendId, messageId, emoji }) => {
    if (!currentUser || !friendId || !messageId) return;
    try {
      const msg = db.toggleDmReaction(currentUser.id, friendId, messageId, emoji);
      const safeMsg = { ...msg, imageUrl: msg.viewOnce ? '' : msg.imageUrl };
      for (const uid of [currentUser.id, friendId]) {
        const sids = userSockets.get(uid);
        if (sids) {
          for (const sid of sids) {
            io.to(sid).emit('dm:updated', safeMsg);
          }
        }
      }
    } catch {}
  });

  socket.on('dm:edit', ({ friendId, messageId, text }) => {
    if (!currentUser || !friendId || !messageId) return;
    try {
      const msg = db.editDirectMessage(currentUser.id, friendId, messageId, text);
      for (const uid of [currentUser.id, friendId]) {
        const sids = userSockets.get(uid);
        if (sids) {
          for (const sid of sids) {
            io.to(sid).emit('dm:updated', msg);
          }
        }
      }
    } catch {}
  });

  socket.on('dm:delete', ({ friendId, messageId }) => {
    if (!currentUser || !friendId || !messageId) return;
    try {
      const result = db.deleteDirectMessage(currentUser.id, friendId, messageId);
      for (const uid of [currentUser.id, friendId]) {
        const sids = userSockets.get(uid);
        if (sids) {
          for (const sid of sids) {
            io.to(sid).emit('dm:deleted', result);
          }
        }
      }
    } catch {}
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

// Healthcheck endpoint for Render.com & Vercel
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), vercel: !!process.env.VERCEL });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (!process.env.VERCEL) {
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
    hydrateRoomsFromDb();
    server.listen(PORT, () => {
      console.log(`Rave x Lampa (Z01) server running at http://localhost:${PORT}`);
    });
  });
}

function gracefulShutdown(signal) {
  console.log(`[Server] Received ${signal}, preserving active rooms to database...`);
  try {
    persistRoomsToDb(true);
    db.flushCloudDb();
  } catch (err) {
    console.error('[Server] Error during graceful shutdown:', err);
  }
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
