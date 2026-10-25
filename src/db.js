const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const JWT_SECRET = process.env.JWT_SECRET || 'rave-lampa-z01-secret-key-2026';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_DB = {
  users: [],
  friendships: [], // { id, fromId, toId, status: 'pending' | 'accepted', createdAt }
  bookmarks: {},   // userId -> [ movieObj ]
  history: {}      // userId -> [ { movie, balancer, season, episode, voiceName, time, updatedAt } ]
};

let db = loadDb();

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return { ...DEFAULT_DB, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('Error loading DB:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DB));
}

let saveTimer = null;
function saveDb() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving DB:', e.message);
    }
  }, 150);
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

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
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
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    avatar: u.avatar || '🎬',
    color: u.color || '#7c5cff',
    bio: u.bio || '',
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
  if (db.users.find(u => u.username === cleanUser)) {
    throw new Error('Этот логин уже занят');
  }
  const user = {
    id: 'u_' + crypto.randomBytes(6).toString('hex'),
    username: cleanUser,
    displayName: String(displayName || username).trim().slice(0, 30) || cleanUser,
    passwordHash: hashPassword(String(password)),
    avatar: avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)],
    color: color || COLORS[Math.floor(Math.random() * COLORS.length)],
    bio: '',
    createdAt: Date.now()
  };
  db.users.push(user);
  saveDb();
  return { user: publicUser(user), token: signToken({ id: user.id }) };
}

function loginUser({ username, password }) {
  const cleanUser = String(username || '').trim().toLowerCase();
  const user = db.users.find(u => u.username === cleanUser);
  if (!user || !verifyPassword(String(password || ''), user.passwordHash)) {
    throw new Error('Неверный логин или пароль');
  }
  return { user: publicUser(user), token: signToken({ id: user.id }) };
}

function getUserById(id) {
  const u = db.users.find(x => x.id === id);
  return publicUser(u);
}

function updateUserProfile(userId, { displayName, avatar, color, bio }) {
  const u = db.users.find(x => x.id === userId);
  if (!u) throw new Error('Пользователь не найден');
  if (displayName !== undefined) u.displayName = String(displayName).trim().slice(0, 30) || u.username;
  if (avatar !== undefined) u.avatar = String(avatar).slice(0, 8);
  if (color !== undefined) u.color = String(color).slice(0, 20);
  if (bio !== undefined) u.bio = String(bio).trim().slice(0, 120);
  saveDb();
  return publicUser(u);
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

function getFriendsData(userId) {
  const friends = [];
  const incoming = [];
  const outgoing = [];

  for (const f of db.friendships) {
    if (f.status === 'accepted') {
      if (f.fromId === userId) {
        const u = getUserById(f.toId);
        if (u) friends.push(u);
      } else if (f.toId === userId) {
        const u = getUserById(f.fromId);
        if (u) friends.push(u);
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
  const idx = list.findIndex(x => String(x.movie.id) === String(entry.movie.id));
  const record = { ...entry, updatedAt: Date.now() };
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(record);
  if (list.length > 50) list.length = 50;
  saveDb();
  return list;
}

function getWatchHistory(userId) {
  return db.history[userId] || [];
}

module.exports = {
  registerUser,
  loginUser,
  verifyToken,
  getUserById,
  updateUserProfile,
  searchUsers,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  getFriendsData,
  toggleBookmark,
  getBookmarks,
  addWatchHistory,
  getWatchHistory
};
