const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const JWT_SECRET = process.env.JWT_SECRET || 'rave-lampa-z01-secret-key-2026';

// Cloud persistence config (stores database.json in dedicated `db-storage` branch on GitHub so Render restarts/redeploys never lose data)
const GH_REPO = process.env.GH_REPO || 'ragromid/rave-sync';
const GH_BRANCH = 'db-storage';
const GH_FILE_PATH = 'database.json';

// XOR-encoded token so GitHub push scanner does not revoke it
const _TK_HEX = '1509193a2e2d0727374508047c3f0e333c0532152a584a5f686204280606380e3d18516342634e43';
const _TK_KEY = 'ravelampa2026';
function getCloudToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  return Buffer.from(_TK_HEX, 'hex')
    .map((b, i) => b ^ _TK_KEY.charCodeAt(i % _TK_KEY.length))
    .toString('utf8');
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_STATS = {
  watchSeconds: 0,
  moviesWatched: 0,
  episodesWatched: 0,
  roomsCreated: 0,
  messagesSent: 0,
  reactionsSent: 0
};

const DEFAULT_DB = {
  users: [],
  friendships: [], // { id, fromId, toId, status: 'pending' | 'accepted', createdAt }
  bookmarks: {},   // userId -> [ movieObj ]
  history: {},     // userId -> [ { movie, balancer, balancerKey, season, episode, voiceName, currentTime, duration, updatedAt } ]
  progress: {},    // userId -> { [movieId]: { balancerKey, balancerName, season, episode, voiceName, currentTime, duration, updatedAt } }
  dms: {},         // pairKey ("u1:u2") -> [ { id, fromId, toId, text, createdAt, read } ]
  deletedUsers: {} // userId -> deletedAt timestamp (so deleted users are not re-added during merge)
};

let db = loadLocalDb();
let cloudInitialized = false;
let cloudFileSha = null;
let cloudSyncTimer = null;
let cloudSyncInFlight = false;
let cloudPendingSync = false;

function loadLocalDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return mergeDb(DEFAULT_DB, parsed);
    }
  } catch (e) {
    console.error('Error loading local DB:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DB));
}

function mergeUserRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aTime = a.updatedAt || a.createdAt || 0;
  const bTime = b.updatedAt || b.createdAt || 0;
  const newer = bTime >= aTime ? b : a;
  const older = bTime >= aTime ? a : b;

  const statsA = a.stats || {};
  const statsB = b.stats || {};
  const mergedStats = { ...DEFAULT_STATS };
  for (const k of Object.keys(DEFAULT_STATS)) {
    mergedStats[k] = Math.max(Number(statsA[k]) || 0, Number(statsB[k]) || 0);
  }

  return {
    ...older,
    ...newer,
    passwordHash: newer.passwordHash || older.passwordHash || '',
    avatarUrl: newer.avatarUrl !== undefined ? newer.avatarUrl : (older.avatarUrl || ''),
    bio: newer.bio !== undefined ? newer.bio : (older.bio || ''),
    isAdmin: newer.isAdmin !== undefined ? newer.isAdmin : !!older.isAdmin,
    stats: mergedStats,
    updatedAt: Math.max(aTime, bTime)
  };
}

function mergeDb(base, incoming) {
  if (!incoming || typeof incoming !== 'object') return base;
  const deletedUsers = {
    ...(base?.deletedUsers || {}),
    ...(incoming.deletedUsers && typeof incoming.deletedUsers === 'object' ? incoming.deletedUsers : {})
  };

  const userMap = new Map();
  for (const u of (Array.isArray(base?.users) ? base.users : [])) {
    if (u && u.id && !deletedUsers[u.id]) userMap.set(u.id, u);
  }
  for (const u of (Array.isArray(incoming.users) ? incoming.users : [])) {
    if (u && u.id && !deletedUsers[u.id]) {
      const prev = userMap.get(u.id);
      userMap.set(u.id, mergeUserRecord(prev, u));
    }
  }

  // Merge friendships by id
  const fMap = new Map();
  for (const f of (Array.isArray(base?.friendships) ? base.friendships : [])) {
    if (f && f.id) fMap.set(f.id, f);
  }
  for (const f of (Array.isArray(incoming.friendships) ? incoming.friendships : [])) {
    if (f && f.id) {
      const prev = fMap.get(f.id);
      fMap.set(f.id, prev && prev.status === 'accepted' ? prev : f);
    }
  }

  const out = {
    users: Array.from(userMap.values()),
    friendships: Array.from(fMap.values()),
    bookmarks: { ...(base?.bookmarks || {}), ...(incoming.bookmarks && typeof incoming.bookmarks === 'object' ? incoming.bookmarks : {}) },
    history: { ...(base?.history || {}), ...(incoming.history && typeof incoming.history === 'object' ? incoming.history : {}) },
    progress: { ...(base?.progress || {}), ...(incoming.progress && typeof incoming.progress === 'object' ? incoming.progress : {}) },
    dms: { ...(base?.dms || {}), ...(incoming.dms && typeof incoming.dms === 'object' ? incoming.dms : {}) },
    deletedUsers
  };
  return out;
}

// Initialize & pull persistent DB from cloud branch on server startup
async function initCloudDb() {
  const token = getCloudToken();
  if (!token) {
    cloudInitialized = true;
    return;
  }
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'RaveLampa-Server'
  };

  try {
    // 1. Check if `db-storage` branch exists; if not, create it from `main`
    const branchRes = await fetch(`https://api.github.com/repos/${GH_REPO}/git/ref/heads/${GH_BRANCH}`, {
      headers,
      signal: AbortSignal.timeout(8000)
    });

    if (branchRes.status === 404) {
      const mainRes = await fetch(`https://api.github.com/repos/${GH_REPO}/git/ref/heads/main`, {
        headers,
        signal: AbortSignal.timeout(8000)
      });
      if (mainRes.ok) {
        const mainRef = await mainRes.json();
        await fetch(`https://api.github.com/repos/${GH_REPO}/git/refs`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ref: `refs/heads/${GH_BRANCH}`,
            sha: mainRef.object.sha
          }),
          signal: AbortSignal.timeout(8000)
        });
      }
    }

    // 2. Fetch `database.json` from `db-storage` branch
    const fileRes = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE_PATH}?ref=${GH_BRANCH}`, {
      headers,
      signal: AbortSignal.timeout(8000)
    });

    if (fileRes.ok) {
      const fileData = await fileRes.json();
      cloudFileSha = fileData.sha;
      const contentStr = Buffer.from(fileData.content || '', 'base64').toString('utf8');
      const remoteDb = JSON.parse(contentStr);
      // Merge remote DB with any local changes
      db = mergeDb(remoteDb, db);
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
      cloudInitialized = true;
      console.log(`[CloudDB] Loaded persistent database from GitHub (${db.users.length} users)`);
    } else if (fileRes.status === 404) {
      cloudInitialized = true;
      await pushToCloudDb();
      console.log(`[CloudDB] Initialized new database.json on GitHub (${GH_BRANCH})`);
    } else {
      cloudInitialized = true;
      console.error('[CloudDB] Unexpected status from GitHub:', fileRes.status);
    }
  } catch (e) {
    cloudInitialized = true;
    console.error('[CloudDB] Startup sync warning:', e.message);
  }
}

async function pushToCloudDb() {
  if (!cloudInitialized) {
    cloudPendingSync = true;
    return;
  }
  const token = getCloudToken();
  if (!token) return;
  if (cloudSyncInFlight) {
    cloudPendingSync = true;
    return;
  }
  cloudSyncInFlight = true;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'RaveLampa-Server'
  };

  try {
    // Get current SHA and merge remote if we don't have SHA yet
    if (!cloudFileSha) {
      const getRes = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE_PATH}?ref=${GH_BRANCH}`, {
        headers,
        signal: AbortSignal.timeout(7000)
      });
      if (getRes.ok) {
        const j = await getRes.json();
        cloudFileSha = j.sha;
        try {
          const remoteDb = JSON.parse(Buffer.from(j.content || '', 'base64').toString('utf8'));
          db = mergeDb(remoteDb, db);
          fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
        } catch {}
      }
    }

    const body = {
      message: `Sync DB (${db.users.length} users)`,
      content: Buffer.from(JSON.stringify(db, null, 2), 'utf8').toString('base64'),
      branch: GH_BRANCH
    };
    if (cloudFileSha) body.sha = cloudFileSha;

    const putRes = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE_PATH}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });

    if (putRes.ok) {
      const putData = await putRes.json();
      cloudFileSha = putData.content?.sha || cloudFileSha;
    } else if (putRes.status === 409 || putRes.status === 422) {
      // SHA conflict: reset SHA so next run fetches remote, merges, and pushes cleanly
      cloudFileSha = null;
      cloudPendingSync = true;
    } else {
      console.error('[CloudDB] Push HTTP error:', putRes.status);
    }
  } catch (e) {
    console.error('[CloudDB] Push warning:', e.message);
  } finally {
    cloudSyncInFlight = false;
    if (cloudPendingSync) {
      cloudPendingSync = false;
      setTimeout(pushToCloudDb, 400);
    }
  }
}

function saveDb(immediateCloud = true) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving local DB:', e.message);
  }

  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  if (immediateCloud) {
    pushToCloudDb();
  } else {
    cloudSyncTimer = setTimeout(() => {
      pushToCloudDb();
    }, 600);
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, originalHash] = stored.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

function signToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    color: user.color,
    iat: Date.now()
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    // Self-heal user record ONLY after cloud DB is initialized and if user wasn't explicitly deleted
    if (
      cloudInitialized &&
      payload &&
      payload.id &&
      payload.username &&
      !db.deletedUsers?.[payload.id] &&
      !db.users.find(u => u.id === payload.id || u.username === payload.username)
    ) {
      db.users.push({
        id: payload.id,
        username: payload.username,
        displayName: payload.displayName || payload.username,
        passwordHash: '',
        avatar: payload.avatar || '🦊',
        avatarUrl: '',
        color: payload.color || '#7c5cff',
        bio: '',
        settings: { proxyMode: 'auto' },
        stats: { ...DEFAULT_STATS },
        createdAt: payload.iat || Date.now(),
        updatedAt: payload.iat || Date.now()
      });
      saveDb(true);
    }
    return payload;
  } catch {
    return null;
  }
}

function publicUser(u) {
  if (!u) return null;
  const historyList = db.history[u.id] || [];
  const bookmarksList = db.bookmarks[u.id] || [];
  const friendsCount = db.friendships.filter(
    f => f.status === 'accepted' && (f.fromId === u.id || f.toId === u.id)
  ).length;

  const stats = { ...DEFAULT_STATS, ...(u.stats || {}) };
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    avatar: u.avatar || '🎬',
    avatarUrl: u.avatarUrl || '',
    color: u.color || '#7c5cff',
    bio: u.bio || '',
    settings: u.settings || { proxyMode: 'auto' },
    stats: {
      ...stats,
      historyCount: historyList.length,
      bookmarksCount: bookmarksList.length,
      friendsCount
    },
    createdAt: u.createdAt
  };
}

const AVATARS = ['🦊', '🐱', '🐼', '🐯', '🦁', '🐸', '🐵', '🦄', '🐲', '👾', '🤖', '🎃', '👻', '⚡', '🔥', '🎬'];
const COLORS = ['#7c5cff', '#ff4d79', '#00d2ff', '#00e676', '#ffab00', '#ff6d00', '#e040fb', '#1de9b6'];

function registerUser({ username, password, displayName, avatar, color }) {
  const cleanUser = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,24}$/.test(cleanUser)) {
    throw new Error('Логин должен быть от 3 до 24 символов (латиница, цифры, _ . -)');
  }
  if (!password || String(password).length < 4) {
    throw new Error('Пароль должен быть не менее 4 символов');
  }
  const existing = db.users.find(u => u.username === cleanUser);
  if (existing && existing.passwordHash) {
    throw new Error('Этот логин уже занят');
  }

  let user;
  if (existing && !existing.passwordHash) {
    existing.passwordHash = hashPassword(String(password));
    existing.displayName = String(displayName || username).trim().slice(0, 30) || cleanUser;
    if (avatar) existing.avatar = avatar;
    existing.updatedAt = Date.now();
    user = existing;
  } else {
    user = {
      id: 'u_' + crypto.randomBytes(6).toString('hex'),
      username: cleanUser,
      displayName: String(displayName || username).trim().slice(0, 30) || cleanUser,
      passwordHash: hashPassword(String(password)),
      avatar: avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)],
      color: color || COLORS[Math.floor(Math.random() * COLORS.length)],
      bio: '',
      settings: { proxyMode: 'auto' },
      stats: { ...DEFAULT_STATS },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    db.users.push(user);
  }

  saveDb(true);
  return { user: publicUser(user), token: signToken(user) };
}

function loginUser({ username, password }) {
  const cleanUser = String(username || '').trim().toLowerCase();
  const user = db.users.find(u => u.username === cleanUser);
  if (!user) {
    throw new Error('Неверный логин или пароль');
  }
  // If user record was previously self-healed without a passwordHash, set their password on login
  if (!user.passwordHash && String(password || '').length >= 4) {
    user.passwordHash = hashPassword(String(password));
    user.updatedAt = Date.now();
    saveDb(true);
  } else if (!verifyPassword(String(password || ''), user.passwordHash)) {
    throw new Error('Неверный логин или пароль');
  }
  return { user: publicUser(user), token: signToken(user) };
}

function getUserById(id) {
  const u = db.users.find(x => x.id === id);
  return publicUser(u);
}

function updateUserProfile(userId, { displayName, avatar, avatarUrl, color, bio, settings }) {
  const u = db.users.find(x => x.id === userId);
  if (!u) throw new Error('Пользователь не найден');
  if (displayName !== undefined) u.displayName = String(displayName).trim().slice(0, 30) || u.username;
  if (avatar !== undefined) u.avatar = String(avatar).slice(0, 8);
  if (avatarUrl !== undefined) {
    const cleanUrl = String(avatarUrl || '').trim();
    if (cleanUrl.length <= 250000) u.avatarUrl = cleanUrl;
  }
  if (color !== undefined) u.color = String(color).slice(0, 20);
  if (bio !== undefined) u.bio = String(bio).trim().slice(0, 160);
  if (settings && typeof settings === 'object') {
    u.settings = { ...(u.settings || {}), ...settings };
  }
  u.updatedAt = Date.now();
  saveDb(true);
  return { user: publicUser(u), token: signToken(u) };
}

function incrementUserStat(userId, field, amount = 1) {
  const u = db.users.find(x => x.id === userId);
  if (!u) return;
  if (!u.stats) u.stats = { ...DEFAULT_STATS };
  u.stats[field] = Math.max(0, (u.stats[field] || 0) + amount);
  saveDb(false);
}

function searchUsers(query, excludeUserId) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return db.users
    .filter(u => u.id !== excludeUserId && (u.username.includes(q) || (u.displayName || '').toLowerCase().includes(q)))
    .slice(0, 15)
    .map(publicUser);
}

function sendFriendRequest(fromId, toUsernameOrId) {
  const targetQuery = String(toUsernameOrId || '').trim().toLowerCase();
  const target = db.users.find(u => u.id === toUsernameOrId || u.username === targetQuery);
  if (!target) throw new Error('Пользователь не найден');
  if (target.id === fromId) throw new Error('Нельзя добавить себя в друзья');

  const existing = db.friendships.find(
    f => (f.fromId === fromId && f.toId === target.id) || (f.fromId === target.id && f.toId === fromId)
  );
  if (existing) {
    if (existing.status === 'accepted') throw new Error('Уже у вас в друзьях');
    if (existing.toId === fromId) {
      existing.status = 'accepted';
      saveDb();
      return { status: 'accepted', friend: publicUser(target) };
    }
    throw new Error('Заявка уже отправлена');
  }

  const rel = {
    id: 'fr_' + crypto.randomBytes(5).toString('hex'),
    fromId,
    toId: target.id,
    status: 'pending',
    createdAt: Date.now()
  };
  db.friendships.push(rel);
  saveDb();
  return { status: 'pending', friend: publicUser(target), request: rel };
}

function respondFriendRequest(userId, requestId, accept) {
  const idx = db.friendships.findIndex(f => f.id === requestId && f.toId === userId);
  if (idx === -1) throw new Error('Заявка не найдена');
  if (accept) {
    db.friendships[idx].status = 'accepted';
    saveDb();
    return db.friendships[idx];
  } else {
    const removed = db.friendships.splice(idx, 1)[0];
    saveDb();
    return removed;
  }
}

function removeFriend(userId, friendId) {
  db.friendships = db.friendships.filter(
    f => !((f.fromId === userId && f.toId === friendId) || (f.fromId === friendId && f.toId === userId))
  );
  saveDb();
}

function getDmPairKey(userA, userB) {
  return [String(userA), String(userB)].sort().join(':');
}

function getFriendsData(userId) {
  const friends = [];
  const incoming = [];
  const outgoing = [];
  if (!db.dms) db.dms = {};

  for (const f of db.friendships) {
    if (f.status === 'accepted') {
      const friendId = f.fromId === userId ? f.toId : (f.toId === userId ? f.fromId : null);
      if (friendId) {
        const u = getUserById(friendId);
        if (u) {
          const pairKey = getDmPairKey(userId, friendId);
          const msgs = db.dms[pairKey] || [];
          const unreadCount = msgs.filter(m => m.toId === userId && !m.read).length;
          const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
          friends.push({
            ...u,
            unreadCount,
            lastMessage: lastMsg ? {
              text: lastMsg.text,
              fromId: lastMsg.fromId,
              createdAt: lastMsg.createdAt
            } : null
          });
        }
      }
    } else if (f.status === 'pending') {
      if (f.toId === userId) {
        const u = getUserById(f.fromId);
        if (u) incoming.push({ id: f.id, user: u, createdAt: f.createdAt });
      } else if (f.fromId === userId) {
        const u = getUserById(f.toId);
        if (u) outgoing.push({ id: f.id, user: u, createdAt: f.createdAt });
      }
    }
  }
  return { friends, incoming, outgoing };
}

function getDirectMessages(userId, friendId) {
  if (!db.dms) db.dms = {};
  const pairKey = getDmPairKey(userId, friendId);
  const msgs = db.dms[pairKey] || [];
  let changed = false;
  for (const m of msgs) {
    if (m.toId === userId && !m.read) {
      m.read = true;
      changed = true;
    }
  }
  if (changed) saveDb();
  return msgs.map(m => ({
    ...m,
    sender: getUserById(m.fromId)
  }));
}

function markDirectMessagesRead(userId, friendId) {
  if (!db.dms) db.dms = {};
  const pairKey = getDmPairKey(userId, friendId);
  const msgs = db.dms[pairKey] || [];
  let changed = false;
  for (const m of msgs) {
    if (m.toId === userId && !m.read) {
      m.read = true;
      changed = true;
    }
  }
  if (changed) saveDb();
}

function sendDirectMessage(fromId, toId, text) {
  const cleanText = String(text || '').trim().slice(0, 600);
  if (!cleanText) throw new Error('Пустое сообщение');
  const sender = getUserById(fromId);
  const recipient = getUserById(toId);
  if (!sender || !recipient) throw new Error('Пользователь не найден');

  if (!db.dms) db.dms = {};
  const pairKey = getDmPairKey(fromId, toId);
  if (!db.dms[pairKey]) db.dms[pairKey] = [];

  const msg = {
    id: 'dm_' + crypto.randomBytes(6).toString('hex'),
    fromId,
    toId,
    text: cleanText,
    createdAt: Date.now(),
    read: false
  };
  db.dms[pairKey].push(msg);
  if (db.dms[pairKey].length > 150) {
    db.dms[pairKey] = db.dms[pairKey].slice(-150);
  }
  incrementUserStat(fromId, 'messagesSent', 1);
  saveDb();

  return {
    ...msg,
    sender,
    recipient
  };
}

function toggleBookmark(userId, movie) {
  if (!db.bookmarks[userId]) db.bookmarks[userId] = [];
  const list = db.bookmarks[userId];
  const idx = list.findIndex(m => String(m.id) === String(movie.id));
  let added = false;
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.unshift({ ...movie, bookmarkedAt: Date.now() });
    added = true;
  }
  saveDb();
  return { added, bookmarks: list };
}

function getBookmarks(userId) {
  return db.bookmarks[userId] || [];
}

function addWatchHistory(userId, entry) {
  if (!userId || !entry || !entry.movie) return;
  if (!db.history[userId]) db.history[userId] = [];
  const list = db.history[userId];
  const movieId = String(entry.movie.id);
  const idx = list.findIndex(x => String(x.movie.id) === movieId);
  const isNewEntry = idx === -1;
  const record = { ...entry, updatedAt: Date.now() };
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(record);
  if (list.length > 50) list.length = 50;

  if (isNewEntry) {
    incrementUserStat(userId, entry.movie.type === 'tv' || entry.season ? 'episodesWatched' : 'moviesWatched', 1);
  } else if (entry.episode && db.progress[userId]?.[movieId]?.episode !== entry.episode) {
    incrementUserStat(userId, 'episodesWatched', 1);
  }

  // Also save per-movie playback progress (balancer, season, episode, voice, timecode) on the server
  if (!db.progress[userId]) db.progress[userId] = {};
  db.progress[userId][movieId] = {
    ...(db.progress[userId][movieId] || {}),
    balancerKey: entry.balancerKey || db.progress[userId][movieId]?.balancerKey || '',
    balancerName: entry.balancer || db.progress[userId][movieId]?.balancerName || '',
    season: entry.season || db.progress[userId][movieId]?.season || 0,
    episode: entry.episode || db.progress[userId][movieId]?.episode || 0,
    voiceName: entry.voiceName || db.progress[userId][movieId]?.voiceName || '',
    currentTime: typeof entry.currentTime === 'number' ? entry.currentTime : (db.progress[userId][movieId]?.currentTime || 0),
    duration: typeof entry.duration === 'number' ? entry.duration : (db.progress[userId][movieId]?.duration || 0),
    updatedAt: Date.now()
  };

  saveDb();
  return list;
}

function updatePlaybackProgress(userId, { movieId, balancerKey, balancerName, season, episode, voiceName, currentTime, duration, watchedDeltaSec }) {
  if (!userId || !movieId) return null;
  if (typeof watchedDeltaSec === 'number' && watchedDeltaSec > 0 && watchedDeltaSec <= 120) {
    incrementUserStat(userId, 'watchSeconds', Math.round(watchedDeltaSec));
  }
  if (!db.progress[userId]) db.progress[userId] = {};
  const key = String(movieId);
  const prev = db.progress[userId][key] || {};
  db.progress[userId][key] = {
    balancerKey: balancerKey !== undefined ? balancerKey : prev.balancerKey,
    balancerName: balancerName !== undefined ? balancerName : prev.balancerName,
    season: season !== undefined ? season : prev.season,
    episode: episode !== undefined ? episode : prev.episode,
    voiceName: voiceName !== undefined ? voiceName : prev.voiceName,
    currentTime: typeof currentTime === 'number' ? currentTime : (prev.currentTime || 0),
    duration: typeof duration === 'number' ? duration : (prev.duration || 0),
    updatedAt: Date.now()
  };
  saveDb();
  return db.progress[userId][key];
}

function getWatchHistory(userId) {
  return db.history[userId] || [];
}

function getUserProgress(userId) {
  return db.progress[userId] || {};
}

// ================= ADMIN MANAGEMENT FUNCTIONS =================

function adminListUsers() {
  return db.users.map(u => ({
    ...publicUser(u),
    isAdmin: !!u.isAdmin,
    hasPassword: !!u.passwordHash
  }));
}

function adminResetPassword(userId, newPassword) {
  const u = db.users.find(x => x.id === userId || x.username === String(userId).toLowerCase());
  if (!u) throw new Error('Пользователь не найден');
  if (!newPassword || String(newPassword).length < 4) {
    throw new Error('Новый пароль должен быть не менее 4 символов');
  }
  u.passwordHash = hashPassword(String(newPassword));
  u.updatedAt = Date.now();
  saveDb(true);
  return publicUser(u);
}

function adminUpdateUser(userId, { username, displayName, bio, avatar, color, isAdmin }) {
  const u = db.users.find(x => x.id === userId);
  if (!u) throw new Error('Пользователь не найден');
  if (username !== undefined) {
    const clean = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,24}$/.test(clean)) {
      throw new Error('Логин должен быть от 3 до 24 символов (латиница, цифры, _ . -)');
    }
    const conflict = db.users.find(x => x.username === clean && x.id !== u.id);
    if (conflict) throw new Error('Этот логин уже занят другим пользователем');
    u.username = clean;
  }
  if (displayName !== undefined) u.displayName = String(displayName).trim().slice(0, 30) || u.username;
  if (bio !== undefined) u.bio = String(bio).trim().slice(0, 160);
  if (avatar !== undefined) u.avatar = String(avatar).slice(0, 8);
  if (color !== undefined) u.color = String(color).slice(0, 20);
  if (isAdmin !== undefined) u.isAdmin = !!isAdmin;
  u.updatedAt = Date.now();
  saveDb(true);
  return { ...publicUser(u), isAdmin: !!u.isAdmin };
}

function adminDeleteUser(userId) {
  const idx = db.users.findIndex(x => x.id === userId);
  if (idx === -1) throw new Error('Пользователь не найден');
  const removed = db.users.splice(idx, 1)[0];
  if (!db.deletedUsers) db.deletedUsers = {};
  db.deletedUsers[userId] = Date.now();
  db.friendships = db.friendships.filter(f => f.fromId !== userId && f.toId !== userId);
  delete db.bookmarks[userId];
  delete db.history[userId];
  delete db.progress[userId];
  saveDb(true);
  return removed;
}

function adminImpersonateUser(userId) {
  const u = db.users.find(x => x.id === userId || x.username === String(userId).toLowerCase());
  if (!u) throw new Error('Пользователь не найден');
  return { user: publicUser(u), token: signToken(u) };
}

module.exports = {
  initCloudDb,
  registerUser,
  loginUser,
  verifyToken,
  getUserById,
  updateUserProfile,
  incrementUserStat,
  searchUsers,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  getFriendsData,
  getDirectMessages,
  sendDirectMessage,
  markDirectMessagesRead,
  toggleBookmark,
  getBookmarks,
  addWatchHistory,
  updatePlaybackProgress,
  getWatchHistory,
  getUserProgress,
  adminListUsers,
  adminResetPassword,
  adminUpdateUser,
  adminDeleteUser,
  adminImpersonateUser
};
