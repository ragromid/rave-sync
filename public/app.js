(() => {
  'use strict';

  // ================= APPLICATION STATE =================
  const state = {
    token: '',
    user: null,
    bookmarks: [],
    history: [],
    progress: {},
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
    publicRooms: [],

    // Catalog
    currentView: 'explore',
    category: 'trending',
    page: 1,
    searchQuery: '',
    heroMovie: null,
    selectedMovie: null,
    savedTab: 'bookmarks',

    // Active Watch Party Room
    room: null,
    proxyMode: 'auto', // 'auto' | 'always' | 'off'

    // Z01 State for the active movie/series in Room
    z01: {
      movie: null,
      uid: '',
      sources: [],
      activeSourceKey: '',
      seasons: [],
      activeSeasonIdx: 0,
      voices: [],
      activeVoiceIdx: 0,
      videos: [],
      activeVideoIdx: 0,
      qualities: {},
      activeQuality: '',
      openDropdown: '' // '' | 'source' | 'season' | 'voice' | 'quality'
    },

    // Player & Sync
    hls: null,
    ytPlayer: null,
    ytReady: false,
    suppressSyncEmit: false,
    justLoadedMediaUntil: 0,
    lastSyncAt: 0,
    mobileRoomTab: 'chat',
    unreadChatCount: 0,

    // WebRTC Voice Chat
    voiceActive: false,
    localStream: null,
    peers: new Map() // socketId -> RTCPeerConnection
  };

  const isVercelHost = /\.vercel\.app$/i.test(window.location.hostname);
  const socket = (!isVercelHost && typeof window.io === 'function')
    ? window.io({ reconnectionAttempts: 5 })
    : { connected: false, on() {}, emit() {} };

  // ================= HELPERS & API =================
  const $ = (id) => document.getElementById(id);

  // Prevent iOS/Android Home Screen PWA from shifting the viewport upward when virtual keyboard opens/closes
  function lockMobileViewport() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
    if (window.scrollY !== 0 || window.scrollX !== 0) {
      window.scrollTo(0, 0);
    }
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', lockMobileViewport);
    window.visualViewport.addEventListener('scroll', lockMobileViewport);
  }
  window.addEventListener('resize', lockMobileViewport);
  document.addEventListener('focusout', () => {
    setTimeout(lockMobileViewport, 80);
  });
  lockMobileViewport();

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const res = await fetch(path, { credentials: 'same-origin', ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function avatarInnerHtml(u, fallbackEmoji = '🦊') {
    if (u && u.avatarUrl) {
      return `<img class="avatar-img" src="${esc(u.avatarUrl)}" alt="" />`;
    }
    return esc((u && u.avatar) || fallbackEmoji);
  }

  function setAvatarElement(el, u, fallbackEmoji = '🦊') {
    if (!el) return;
    el.style.background = (u && u.color) || '#7c5cff';
    if (u && u.avatarUrl) {
      el.innerHTML = `<img class="avatar-img" src="${esc(u.avatarUrl)}" alt="" />`;
    } else {
      el.textContent = (u && u.avatar) || fallbackEmoji;
    }
  }

  function formatWatchTime(seconds) {
    const sec = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(sec / 60);
    if (mins < 60) return `${mins} мин`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs} ч ${remMins} м` : `${hrs} ч`;
  }

  function showToast(text, actionLabel, onAction, duration = 4500) {
    const container = $('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.innerHTML = `<div>${esc(text)}</div>`;
    if (actionLabel && typeof onAction === 'function') {
      const btn = document.createElement('button');
      btn.className = 'btn primary tiny';
      btn.style.height = '30px';
      btn.textContent = actionLabel;
      btn.onclick = () => {
        el.remove();
        onAction();
      };
      el.appendChild(btn);
    }
    container.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, duration);
  }

  // ================= TELEGRAM-STYLE NOTIFICATIONS & PERMISSION ENGINE =================
  let swRegistration = null;
  let audioCtx = null;
  let notifBannerDismissed = false;
  const notifiedDmIds = new Set();
  const notifiedReqIds = new Set();
  let initialFriendsLoaded = false;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      swRegistration = reg;
    }).catch(() => {});

    navigator.serviceWorker.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'RAVELAMPA_NOTIFICATION_CLICK') {
        const d = msg.data || {};
        if (d.roomCode) {
          joinRoomByCode(d.roomCode);
        } else if (d.friendId) {
          if (state.currentView === 'room') {
            setMobileRoomTab('dms');
            openRoomDmChat(d.friendId);
          } else {
            switchView('friends');
            openFriendChat(d.friendId);
          }
        } else if (d.view) {
          switchView(d.view);
        }
      }
    });
  }

  function playNotificationSound(kind = 'message') {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      if (kind === 'invite') {
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.11); // A5
      } else {
        osc.frequency.setValueAtTime(659.25, now); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.08); // G5
      }
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch {}
  }

  let inAppSoundUnlocked = false;
  try {
    inAppSoundUnlocked = localStorage.getItem('ravelampa_notif_enabled') === '1';
  } catch {}

  function isIosSafariTab() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
    return isIOS && !isStandalone;
  }

  function updateNotificationBellUi() {
    const hasNotifApi = 'Notification' in window;
    const perm = hasNotifApi ? Notification.permission : (inAppSoundUnlocked ? 'granted' : 'default');
    const bellIcon = $('notifBellIcon');
    const bellBtn = $('notifBellBtn');
    const banner = $('notifPermissionBanner');

    if (bellIcon && bellBtn) {
      if (perm === 'granted' || inAppSoundUnlocked) {
        bellIcon.textContent = '🔔';
        bellBtn.title = 'Уведомления включены (нажмите для проверки)';
      } else {
        bellIcon.textContent = '🔕';
        bellBtn.title = 'Нажмите, чтобы разрешить уведомления';
      }
    }

    if (banner) {
      if (perm === 'default' && !inAppSoundUnlocked && state.user && !notifBannerDismissed) {
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
    }
  }

  function requestPermissionCompat() {
    return new Promise((resolve) => {
      try {
        const res = Notification.requestPermission((perm) => resolve(perm));
        if (res && typeof res.then === 'function') {
          res.then(resolve).catch(() => resolve(Notification.permission));
        }
      } catch {
        resolve('denied');
      }
    });
  }

  async function requestBrowserNotificationPermission() {
    // Unlock WebAudio immediately inside user gesture (required by Safari!)
    playNotificationSound('invite');
    inAppSoundUnlocked = true;
    try { localStorage.setItem('ravelampa_notif_enabled', '1'); } catch {}

    if (!('Notification' in window)) {
      updateNotificationBellUi();
      if (isIosSafariTab()) {
        triggerAppNotification({
          title: 'Звук и уведомления в Safari включены! 🔔',
          body: 'На iPhone системные уведомления на экран блокировки работают, если нажать «Поделиться ⬆️ → На экран Домой 📲»',
          user: state.user || { avatar: '🍏', color: '#7c5cff' }
        });
      } else {
        triggerAppNotification({
          title: 'Встроенные уведомления включены! 🔔',
          body: 'Вы будете получать всплывающие карточки и звуковой сигнал при новых сообщениях.',
          user: state.user || { avatar: '🔔', color: '#7c5cff' }
        });
      }
      return;
    }

    try {
      const perm = await requestPermissionCompat();
      updateNotificationBellUi();
      if (perm === 'granted') {
        triggerAppNotification({
          title: 'Уведомления включены! 🔔',
          body: 'Теперь вы будете получать сообщения от друзей и приглашения в комнаты как в Telegram.',
          user: state.user || { avatar: '🔔', color: '#7c5cff' },
          forceSystem: true
        });
      } else if (perm === 'denied') {
        showToast('Системные уведомления запрещены в настройках Safari, но встроенные уведомления со звуком работают!');
      }
    } catch {}
  }

  $('notifAllowBtn')?.addEventListener('click', requestBrowserNotificationPermission);
  $('notifDismissBtn')?.addEventListener('click', () => {
    notifBannerDismissed = true;
    $('notifPermissionBanner')?.classList.add('hidden');
  });
  $('notifBellBtn')?.addEventListener('click', () => {
    const hasGrant = ('Notification' in window && Notification.permission === 'granted');
    if (!hasGrant) {
      requestBrowserNotificationPermission();
    } else {
      triggerAppNotification({
        title: 'Проверка уведомлений 🔔',
        body: 'Уведомления и звук RaveLampa работают отлично!',
        user: state.user || { avatar: '🔔', color: '#7c5cff' },
        forceSystem: true
      });
    }
  });

  function showTelegramTopCard({ title, body, user, onClick }) {
    const container = $('tgTopNotifContainer');
    if (!container) return;
    const card = document.createElement('div');
    card.className = 'tg-notif-card';
    const avHtml = avatarInnerHtml(user, '🔔');
    const avBg = (user && user.color) || '#7c5cff';
    card.innerHTML = `
      <div class="avatar-circle" style="background:${esc(avBg)};width:38px;height:38px;font-size:1.1rem;flex-shrink:0;">${avHtml}</div>
      <div class="tg-notif-body">
        <div class="tg-notif-title">${esc(title)}</div>
        <div class="tg-notif-sub">${esc(body)}</div>
      </div>
      <button type="button" class="tg-notif-close" title="Закрыть">✕</button>
    `;
    card.querySelector('.tg-notif-close').onclick = (e) => {
      e.stopPropagation();
      card.remove();
    };
    card.onclick = () => {
      card.remove();
      if (typeof onClick === 'function') onClick();
    };
    container.appendChild(card);
    while (container.children.length > 3) {
      container.firstElementChild.remove();
    }
    setTimeout(() => {
      if (card.parentNode) card.remove();
    }, 6000);
  }

  function triggerAppNotification({ title, body, user, onClick, data = {}, kind = 'message', forceSystem = false }) {
    playNotificationSound(kind);
    showTelegramTopCard({ title, body, user, onClick });

    if ('Notification' in window && Notification.permission === 'granted') {
      if (forceSystem || document.hidden || !document.hasFocus()) {
        const opts = {
          body,
          tag: data.tag || 'ravelampa-' + Date.now(),
          data,
          renotify: true
        };
        if (swRegistration && typeof swRegistration.showNotification === 'function') {
          swRegistration.showNotification(title, opts).catch(() => {
            try { new Notification(title, opts); } catch {}
          });
        } else {
          try {
            const n = new Notification(title, opts);
            n.onclick = () => {
              window.focus();
              n.close();
              if (typeof onClick === 'function') onClick();
            };
          } catch {}
        }
      }
    }
  }

  // ================= VIEW NAVIGATION =================
  function switchView(viewName) {
    state.currentView = viewName;
    document.querySelectorAll('.view-page').forEach(p => p.classList.remove('active'));
    const target = $(`view-${viewName}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // Show "Return to Room" pill in topbar if user is in a room but browsing catalog/friends
    const returnBtn = $('returnToRoomBtn');
    if (state.room && viewName !== 'room') {
      returnBtn.classList.remove('hidden');
    } else {
      returnBtn.classList.add('hidden');
    }

    if (viewName === 'rooms') loadPublicRooms();
    if (viewName === 'friends') loadFriends();
    if (viewName === 'saved') renderSavedGrid();
  }

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.goto));
  });

  $('brandLogo').addEventListener('click', () => switchView('explore'));
  $('returnToRoomBtn').addEventListener('click', () => switchView('room'));

  // Modal close handlers
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => $(btn.dataset.close).classList.add('hidden'));
  });
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.add('hidden');
    });
  });

  // ================= AUTH & PROFILE =================
  let authMode = 'login';
  let pendingAvatarUrl = null; // null = unchanged, '' = removed, 'data:image/...' = new photo

  function updateHeaderUser() {
    if (state.user) {
      setAvatarElement($('headerUserAvatar'), state.user, '🦊');
      $('headerUserName').textContent = state.user.displayName;
    } else {
      $('headerUserAvatar').textContent = '👤';
      $('headerUserAvatar').style.background = '#7c5cff';
      $('headerUserName').textContent = 'Войти';
    }
  }

  function applyServerUserData(data) {
    state.token = data.token || state.token || '';
    state.user = data.user || null;
    state.bookmarks = data.bookmarks || [];
    state.history = data.history || [];
    state.progress = data.progress || {};
    if (state.user?.settings?.proxyMode) {
      state.proxyMode = state.user.settings.proxyMode;
      const labels = { auto: '⚡ Прокси: Авто', always: '🛡️ Прокси: Вкл', off: '🌐 Прокси: Выкл' };
      const btnSpan = $('toggleProxyStreamBtn')?.querySelector('span');
      if (btnSpan && labels[state.proxyMode]) btnSpan.textContent = labels[state.proxyMode];
    }
    updateHeaderUser();
    updateNotificationBellUi();
    if (state.token) {
      socket.emit('auth:identify', { token: state.token });
    }
  }

  async function initAuth() {
    try {
      // Remove any legacy browser cache token so only server session is used
      try { localStorage.removeItem('ravelampa_token'); } catch {}
      const data = await api('/api/auth/me');
      applyServerUserData(data);
      loadFriends();
    } catch {
      state.token = '';
      state.user = null;
      updateHeaderUser();
    }
  }

  function populateProfileStats(user) {
    const st = user?.stats || {};
    $('statWatchTime').textContent = formatWatchTime(st.watchSeconds || 0);
    const watchedTotal = (st.moviesWatched || 0) + (st.episodesWatched || 0) || (st.historyCount || state.history.length || 0);
    $('statWatchedCount').textContent = watchedTotal;
    $('statRoomsCreated').textContent = st.roomsCreated || 0;
    $('statMessagesSent').textContent = st.messagesSent || 0;
    $('statReactionsSent').textContent = st.reactionsSent || 0;
    const friendsCnt = st.friendsCount ?? state.friends.length ?? 0;
    const bmCnt = st.bookmarksCount ?? state.bookmarks.length ?? 0;
    $('statSocialCount').textContent = `${friendsCnt} / ${bmCnt}`;
  }

  async function openAuthModal() {
    const modal = $('authModal');
    modal.classList.remove('hidden');
    if (state.user) {
      $('authGuestView').classList.add('hidden');
      $('authProfileView').classList.remove('hidden');
      pendingAvatarUrl = null;
      setAvatarElement($('profileBigAvatar'), state.user, '🦊');
      $('removePhotoBtn').classList.toggle('hidden', !state.user.avatarUrl);
      $('profileUsernameTag').textContent = `@${state.user.username}`;
      $('profileDisplayName').value = state.user.displayName || '';
      $('profileBio').value = state.user.bio || '';

      document.querySelectorAll('#profileAvatarPicker .av-pick').forEach(b => {
        b.classList.toggle('selected', b.dataset.av === state.user.avatar);
      });
      document.querySelectorAll('#profileColorPicker .color-swatch').forEach(sw => {
        sw.classList.toggle('selected', sw.dataset.color === (state.user.color || '#7c5cff'));
      });

      populateProfileStats(state.user);
      // Refresh latest stats from server in background
      try {
        const fresh = await api('/api/auth/me');
        if (fresh.user) {
          state.user = fresh.user;
          populateProfileStats(state.user);
        }
      } catch {}
    } else {
      $('authGuestView').classList.remove('hidden');
      $('authProfileView').classList.add('hidden');
    }
  }

  $('userMenuBtn').addEventListener('click', openAuthModal);

  // Custom photo upload with client-side square crop & compression (160x160 JPEG)
  $('uploadPhotoBtn').addEventListener('click', () => {
    $('profilePhotoInput').click();
  });

  $('profilePhotoInput').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 160;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        pendingAvatarUrl = dataUrl;
        $('profileBigAvatar').innerHTML = `<img class="avatar-img" src="${esc(dataUrl)}" alt="" />`;
        $('removePhotoBtn').classList.remove('hidden');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  $('removePhotoBtn').addEventListener('click', () => {
    pendingAvatarUrl = '';
    const selectedEmoji = document.querySelector('#profileAvatarPicker .av-pick.selected')?.dataset.av || state.user?.avatar || '🦊';
    $('profileBigAvatar').textContent = selectedEmoji;
    $('removePhotoBtn').classList.add('hidden');
  });

  $('profileColorPicker').addEventListener('click', (e) => {
    const sw = e.target.closest('.color-swatch');
    if (!sw) return;
    document.querySelectorAll('#profileColorPicker .color-swatch').forEach(b => b.classList.remove('selected'));
    sw.classList.add('selected');
    $('profileBigAvatar').style.background = sw.dataset.color;
  });

  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      authMode = tab.dataset.atab;
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
      const isReg = authMode === 'register';
      $('authDisplayNameGroup').style.display = isReg ? 'flex' : 'none';
      $('authAvatarGroup').style.display = isReg ? 'flex' : 'none';
      $('authSubmitBtn').textContent = isReg ? 'Создать аккаунт' : 'Войти';
      $('authError').classList.add('hidden');
    });
  });

  document.querySelectorAll('.avatar-picker').forEach(picker => {
    picker.addEventListener('click', (e) => {
      const btn = e.target.closest('.av-pick');
      if (!btn) return;
      picker.querySelectorAll('.av-pick').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (picker.id === 'profileAvatarPicker' && (pendingAvatarUrl === '' || (!pendingAvatarUrl && !state.user?.avatarUrl))) {
        $('profileBigAvatar').textContent = btn.dataset.av;
      }
    });
  });

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('authError');
    errEl.classList.add('hidden');
    const username = $('authUsername').value.trim();
    const password = $('authPassword').value;
    const displayName = $('authDisplayName').value.trim();
    const selectedAv = document.querySelector('#registerAvatarPicker .av-pick.selected')?.dataset.av || '🦊';

    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const data = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ username, password, displayName, avatar: selectedAv })
      });
      applyServerUserData(data);
      $('authModal').classList.add('hidden');
      showToast(`Привет, ${state.user.displayName}!`);
      loadFriends();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = $('profileDisplayName').value.trim();
    const bio = $('profileBio').value.trim();
    const avatar = document.querySelector('#profileAvatarPicker .av-pick.selected')?.dataset.av || state.user.avatar;
    const color = document.querySelector('#profileColorPicker .color-swatch.selected')?.dataset.color || state.user.color || '#7c5cff';
    const payload = { displayName, bio, avatar, color };
    if (pendingAvatarUrl !== null) {
      payload.avatarUrl = pendingAvatarUrl;
    }
    try {
      const data = await api('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      state.user = data.user;
      updateHeaderUser();
      if (state.token) socket.emit('auth:identify', { token: state.token });
      $('authModal').classList.add('hidden');
      showToast('Профиль обновлён');
    } catch (err) {
      showToast(err.message);
    }
  });

  // Public User Card Modal (inspect any user's profile & stats)
  async function openUserCard(userId) {
    if (!userId) return;
    if (state.user && userId === state.user.id) {
      openAuthModal();
      return;
    }
    try {
      const data = await api(`/api/users/${encodeURIComponent(userId)}`);
      const u = data.user;
      if (!u) return;
      setAvatarElement($('ucAvatar'), u, '🦊');
      $('ucDisplayName').textContent = u.displayName;
      $('ucUsername').textContent = `@${u.username}`;
      $('ucBio').textContent = u.bio || 'Смотрит фильмы в RaveLampa 🍿';
      const st = u.stats || {};
      $('ucStatsGrid').innerHTML = `
        <div class="stat-card"><div class="stat-val">${esc(formatWatchTime(st.watchSeconds || 0))}</div><div class="stat-label">⏱️ В просмотре</div></div>
        <div class="stat-card"><div class="stat-val">${(st.moviesWatched || 0) + (st.episodesWatched || 0)}</div><div class="stat-label">🎬 Просмотрено</div></div>
        <div class="stat-card"><div class="stat-val">${st.roomsCreated || 0}</div><div class="stat-label">🎉 Комнат</div></div>
        <div class="stat-card"><div class="stat-val">${st.messagesSent || 0}</div><div class="stat-label">💬 Сообщений</div></div>
        <div class="stat-card"><div class="stat-val">${st.reactionsSent || 0}</div><div class="stat-label">🔥 Реакций</div></div>
        <div class="stat-card"><div class="stat-val">${st.friendsCount || 0}</div><div class="stat-label">👥 Друзей</div></div>
      `;
      $('userCardModal').classList.remove('hidden');
    } catch {}
  }

  $('logoutBtn').addEventListener('click', async () => {
    if (state.room) leaveRoom();
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    state.token = '';
    state.user = null;
    state.bookmarks = [];
    state.history = [];
    state.progress = {};
    updateHeaderUser();
    $('authModal').classList.add('hidden');
    showToast('Вы вышли из аккаунта');
  });

  async function ensureAuthenticated() {
    if (state.user) return true;
    openAuthModal();
    showToast('Войдите или зарегистрируйтесь за пару секунд');
    return false;
  }

  // ================= CATALOG (LAMPA x TMDB) =================
  async function loadCatalog(reset = true) {
    $('heroBanner').classList.toggle('hidden', !!state.searchQuery);
    if (reset) {
      state.page = 1;
      $('catalogGrid').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">Загрузка каталога...</div>';
    }
    try {
      let data;
      if (state.searchQuery) {
        data = await api(`/api/catalog/search?q=${encodeURIComponent(state.searchQuery)}&page=${state.page}`);
      } else {
        data = await api(`/api/catalog/feed?category=${encodeURIComponent(state.category)}&page=${state.page}`);
      }

      const items = data.results || [];
      if (reset) {
        $('catalogGrid').innerHTML = '';
        if (items.length > 0 && !state.searchQuery && state.page === 1) {
          setHeroMovie(items[0]);
        }
      }
      renderPosterCards(items, $('catalogGrid'), false);
      $('loadMoreCatalogBtn').classList.toggle('hidden', state.page >= (data.total_pages || 1) || items.length === 0);
    } catch (e) {
      if (reset) {
        $('catalogGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">Ошибка загрузки: ${esc(e.message)}</div>`;
      }
    }
  }

  function setHeroMovie(movie) {
    if (!movie) return;
    state.heroMovie = movie;
    $('heroBackdrop').style.backgroundImage = `url('${movie.backdrop || movie.poster}')`;
    $('heroType').textContent = movie.type === 'tv' ? 'Сериал' : 'Фильм';
    $('heroRating').textContent = movie.vote_average ? `★ ${movie.vote_average}` : '★ Новинка';
    $('heroYear').textContent = movie.year || '';
    $('heroTitle').textContent = movie.title;
  }

  $('heroWatchPartyBtn').addEventListener('click', () => {
    if (state.heroMovie) startRoomWithMovie(state.heroMovie, true);
  });
  $('heroDetailsBtn').addEventListener('click', () => {
    if (state.heroMovie) openMovieModal(state.heroMovie);
  });

  function renderPosterCards(items, container, clear = true) {
    if (clear) container.innerHTML = '';
    if (!items.length && clear) {
      container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">Пока пусто</div>';
      return;
    }

    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'poster-card';
      const posterUrl = item.poster || item.backdrop || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="%23171a29"/></svg>';
      card.innerHTML = `
        <div class="poster-art">
          <img src="${esc(posterUrl)}" loading="lazy" alt="${esc(item.title)}" />
          ${item.vote_average ? `<span class="poster-rating">★ ${esc(item.vote_average)}</span>` : ''}
          <span class="poster-type">${item.type === 'tv' ? 'Сериал' : 'Фильм'}</span>
          <div class="poster-play-hover">
            <div class="poster-play-circle">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
        </div>
        <div class="poster-title">${esc(item.title)}</div>
        <div class="poster-sub">${esc(item.year || '')}</div>
      `;
      card.addEventListener('click', () => openMovieModal(item));
      container.appendChild(card);
    }
  }

  // Category bar
  document.querySelectorAll('#categoryBar .cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#categoryBar .cat-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.category = pill.dataset.cat;
      state.searchQuery = '';
      $('globalSearchInput').value = '';
      $('clearSearchBtn').classList.add('hidden');
      loadCatalog(true);
    });
  });

  $('loadMoreCatalogBtn').addEventListener('click', () => {
    state.page++;
    loadCatalog(false);
  });

  // Global search
  let searchTimer = null;
  const searchInput = $('globalSearchInput');
  const clearSearchBtn = $('clearSearchBtn');
  const mainTopbar = $('mainTopbar');

  searchInput.addEventListener('focus', () => {
    mainTopbar.classList.add('search-focused');
    clearSearchBtn.classList.remove('hidden');
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      mainTopbar.classList.remove('search-focused');
      clearSearchBtn.classList.toggle('hidden', !searchInput.value.trim());
    }, 180);
  });

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    clearSearchBtn.classList.toggle('hidden', !val && document.activeElement !== searchInput);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = val;
      if (state.currentView !== 'explore') switchView('explore');
      loadCatalog(true);
    }, 350);
  });

  $('globalSearchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    const val = searchInput.value.trim();
    state.searchQuery = val;
    if (state.currentView !== 'explore') switchView('explore');
    loadCatalog(true);
    searchInput.blur();
  });

  clearSearchBtn.addEventListener('click', (e) => {
    e.preventDefault();
    searchInput.value = '';
    mainTopbar.classList.remove('search-focused');
    clearSearchBtn.classList.add('hidden');
    if (state.searchQuery) {
      state.searchQuery = '';
      loadCatalog(true);
    }
    searchInput.blur();
  });

  // ================= MOVIE MODAL =================
  async function openMovieModal(movie) {
    state.selectedMovie = movie;
    $('modalBackdrop').style.backgroundImage = `url('${movie.backdrop || movie.poster || ''}')`;
    $('modalPoster').src = movie.poster || movie.backdrop || '';
    $('modalType').textContent = movie.type === 'tv' ? 'Сериал' : 'Фильм';
    $('modalRating').textContent = movie.vote_average ? `★ ${movie.vote_average}` : '★ —';
    $('modalYear').textContent = movie.year || '';
    $('modalTitle').textContent = movie.title;
    $('modalOrigTitle').textContent = movie.original_title && movie.original_title !== movie.title ? movie.original_title : '';
    $('modalOverview').textContent = movie.overview || 'Описание скоро появится.';

    const isBookmarked = state.bookmarks.some(m => String(m.id) === String(movie.id));
    $('modalBookmarkBtn').textContent = isBookmarked ? '✅ В закладках' : '🔖 В закладки';

    $('modalPlayInCurrentRoomBtn').classList.toggle('hidden', !state.room);
    $('movieModal').classList.remove('hidden');

    // Enrich details in background (imdb_id, kinopoisk_id)
    try {
      const det = await api(`/api/catalog/details?id=${encodeURIComponent(movie.id)}&type=${encodeURIComponent(movie.type || 'movie')}`);
      if (det.movie && state.selectedMovie && String(state.selectedMovie.id) === String(movie.id)) {
        state.selectedMovie = det.movie;
        if (det.movie.overview) $('modalOverview').textContent = det.movie.overview;
      }
    } catch {}
  }

  $('modalStartPublicRoomBtn').addEventListener('click', () => {
    if (!state.selectedMovie) return;
    $('movieModal').classList.add('hidden');
    startRoomWithMovie(state.selectedMovie, true);
  });

  $('modalStartPrivateRoomBtn').addEventListener('click', () => {
    if (!state.selectedMovie) return;
    $('movieModal').classList.add('hidden');
    startRoomWithMovie(state.selectedMovie, false);
  });

  $('modalPlayInCurrentRoomBtn').addEventListener('click', async () => {
    if (!state.selectedMovie || !state.room) return;
    $('movieModal').classList.add('hidden');
    switchView('room');
    await loadZ01ForMovieInRoom(state.selectedMovie, true);
  });

  $('modalBookmarkBtn').addEventListener('click', async () => {
    if (!(await ensureAuthenticated()) || !state.selectedMovie) return;
    try {
      const res = await api('/api/bookmarks/toggle', {
        method: 'POST',
        body: JSON.stringify({ movie: state.selectedMovie })
      });
      state.bookmarks = res.bookmarks || [];
      $('modalBookmarkBtn').textContent = res.added ? '✅ В закладках' : '🔖 В закладки';
      showToast(res.added ? 'Добавлено в закладки' : 'Удалено из закладок');
    } catch (e) {
      showToast(e.message);
    }
  });

  // Saved Tab (Bookmarks & History)
  function renderSavedGrid() {
    const list = state.savedTab === 'bookmarks' ? state.bookmarks : state.history.map(h => h.movie).filter(Boolean);
    renderPosterCards(list, $('savedGrid'), true);
  }

  document.querySelectorAll('[data-saved-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-saved-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.savedTab = btn.dataset.savedTab;
      renderSavedGrid();
    });
  });

  // ================= ROOMS & WATCH PARTY ENGINE =================
  async function loadPublicRooms() {
    try {
      const data = await api('/api/rooms');
      renderPublicRooms(data.rooms || []);
    } catch {}
  }

  function renderPublicRooms(roomsList) {
    state.publicRooms = roomsList;
    const badge = $('publicRoomsBadge');
    if (roomsList.length > 0) {
      badge.textContent = roomsList.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    // 1. Live strip on Explore page
    const stripWrap = $('liveRoomsStripWrap');
    const strip = $('liveRoomsStrip');
    if (roomsList.length > 0) {
      stripWrap.classList.remove('hidden');
      strip.innerHTML = '';
      roomsList.slice(0, 8).forEach(r => strip.appendChild(createRoomCardEl(r)));
    } else {
      stripWrap.classList.add('hidden');
    }

    // 2. Full Rooms Grid
    const grid = $('publicRoomsGrid');
    grid.innerHTML = '';
    if (roomsList.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--text-muted);">Сейчас нет открытых комнат. Выберите любой фильм в каталоге или нажмите «+ Создать комнату»!</div>';
      return;
    }
    roomsList.forEach(r => grid.appendChild(createRoomCardEl(r)));
  }

  function createRoomCardEl(r) {
    const el = document.createElement('div');
    el.className = 'room-card';
    const bannerImg = r.media?.backdrop || r.media?.poster || '';
    const avatarsHtml = (r.participants || []).slice(0, 5).map(p => `<span title="${esc(p.displayName)}" style="background:${esc(p.color || 'var(--bg-elevated)')}">${avatarInnerHtml(p)}</span>`).join('');
    const epInfo = r.media?.season && r.media?.episode ? ` · S${r.media.season}E${r.media.episode}` : '';
    const subInfo = r.media?.title ? `${r.media.title}${epInfo}` : 'Выбирают фильм...';

    el.innerHTML = `
      <div class="room-card-banner" style="${bannerImg ? `background-image:url('${esc(bannerImg)}')` : ''}">
        <span class="room-live-pill">LIVE · ${r.participantCount || 1}</span>
      </div>
      <div class="room-card-body">
        <div class="room-card-title">${esc(r.name)}</div>
        <div class="room-card-sub">${esc(subInfo)}</div>
        <div class="room-card-users">
          <div class="avatar-stack">${avatarsHtml}</div>
          <span class="badge tiny accent">Войти →</span>
        </div>
      </div>
    `;
    el.addEventListener('click', () => joinRoomByCode(r.code));
    return el;
  }

  async function startRoomWithMovie(movie, isPublic = true) {
    if (!(await ensureAuthenticated())) return;
    try {
      const initialMedia = {
        type: 'z01',
        title: movie.title,
        poster: movie.poster,
        backdrop: movie.backdrop,
        movie: movie,
        streamUrl: '',
        streamType: 'hls'
      };
      const res = await api('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: movie.title,
          isPublic,
          media: initialMedia
        })
      });
      await joinRoomByCode(res.room.code);
    } catch (e) {
      showToast(e.message);
    }
  }

  $('createCustomRoomBtn').addEventListener('click', async () => {
    if (!(await ensureAuthenticated())) return;
    try {
      const res = await api('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: `Комната ${state.user.displayName}`,
          isPublic: true
        })
      });
      await joinRoomByCode(res.room.code);
    } catch (e) {
      showToast(e.message);
    }
  });

  async function joinRoomByCode(code) {
    if (!(await ensureAuthenticated())) return;
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return;
    if (socket.connected) {
      socket.emit('room:join', { code: clean, token: state.token });
    } else {
      try {
        const res = await api(`/api/rooms/${encodeURIComponent(clean)}/join`, { method: 'POST' });
        if (res.room) handleRoomJoined(res.room);
      } catch (e) {
        showToast(e.message);
      }
    }
  }

  function leaveRoom() {
    const prevCode = state.room?.code;
    stopVoiceChat();
    destroyPlayers();
    socket.emit('room:leave');
    if (prevCode && !socket.connected) {
      api(`/api/rooms/${encodeURIComponent(prevCode)}/leave`, { method: 'POST' }).catch(() => {});
    }
    state.room = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
    switchView('explore');
  }

  $('leaveRoomBtn').addEventListener('click', leaveRoom);

  $('copyRoomCodeBtn').addEventListener('click', () => {
    if (!state.room) return;
    const shareUrl = `${window.location.origin}/?room=${state.room.code}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast(`Ссылка скопирована! Код: ${state.room.code}`);
    }).catch(() => {
      showToast(`Код комнаты: ${state.room.code}`);
    });
  });

  $('joinByCodeBtn').addEventListener('click', () => {
    $('joinCodeModal').classList.remove('hidden');
    $('joinCodeInput').focus();
  });

  $('joinCodeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('joinCodeInput').value.trim().toUpperCase();
    if (!code) return;
    $('joinCodeModal').classList.add('hidden');
    $('joinCodeInput').value = '';
    joinRoomByCode(code);
  });

  // Custom link (YouTube / MP4 / M3U8)
  function openCustomLinkModal() {
    $('customLinkModal').classList.remove('hidden');
    $('customLinkUrl').focus();
  }
  $('customLinkBtn').addEventListener('click', openCustomLinkModal);
  $('openLinkFromRoomBtn').addEventListener('click', openCustomLinkModal);
  $('openCatalogFromRoomBtn').addEventListener('click', () => switchView('explore'));

  function extractYouTubeId(url) {
    const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  $('customLinkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(await ensureAuthenticated())) return;
    const rawUrl = $('customLinkUrl').value.trim();
    const customTitle = $('customLinkTitle').value.trim() || 'Видео по ссылке';
    if (!rawUrl) return;

    const ytId = extractYouTubeId(rawUrl);
    const isHls = /\.m3u8(\?|$)/i.test(rawUrl);
    const media = {
      type: ytId ? 'youtube' : 'direct',
      title: customTitle,
      streamUrl: rawUrl,
      youtubeId: ytId || '',
      streamType: ytId ? 'youtube' : (isHls ? 'hls' : 'mp4')
    };

    $('customLinkModal').classList.add('hidden');
    $('customLinkUrl').value = '';
    $('customLinkTitle').value = '';

    if (state.room) {
      switchView('room');
      socket.emit('room:set_media', { media });
      if (!socket.connected) {
        api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
          method: 'POST',
          body: JSON.stringify({ media })
        }).then(r => {
          if (r.room) {
            state.room = r.room;
            loadMediaIntoPlayer(r.room.media, r.room.playback);
          }
        }).catch(() => {});
      }
    } else {
      const res = await api('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: customTitle, isPublic: true, media })
      });
      await joinRoomByCode(res.room.code);
    }
  });

  // ================= Z01 ONLINE ENGINE IN ROOM =================
  async function loadZ01ForMovieInRoom(movie, autoBroadcastFirstStream = false) {
    if (!movie) return;
    $('z01Panel').classList.remove('hidden');
    setPlayerOverlay(true, true, `Опрашиваем источники Z01 для «${movie.title}»...`);

    state.z01 = {
      movie,
      uid: '',
      sources: [],
      activeSourceKey: '',
      seasons: [],
      activeSeasonIdx: 0,
      voices: [],
      activeVoiceIdx: 0,
      videos: [],
      activeVideoIdx: 0,
      qualities: {},
      activeQuality: '',
      openDropdown: ''
    };
    renderZ01Panel();

    try {
      const data = await api('/api/z01/sources', {
        method: 'POST',
        body: JSON.stringify({ movie })
      });
      state.z01.movie = data.movie || movie;
      state.z01.uid = data.uid || '';
      state.z01.sources = data.sources || [];

      const shownSources = state.z01.sources.filter(s => s.show);
      const firstSource = shownSources[0] || state.z01.sources[0];
      if (!firstSource) {
        setPlayerOverlay(true, false, 'Источники Z01 не найдены для этого названия');
        renderZ01Panel();
        return;
      }

      // If room already has a selected balancer (or user has saved server-side progress), prefer it
      const savedProg = state.progress?.[String(movie.id)];
      const preferredKey = state.room?.media?.balancerKey || savedProg?.balancerKey;
      const targetSource = state.z01.sources.find(s => s.key === preferredKey) || firstSource;
      await selectZ01Balancer(targetSource.key, autoBroadcastFirstStream);
    } catch (e) {
      setPlayerOverlay(true, false, `Ошибка Z01: ${e.message}`);
    }
  }

  async function selectZ01Balancer(sourceKey, autoPlay = true) {
    const src = state.z01.sources.find(s => s.key === sourceKey);
    if (!src) return;

    state.z01.activeSourceKey = src.key;
    state.z01.openDropdown = '';
    setPlayerOverlay(true, true, `Загрузка «${src.name}»...`);
    renderZ01Panel();

    try {
      const bData = await api('/api/z01/balancer', {
        method: 'POST',
        body: JSON.stringify({
          url: src.url,
          movie: state.z01.movie,
          uid: state.z01.uid
        })
      });

      if (bData.error || (!bData.videos?.length)) {
        // Auto-try next active balancer if this one returned RCH or empty!
        const nextCandidate = state.z01.sources.find(
          s => s.show && s.key !== src.key && !s._tried
        );
        src._tried = true;
        if (nextCandidate) {
          showToast(`Источник ${src.name} пуст, переключаем на ${nextCandidate.name}...`);
          return selectZ01Balancer(nextCandidate.key, autoPlay);
        }
        setPlayerOverlay(true, false, bData.error || `Источник ${src.name} не вернул видео. Выберите другой источник.`);
        renderZ01Panel();
        return;
      }

      state.z01.seasons = bData.seasons || [];
      state.z01.voices = bData.voices || [];
      state.z01.videos = bData.videos || [];
      state.z01.activeSeasonIdx = Math.max(0, state.z01.seasons.findIndex(s => s.active));
      state.z01.activeVoiceIdx = Math.max(0, state.z01.voices.findIndex(v => v.active));
      state.z01.activeVideoIdx = 0;

      renderZ01Panel();

      if (autoPlay && state.z01.videos[0]) {
        await selectZ01VideoItem(0, true);
      } else {
        setPlayerOverlay(false, false, '');
      }
    } catch (e) {
      setPlayerOverlay(true, false, `Ошибка балансера ${src.name}: ${e.message}`);
    }
  }

  async function queryZ01SubUrl(url, type, index) {
    state.z01.openDropdown = '';
    setPlayerOverlay(true, true, 'Обновляем список...');
    try {
      const bData = await api('/api/z01/balancer', {
        method: 'POST',
        body: JSON.stringify({
          url,
          movie: state.z01.movie,
          uid: state.z01.uid
        })
      });
      if (bData.seasons?.length) state.z01.seasons = bData.seasons;
      if (bData.voices?.length) state.z01.voices = bData.voices;
      if (bData.videos?.length) state.z01.videos = bData.videos;

      if (type === 'season') state.z01.activeSeasonIdx = index;
      if (type === 'voice') state.z01.activeVoiceIdx = index;
      state.z01.activeVideoIdx = 0;

      renderZ01Panel();
      if (state.z01.videos[0]) {
        await selectZ01VideoItem(0, true);
      }
    } catch (e) {
      showToast(e.message);
      setPlayerOverlay(false, false, '');
    }
  }

  async function selectZ01VideoItem(videoIndex, broadcastToRoom = true) {
    const item = state.z01.videos[videoIndex];
    if (!item) return;
    state.z01.activeVideoIdx = videoIndex;
    renderZ01Panel();

    setPlayerOverlay(true, true, 'Извлекаем поток видео...');
    try {
      const resolved = await api('/api/z01/resolve', {
        method: 'POST',
        body: JSON.stringify({
          url: item.url,
          method: item.method,
          headers: item.headers,
          qualities: item.qualities,
          subtitles: item.subtitles,
          uid: state.z01.uid
        })
      });

      state.z01.qualities = resolved.proxiedQualities || {};
      const qKeys = Object.keys(state.z01.qualities);
      state.z01.activeQuality = qKeys[0] || item.quality || 'Auto';
      renderZ01Panel();

      const activeSource = state.z01.sources.find(s => s.key === state.z01.activeSourceKey);
      const streamUrl = pickStreamUrl(resolved);

      const newMedia = {
        type: 'z01',
        title: state.z01.movie?.title || item.title,
        poster: state.z01.movie?.poster || '',
        backdrop: state.z01.movie?.backdrop || '',
        movie: state.z01.movie,
        balancerKey: state.z01.activeSourceKey,
        balancerName: activeSource ? activeSource.name : state.z01.activeSourceKey,
        season: item.season || (state.z01.seasons[state.z01.activeSeasonIdx] ? state.z01.activeSeasonIdx + 1 : 0),
        episode: item.episode || 0,
        voiceName: item.voice_name || (state.z01.voices[state.z01.activeVoiceIdx]?.title) || '',
        quality: state.z01.activeQuality,
        rawUrl: resolved.url,
        proxyUrl: resolved.proxyUrl,
        recommendedUrl: resolved.recommendedUrl,
        streamUrl,
        streamType: resolved.streamType || 'hls',
        subtitles: resolved.subtitles || []
      };

      // Save to user watch history on server
      if (state.user && state.z01.movie) {
        api('/api/history', {
          method: 'POST',
          body: JSON.stringify({
            movie: state.z01.movie,
            balancerKey: newMedia.balancerKey,
            balancer: newMedia.balancerName,
            season: newMedia.season,
            episode: newMedia.episode,
            voiceName: newMedia.voiceName
          })
        }).then(r => {
          if (r.history) state.history = r.history;
          if (r.progress) state.progress = r.progress;
        }).catch(() => {});
      }

      if (broadcastToRoom && state.room) {
        socket.emit('room:set_media', { media: newMedia });
        if (!socket.connected) {
          api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
            method: 'POST',
            body: JSON.stringify({ media: newMedia })
          }).catch(() => {});
          loadMediaIntoPlayer(newMedia, { playing: true, currentTime: 0 });
        }
      } else {
        loadMediaIntoPlayer(newMedia, { playing: true, currentTime: 0 });
      }
    } catch (e) {
      setPlayerOverlay(true, false, `Ошибка потока: ${e.message}. Попробуйте другой источник Z01.`);
    }
  }

  function pickStreamUrl(mediaOrResolved) {
    if (!mediaOrResolved) return '';
    if (state.proxyMode === 'always' && mediaOrResolved.proxyUrl) return mediaOrResolved.proxyUrl;
    if (state.proxyMode === 'off' && mediaOrResolved.rawUrl) return mediaOrResolved.rawUrl;
    return mediaOrResolved.recommendedUrl || mediaOrResolved.streamUrl || mediaOrResolved.rawUrl || '';
  }

  function renderZ01Panel() {
    const segBox = $('z01Segments');
    const dropGrid = $('z01DropdownGrid');
    const epStrip = $('z01EpisodesStrip');
    segBox.innerHTML = '';
    dropGrid.innerHTML = '';

    const { sources, activeSourceKey, seasons, activeSeasonIdx, voices, activeVoiceIdx, videos, activeVideoIdx, qualities, activeQuality, openDropdown } = state.z01;

    if (!sources.length) {
      dropGrid.classList.add('hidden');
      epStrip.classList.add('hidden');
      return;
    }

    const activeSrc = sources.find(s => s.key === activeSourceKey) || sources[0];

    const addSegment = (key, label, value, badge = '') => {
      const seg = document.createElement('div');
      seg.className = `z01-seg ${openDropdown === key ? 'open' : ''}`;
      seg.innerHTML = `
        <span class="z01-seg-label">${esc(label)}</span>
        <div class="z01-seg-val">
          ${badge ? `<span class="z01-tag">${esc(badge)}</span>` : ''}
          <span>${esc(value)}</span>
        </div>
      `;
      seg.addEventListener('click', () => {
        state.z01.openDropdown = state.z01.openDropdown === key ? '' : key;
        renderZ01Panel();
      });
      segBox.appendChild(seg);
    };

    // 1. Balancer segment
    addSegment('source', 'Источник Z01', activeSrc ? activeSrc.name : 'Выбрать', activeSrc?.badge || '');

    // 2. Season segment (if series)
    if (seasons.length > 1) {
      const curS = seasons[activeSeasonIdx] || seasons[0];
      addSegment('season', 'Сезон', curS.title);
    }

    // 3. Voice segment
    if (voices.length > 1) {
      const curV = voices[activeVoiceIdx] || voices[0];
      addSegment('voice', 'Озвучка', curV.title, curV.groupTitle);
    } else if (videos.length > 1 && !seasons.length && ! videos[0]?.episode) {
      // Movie with multiple voice items inside videos
      const curItem = videos[activeVideoIdx] || videos[0];
      addSegment('movie_voice', 'Перевод', curItem.voice_name || curItem.title, curItem.quality);
    }

    // 4. Quality segment
    const qKeys = Object.keys(qualities || {});
    if (qKeys.length > 1) {
      addSegment('quality', 'Качество', activeQuality || qKeys[0]);
    }

    // Populate Dropdown Grid if open
    if (openDropdown === 'source') {
      dropGrid.classList.remove('hidden');
      sources.forEach(s => {
        const btn = document.createElement('button');
        btn.className = `z01-opt ${s.key === activeSourceKey ? 'active' : ''}`;
        btn.innerHTML = `
          <div class="z01-opt-title">${s.badge ? `<span class="z01-tag">${esc(s.badge)}</span> ` : ''}${esc(s.name)}</div>
          <div class="z01-opt-note">${s.show ? '🟢 Онлайн' : '⚪ Доп. источник'}</div>
        `;
        btn.onclick = () => selectZ01Balancer(s.key, true);
        dropGrid.appendChild(btn);
      });
    } else if (openDropdown === 'season') {
      dropGrid.classList.remove('hidden');
      seasons.forEach((s, idx) => {
        const btn = document.createElement('button');
        btn.className = `z01-opt ${idx === activeSeasonIdx ? 'active' : ''}`;
        btn.innerHTML = `<div class="z01-opt-title">${esc(s.title)}</div>`;
        btn.onclick = () => queryZ01SubUrl(s.url, 'season', idx);
        dropGrid.appendChild(btn);
      });
    } else if (openDropdown === 'voice') {
      dropGrid.classList.remove('hidden');
      voices.forEach((v, idx) => {
        const btn = document.createElement('button');
        btn.className = `z01-opt ${idx === activeVoiceIdx ? 'active' : ''}`;
        btn.innerHTML = `
          <div class="z01-opt-title">${esc(v.title)}</div>
          <div class="z01-opt-note">${esc(v.groupTitle || '')}</div>
        `;
        btn.onclick = () => queryZ01SubUrl(v.url, 'voice', idx);
        dropGrid.appendChild(btn);
      });
    } else if (openDropdown === 'movie_voice') {
      dropGrid.classList.remove('hidden');
      videos.forEach((v, idx) => {
        const btn = document.createElement('button');
        btn.className = `z01-opt ${idx === activeVideoIdx ? 'active' : ''}`;
        btn.innerHTML = `
          <div class="z01-opt-title">${esc(v.voice_name || v.title)}</div>
          <div class="z01-opt-note">${esc(v.quality || '')}</div>
        `;
        btn.onclick = () => {
          state.z01.openDropdown = '';
          selectZ01VideoItem(idx, true);
        };
        dropGrid.appendChild(btn);
      });
    } else if (openDropdown === 'quality') {
      dropGrid.classList.remove('hidden');
      qKeys.forEach(qk => {
        const btn = document.createElement('button');
        btn.className = `z01-opt ${qk === activeQuality ? 'active' : ''}`;
        btn.innerHTML = `<div class="z01-opt-title">${esc(qk)}</div>`;
        btn.onclick = () => {
          state.z01.activeQuality = qk;
          state.z01.openDropdown = '';
          const qObj = qualities[qk];
          if (qObj && state.room && state.room.media) {
            const currentTime = $('mainVideo').currentTime || 0;
            state.room.media.rawUrl = qObj.raw;
            state.room.media.proxyUrl = qObj.proxy;
            state.room.media.streamUrl = state.proxyMode === 'off' ? qObj.raw : qObj.proxy;
            loadMediaIntoPlayer(state.room.media, { playing: !$('mainVideo').paused, currentTime });
          }
          renderZ01Panel();
        };
        dropGrid.appendChild(btn);
      });
    } else {
      dropGrid.classList.add('hidden');
    }

    // Episodes Strip for TV series
    const isSeriesEpisodes = videos.length > 1 && (seasons.length > 0 || videos.some(v => v.episode > 0));
    if (isSeriesEpisodes) {
      epStrip.classList.remove('hidden');
      epStrip.innerHTML = '';
      videos.forEach((v, idx) => {
        const epBtn = document.createElement('button');
        epBtn.className = `ep-btn ${idx === activeVideoIdx ? 'active' : ''}`;
        const epNum = v.episode || idx + 1;
        epBtn.innerHTML = `
          <span class="ep-num">${epNum < 10 ? '0' + epNum : epNum} серия</span>
          <span class="ep-sub">${esc(v.quality || v.voice_name || '')}</span>
        `;
        epBtn.onclick = () => selectZ01VideoItem(idx, true);
        epStrip.appendChild(epBtn);
      });
    } else {
      epStrip.classList.add('hidden');
    }
  }

  // Proxy Mode Toggle button
  $('toggleProxyStreamBtn').addEventListener('click', () => {
    const modes = ['auto', 'always', 'off'];
    const labels = { auto: '⚡ Прокси: Авто', always: '🛡️ Прокси: Вкл', off: '🌐 Прокси: Выкл' };
    const nextIdx = (modes.indexOf(state.proxyMode) + 1) % modes.length;
    state.proxyMode = modes[nextIdx];
    $('toggleProxyStreamBtn').querySelector('span').textContent = labels[state.proxyMode];

    // Persist proxyMode preference on the server
    if (state.user) {
      api('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ settings: { proxyMode: state.proxyMode } })
      }).catch(() => {});
    }

    if (state.room && state.room.media && state.room.media.rawUrl) {
      const video = $('mainVideo');
      const curTime = video.currentTime || 0;
      const wasPlaying = !video.paused;
      state.room.media.streamUrl = pickStreamUrl(state.room.media);
      loadMediaIntoPlayer(state.room.media, { playing: wasPlaying, currentTime: curTime });
      showToast(`Режим потока: ${labels[state.proxyMode]}`);
    }
  });

  // ================= VIDEO & YOUTUBE PLAYER + SYNC =================
  function setPlayerOverlay(visible, loading = false, text = '') {
    const ov = $('playerEmptyOverlay');
    const sp = $('playerLoadingSpinner');
    const txt = $('playerStatusText');
    ov.classList.toggle('hidden', !visible);
    sp.classList.toggle('hidden', !loading);
    if (text) txt.textContent = text;
  }

  function destroyPlayers() {
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    const video = $('mainVideo');
    video.pause();
    video.removeAttribute('src');
    video.load();
    $('youtubeContainer').innerHTML = '';
    $('youtubeContainer').classList.add('hidden');
    video.classList.remove('hidden');
  }

  function loadMediaIntoPlayer(media, playback = { playing: true, currentTime: 0 }) {
    destroyPlayers();
    $('unmuteSyncBtn').classList.add('hidden');
    if (!media || (!media.streamUrl && !media.youtubeId)) {
      setPlayerOverlay(true, false, 'Выберите фильм из каталога или источник Z01 ниже');
      return;
    }

    setPlayerOverlay(false, false, '');
    const video = $('mainVideo');
    video.controls = true;
    state.justLoadedMediaUntil = Date.now() + 2600;

    const epTag = media.season && media.episode ? ` · Сезон ${media.season}, Серия ${media.episode}` : '';
    const balTag = media.balancerName ? ` [${media.balancerName}]` : '';
    const voiceTag = media.voiceName ? ` · ${media.voiceName}` : '';
    $('roomSubText').textContent = `${media.title || 'Видео'}${epTag}${voiceTag}${balTag}`;

    // Case 1: YouTube
    if (media.streamType === 'youtube' || media.youtubeId) {
      video.classList.add('hidden');
      const ytBox = $('youtubeContainer');
      ytBox.classList.remove('hidden');
      const ytId = media.youtubeId || extractYouTubeId(media.streamUrl);
      const startSec = Math.floor(playback.currentTime || 0);
      ytBox.innerHTML = `<iframe src="https://www.youtube.com/embed/${esc(ytId)}?autoplay=${playback.playing ? 1 : 0}&start=${startSec}&enablejsapi=1&rel=0" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
      return;
    }

    // Case 2: HLS (.m3u8) or MP4 stream
    const streamUrl = pickStreamUrl(media);
    const isHls = media.streamType === 'hls' || /\.m3u8(\?|$)/i.test(streamUrl);

    const tryAutoplaySynced = () => {
      if (!playback.playing) return;
      video.play().then(() => {
        $('unmuteSyncBtn').classList.toggle('hidden', !video.muted);
      }).catch(() => {
        // Browser blocked unmuted autoplay on second device: play muted so video frames stay 100% synced!
        video.muted = true;
        $('unmuteSyncBtn').classList.remove('hidden');
        video.play().catch(() => {
          showToast('Нажмите Play на плеере для синхронного запуска');
        });
      });
    };

    const onLoaded = () => {
      state.suppressSyncEmit = true;
      state.justLoadedMediaUntil = Date.now() + 2200;
      if (playback.currentTime && Math.abs(video.currentTime - playback.currentTime) > 1.0) {
        try { video.currentTime = playback.currentTime; } catch {}
      }
      tryAutoplaySynced();
      setTimeout(() => {
        state.suppressSyncEmit = false;
        // Request fresh timecode from server right after stream buffer initializes
        if (state.room) socket.emit('player:request_sync');
      }, 650);
    };

    if (isHls && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false
      });
      state.hls = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, onLoaded);
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          // Automatic fallback to backend stream proxy if direct stream had a CORS/network/IP error!
          if (media.proxyUrl && streamUrl !== media.proxyUrl) {
            console.log('Direct HLS failed, switching to backend stream proxy...');
            media.recommendedUrl = media.proxyUrl;
            media.streamUrl = media.proxyUrl;
            hls.loadSource(media.proxyUrl);
          }
        }
      });
    } else {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', () => {
        if (media.proxyUrl && video.src !== new URL(media.proxyUrl, window.location.origin).href) {
          media.recommendedUrl = media.proxyUrl;
          media.streamUrl = media.proxyUrl;
          video.src = media.proxyUrl;
          video.load();
        }
      }, { once: true });
    }
  }

  $('unmuteSyncBtn').addEventListener('click', () => {
    const video = $('mainVideo');
    video.muted = false;
    $('unmuteSyncBtn').classList.add('hidden');
    video.play().catch(() => {});
    socket.emit('player:request_sync');
  });

  // Bind HTML5 Video Events for Real-Time Room Synchronization
  const mainVideo = $('mainVideo');

  function emitPlayerSync(action) {
    if (!state.room || state.suppressSyncEmit) return;
    if (!state.room.media || state.room.media.streamType === 'youtube') return;

    // Guard: if this device just loaded the stream at 0:00 while the room is already ahead, request sync instead of resetting room!
    if (Date.now() < state.justLoadedMediaUntil && (mainVideo.currentTime || 0) < 2) {
      socket.emit('player:request_sync');
      return;
    }

    const now = Date.now();
    if (action === 'timeupdate' && now - state.lastSyncAt < 3000) return;
    state.lastSyncAt = now;

    const payload = {
      action,
      playing: !mainVideo.paused,
      currentTime: mainVideo.currentTime || 0,
      rate: mainVideo.playbackRate || 1
    };

    if (socket.connected) {
      socket.emit('player:sync', payload);
    } else {
      api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
        method: 'POST',
        body: JSON.stringify(payload)
      }).catch(() => {});
    }

    // Save playback timecode on the server
    if (state.user && state.room?.media?.movie?.id && mainVideo.currentTime > 5) {
      const m = state.room.media;
      api('/api/user/progress', {
        method: 'POST',
        body: JSON.stringify({
          movieId: m.movie.id,
          balancerKey: m.balancerKey,
          balancerName: m.balancerName,
          season: m.season,
          episode: m.episode,
          voiceName: m.voiceName,
          currentTime: Math.floor(mainVideo.currentTime),
          duration: Math.floor(mainVideo.duration || 0)
        })
      }).then(r => {
        if (r.progress) state.progress[String(m.movie.id)] = r.progress;
      }).catch(() => {});
    }
  }

  mainVideo.addEventListener('play', () => emitPlayerSync('play'));
  mainVideo.addEventListener('pause', () => {
    if (mainVideo.seeking) return;
    emitPlayerSync('pause');
  });
  mainVideo.addEventListener('seeked', () => emitPlayerSync('seek'));
  mainVideo.addEventListener('ratechange', () => emitPlayerSync('rate'));
  mainVideo.addEventListener('volumechange', () => {
    if (!mainVideo.muted) $('unmuteSyncBtn').classList.add('hidden');
  });

  // Periodic 2.5s Heartbeat for tight multi-device sync + watch time stats + Serverless HTTP Room Poll
  setInterval(async () => {
    if (!state.room) return;

    // If running on Vercel Serverless (where WebSockets are disabled), poll room state via HTTP
    if (!socket.connected) {
      try {
        const isHost = state.user && state.room.hostId === state.user.id;
        const body = isHost && state.room.media && state.room.media.streamType !== 'youtube' && !mainVideo.paused
          ? { action: 'heartbeat', playing: true, currentTime: mainVideo.currentTime || 0, rate: mainVideo.playbackRate || 1 }
          : {};
        const res = await api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
          method: 'POST',
          body: JSON.stringify(body)
        });
        if (res.room) {
          const prevMediaUrl = state.room.media?.streamUrl || state.room.media?.youtubeId || '';
          const nextMediaUrl = res.room.media?.streamUrl || res.room.media?.youtubeId || '';
          state.room = res.room;
          renderRoomHeader(res.room);
          renderRoomParticipants(res.room.participants || []);
          syncRoomMessagesFromPoll(res.room.messages || []);
          if (nextMediaUrl && nextMediaUrl !== prevMediaUrl) {
            loadMediaIntoPlayer(res.room.media, res.room.playback);
          } else if (!isHost && res.room.playback) {
            applyRemoteSync(res.room.playback, true);
          }
        }
      } catch {}
      return;
    }

    if (!state.room.media || state.room.media.streamType === 'youtube') return;
    if (mainVideo.paused || state.suppressSyncEmit) return;
    if (Date.now() < state.justLoadedMediaUntil && (mainVideo.currentTime || 0) < 2) return;
    socket.emit('player:heartbeat', {
      playing: !mainVideo.paused,
      currentTime: mainVideo.currentTime || 0,
      rate: mainVideo.playbackRate || 1,
      watchDelta: 2.5
    });
  }, 2500);

  // Serverless HTTP DM poll when in Friends / Room DMs on Vercel
  setInterval(async () => {
    if (socket.connected || !state.user) return;
    const targetFriendId = state.currentView === 'friends' ? activeDmFriendId : (state.currentView === 'room' ? roomActiveDmFriendId : null);
    if (!targetFriendId) return;
    try {
      const data = await api(`/api/dms/${encodeURIComponent(targetFriendId)}`);
      if (data.friend) {
        const idx = state.friends.findIndex(x => x.id === data.friend.id);
        if (idx >= 0) state.friends[idx] = { ...state.friends[idx], ...data.friend };
        if (activeDmFriendId === data.friend.id) updateDmHeader(data.friend);
      }
      syncDmMessagesFromPoll(targetFriendId, data.messages || []);
    } catch {}
  }, 2000);

  $('resyncPlayerBtn').addEventListener('click', async () => {
    if (socket.connected) {
      socket.emit('player:request_sync');
    } else if (state.room) {
      try {
        const res = await api(`/api/rooms/${encodeURIComponent(state.room.code)}`);
        if (res.room?.playback) applyRemoteSync({ ...res.room.playback, action: 'resync' }, false);
      } catch {}
    }
    showToast('Синхронизировано с комнатой');
  });

  function applyRemoteSync(data, isHeartbeat = false) {
    if (!state.room || !state.room.media || state.room.media.streamType === 'youtube') return;
    if (!mainVideo.src && !state.hls) return;

    const targetTime = Number(data.currentTime) || 0;
    const drift = Math.abs((mainVideo.currentTime || 0) - targetTime);
    const threshold = isHeartbeat ? 1.8 : 1.2;

    state.suppressSyncEmit = true;

    if (drift > threshold || data.action === 'seek' || data.action === 'resync') {
      try { mainVideo.currentTime = targetTime; } catch {}
      if (!isHeartbeat && data.actor) {
        showSyncBadge(`${data.actor.avatar || '🍿'} ${data.actor.displayName} перемотал(а)`);
      }
    }

    if (data.rate && mainVideo.playbackRate !== data.rate) {
      mainVideo.playbackRate = data.rate;
    }

    if (data.playing && mainVideo.paused) {
      mainVideo.play().then(() => {
        $('unmuteSyncBtn').classList.toggle('hidden', !mainVideo.muted);
      }).catch(() => {
        mainVideo.muted = true;
        $('unmuteSyncBtn').classList.remove('hidden');
        mainVideo.play().catch(() => {});
      });
      if (!isHeartbeat && data.actor) showSyncBadge(`${data.actor.avatar || '▶️'} ${data.actor.displayName} нажал(а) Play`);
    } else if (!data.playing && !mainVideo.paused && !isHeartbeat) {
      mainVideo.pause();
      if (data.actor) showSyncBadge(`${data.actor.avatar || '⏸️'} ${data.actor.displayName} поставил(а) на паузу`);
    }

    setTimeout(() => { state.suppressSyncEmit = false; }, 450);
  }

  let syncBadgeTimer = null;
  function showSyncBadge(text) {
    const el = $('syncIndicator');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(syncBadgeTimer);
    syncBadgeTimer = setTimeout(() => el.classList.add('hidden'), 2000);
  }

  // ================= SOCKET.IO & ROOM EVENTS =================
  socket.on('rooms:public_list', (list) => {
    renderPublicRooms(list || []);
  });

  socket.on('room:error', ({ error }) => {
    showToast(error || 'Ошибка комнаты');
  });

  async function handleRoomJoined(room) {
    state.room = room;
    switchView('room');
    setMobileRoomTab('chat');

    // Update URL query param so user can share or refresh
    const url = new URL(window.location.href);
    url.searchParams.set('room', room.code);
    window.history.replaceState({}, '', url.toString());

    renderRoomHeader(room);
    renderRoomParticipants(room.participants || []);
    renderRoomMessages(room.messages || []);

    if (room.media) {
      if (room.media.type === 'z01' && room.media.movie) {
        if (room.media.streamUrl) {
          loadMediaIntoPlayer(room.media, room.playback);
          loadZ01ForMovieInRoom(room.media.movie, false);
        } else {
          await loadZ01ForMovieInRoom(room.media.movie, true);
        }
      } else {
        $('z01Panel').classList.add('hidden');
        loadMediaIntoPlayer(room.media, room.playback);
      }
    } else {
      $('z01Panel').classList.add('hidden');
      setPlayerOverlay(true, false, 'Выберите фильм из каталога или вставьте ссылку');
    }
  }

  socket.on('room:joined', handleRoomJoined);

  socket.on('room:state', (room) => {
    state.room = room;
    renderRoomHeader(room);
    renderRoomParticipants(room.participants || []);
  });

  socket.on('room:participants', (list) => {
    if (state.room) state.room.participants = list;
    renderRoomParticipants(list || []);
  });

  socket.on('room:media_changed', ({ media, playback }) => {
    if (!state.room) return;
    state.room.media = media;
    state.room.playback = playback;
    renderRoomHeader(state.room);
    loadMediaIntoPlayer(media, playback);
    if (media && media.type === 'z01' && media.movie && (!state.z01.movie || String(state.z01.movie.id) !== String(media.movie.id))) {
      loadZ01ForMovieInRoom(media.movie, false);
    }
  });

  socket.on('player:sync', (data) => {
    applyRemoteSync(data, false);
  });

  socket.on('player:heartbeat', (data) => {
    applyRemoteSync(data, true);
  });

  socket.on('chat:message', (msg) => {
    appendChatMessage(msg, true);
  });

  socket.on('chat:updated', (msg) => {
    updateChatMessageDom(msg, 'room');
  });

  socket.on('chat:deleted', ({ id }) => {
    removeChatMessageDom(id);
  });

  socket.on('room:reaction', ({ emoji }) => {
    spawnFloatingEmoji(emoji);
  });

  socket.on('room:invite_received', ({ from, room }) => {
    triggerAppNotification({
      title: `${from.displayName} зовёт в комнату! 🍿`,
      body: `Смотреть вместе: «${room.mediaTitle}»`,
      user: from,
      kind: 'invite',
      data: { roomCode: room.code, tag: 'invite-' + room.code },
      onClick: () => joinRoomByCode(room.code)
    });
  });

  socket.on('friends:update', () => {
    if (state.user) loadFriends();
  });

  socket.on('toast', ({ text }) => {
    if (text) showToast(text);
  });

  // ================= TELEGRAM-STYLE CHAT ENGINE (PHOTOS, VIEW-ONCE, REPLIES, REACTIONS, EDIT, DELETE) =================
  const composers = {
    room: { replyTo: null, editingMsg: null, imageUrl: '', viewOnce: false, barId: 'chatComposerBar', inputId: 'chatInput' },
    dm: { replyTo: null, editingMsg: null, imageUrl: '', viewOnce: false, barId: 'dmComposerBar', inputId: 'dmInput' },
    roomDm: { replyTo: null, editingMsg: null, imageUrl: '', viewOnce: false, barId: 'roomDmComposerBar', inputId: 'roomDmInput' }
  };
  let activePhotoTarget = 'room';
  let activeTgMenuCtx = null; // { msg, el, contextType, composerTarget, friendId }
  let viewOnceTimerId = null;

  function resizeChatImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать фото'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Некорректный формат изображения'));
        img.onload = () => {
          const maxDim = 1080;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderComposerBar(target) {
    const c = composers[target];
    if (!c) return;
    const bar = $(c.barId);
    if (!bar) return;

    if (!c.replyTo && !c.editingMsg && !c.imageUrl) {
      bar.classList.add('hidden');
      bar.innerHTML = '';
      return;
    }

    bar.classList.remove('hidden');
    let html = '';
    if (c.editingMsg) {
      html += `
        <div class="composer-item">
          <div class="composer-item-left">
            <span>✏️</span>
            <div class="composer-text"><strong>Редактирование</strong>: ${esc(c.editingMsg.text || '')}</div>
          </div>
          <button type="button" class="composer-cancel-btn" data-clear-edit="${esc(target)}">✕</button>
        </div>
      `;
    } else if (c.replyTo) {
      html += `
        <div class="composer-item">
          <div class="composer-item-left">
            <span>↩️</span>
            <div class="composer-text"><strong>${esc(c.replyTo.senderName)}</strong>: ${esc(c.replyTo.text || '📷 Фотография')}</div>
          </div>
          <button type="button" class="composer-cancel-btn" data-clear-reply="${esc(target)}">✕</button>
        </div>
      `;
    }
    if (c.imageUrl) {
      html += `
        <div class="composer-item">
          <div class="composer-item-left">
            <img class="composer-thumb" src="${esc(c.imageUrl)}" alt="" />
            <div class="composer-text">${c.viewOnce ? '🔥 <strong>Одноразовое фото</strong> (исчезнет после просмотра)' : '📷 <strong>Фотография</strong>'}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button type="button" class="composer-viewonce-btn ${c.viewOnce ? 'active' : ''}" data-toggle-viewonce="${esc(target)}" title="Одноразовое фото (как в Telegram)">
              ${c.viewOnce ? '🔥 1 просмотр' : '1️⃣ 1 раз'}
            </button>
            <button type="button" class="composer-cancel-btn" data-clear-photo="${esc(target)}">✕</button>
          </div>
        </div>
      `;
    }
    bar.innerHTML = html;

    bar.querySelectorAll('[data-clear-reply]').forEach(btn => {
      btn.onclick = () => {
        c.replyTo = null;
        renderComposerBar(target);
      };
    });
    bar.querySelectorAll('[data-clear-edit]').forEach(btn => {
      btn.onclick = () => {
        c.editingMsg = null;
        const inp = $(c.inputId);
        if (inp) inp.value = '';
        renderComposerBar(target);
      };
    });
    bar.querySelectorAll('[data-clear-photo]').forEach(btn => {
      btn.onclick = () => {
        c.imageUrl = '';
        c.viewOnce = false;
        renderComposerBar(target);
      };
    });
    bar.querySelectorAll('[data-toggle-viewonce]').forEach(btn => {
      btn.onclick = () => {
        c.viewOnce = !c.viewOnce;
        renderComposerBar(target);
      };
    });
  }

  function setComposerReply(target, msg) {
    const c = composers[target];
    if (!c) return;
    c.editingMsg = null;
    const senderName = msg.user?.displayName || msg.sender?.displayName || 'Собеседник';
    c.replyTo = {
      id: msg.id,
      senderName,
      text: msg.text || (msg.viewOnce ? '🔥 Одноразовое фото' : (msg.hasPhoto || msg.hasImage || msg.imageUrl ? '📷 Фотография' : '')),
      hasPhoto: !!(msg.hasPhoto || msg.hasImage || msg.imageUrl)
    };
    renderComposerBar(target);
    $(c.inputId)?.focus();
  }

  function setComposerEdit(target, msg, friendId = null) {
    const c = composers[target];
    if (!c) return;
    c.replyTo = null;
    c.editingMsg = { id: msg.id, text: msg.text || '', friendId };
    renderComposerBar(target);
    const inp = $(c.inputId);
    if (inp) {
      inp.value = msg.text || '';
      inp.focus();
    }
  }

  document.querySelectorAll('.attach-photo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activePhotoTarget = btn.dataset.chatTarget || 'room';
      $('chatPhotoInput').value = '';
      $('chatPhotoInput').click();
    });
  });

  $('chatPhotoInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeChatImageFile(file);
      const c = composers[activePhotoTarget];
      if (c) {
        c.imageUrl = dataUrl;
        renderComposerBar(activePhotoTarget);
        $(c.inputId)?.focus();
      }
    } catch (err) {
      showToast(err.message);
    }
  });

  function openPhotoLightbox(imageUrl, caption = '', isViewOnce = false) {
    if (!imageUrl) return;
    clearTimeout(viewOnceTimerId);
    $('photoViewerImg').src = imageUrl;
    $('photoViewerCaption').textContent = caption || '';
    $('photoViewerBadge').classList.toggle('hidden', !isViewOnce);
    const timerWrap = $('photoViewerTimerWrap');
    const timerBar = $('photoViewerTimerBar');
    if (isViewOnce && timerWrap && timerBar) {
      timerWrap.classList.remove('hidden');
      timerBar.style.transition = 'none';
      timerBar.style.transform = 'scaleX(1)';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          timerBar.style.transition = 'transform 10s linear';
          timerBar.style.transform = 'scaleX(0)';
        });
      });
      viewOnceTimerId = setTimeout(() => {
        $('photoViewerModal').classList.add('hidden');
        $('photoViewerImg').src = '';
      }, 10000);
    } else if (timerWrap) {
      timerWrap.classList.add('hidden');
    }
    $('photoViewerModal').classList.remove('hidden');
  }

  async function handleViewOnceClick(msg, contextType, friendId = null) {
    const uid = msg.fromId || msg.user?.id || '';
    const isSender = state.user && uid === state.user.id;
    if (msg.viewed) {
      showToast('💨 Фотография уже была просмотрена и удалена');
      return;
    }
    if (isSender && contextType === 'dm') {
      showToast('Вы отправили одноразовое фото — его может открыть только получатель');
      return;
    }
    try {
      if (contextType === 'room') {
        if (!state.room) return;
        const res = await api(`/api/rooms/${encodeURIComponent(state.room.code)}/chat/view-once`, {
          method: 'POST',
          body: JSON.stringify({ messageId: msg.id })
        });
        if (res.imageUrl) {
          openPhotoLightbox(res.imageUrl, msg.text || '', true);
        }
        if (res.message) updateChatMessageDom(res.message, 'room');
      } else {
        const targetFriend = friendId || activeDmFriendId || roomActiveDmFriendId;
        if (!targetFriend) return;
        const res = await api(`/api/dms/${encodeURIComponent(targetFriend)}/view-once`, {
          method: 'POST',
          body: JSON.stringify({ messageId: msg.id })
        });
        if (res.imageUrl) {
          openPhotoLightbox(res.imageUrl, msg.text || '', true);
        }
        if (res.message) updateChatMessageDom(res.message, 'dm');
      }
    } catch (e) {
      showToast(e.message);
    }
  }

  async function handleToggleMessageReaction(msg, emoji, contextType, friendId = null) {
    if (contextType === 'room') {
      if (!state.room) return;
      if (socket.connected) {
        socket.emit('chat:react', { messageId: msg.id, emoji });
      } else {
        try {
          const res = await api(`/api/rooms/${encodeURIComponent(state.room.code)}/chat/react`, {
            method: 'POST',
            body: JSON.stringify({ messageId: msg.id, emoji })
          });
          if (res.message) updateChatMessageDom(res.message, 'room');
        } catch {}
      }
    } else {
      const targetFriend = friendId || (msg.fromId === state.user?.id ? msg.toId : msg.fromId) || activeDmFriendId || roomActiveDmFriendId;
      if (!targetFriend) return;
      if (socket.connected) {
        socket.emit('dm:react', { friendId: targetFriend, messageId: msg.id, emoji });
      } else {
        try {
          const res = await api(`/api/dms/${encodeURIComponent(targetFriend)}/react`, {
            method: 'POST',
            body: JSON.stringify({ messageId: msg.id, emoji })
          });
          if (res.message) updateChatMessageDom(res.message, 'dm');
        } catch {}
      }
    }
  }

  async function handleDeleteMessage(msg, contextType, friendId = null) {
    if (contextType === 'room') {
      if (!state.room) return;
      if (socket.connected) {
        socket.emit('chat:delete', { messageId: msg.id });
      } else {
        try {
          await api(`/api/rooms/${encodeURIComponent(state.room.code)}/chat/${encodeURIComponent(msg.id)}`, { method: 'DELETE' });
          removeChatMessageDom(msg.id);
        } catch (e) { showToast(e.message); }
      }
    } else {
      const targetFriend = friendId || (msg.fromId === state.user?.id ? msg.toId : msg.fromId) || activeDmFriendId || roomActiveDmFriendId;
      if (!targetFriend) return;
      if (socket.connected) {
        socket.emit('dm:delete', { friendId: targetFriend, messageId: msg.id });
      } else {
        try {
          await api(`/api/dms/${encodeURIComponent(targetFriend)}/${encodeURIComponent(msg.id)}`, { method: 'DELETE' });
          removeChatMessageDom(msg.id);
        } catch (e) { showToast(e.message); }
      }
    }
  }

  // Telegram Floating Context Menu & Reaction Popup
  function openTelegramMsgMenu(clientX, clientY, ctx) {
    closeTelegramMsgMenu();
    activeTgMenuCtx = ctx;
    const { msg, el } = ctx;
    el.classList.add('context-active');

    const uid = msg.fromId || msg.user?.id || '';
    const isOwn = state.user && uid === state.user.id;
    const canDelete = isOwn || (ctx.contextType === 'room' && state.room && state.room.hostId === state.user?.id);

    $('tgMenuCopyBtn').classList.toggle('hidden', !msg.text);
    $('tgMenuEditBtn').classList.toggle('hidden', !isOwn || !msg.text);
    $('tgMenuDeleteBtn').classList.toggle('hidden', !canDelete);

    // Highlight user's active reactions in the strip
    const myReactions = new Set();
    if (msg.reactions && state.user) {
      for (const [em, arr] of Object.entries(msg.reactions)) {
        if (Array.isArray(arr) && arr.includes(state.user.id)) myReactions.add(em);
      }
    }
    document.querySelectorAll('#tgReactionStrip .tg-rx-btn').forEach(btn => {
      btn.classList.toggle('active', myReactions.has(btn.dataset.tgRx));
    });

    const overlay = $('tgMsgOverlay');
    const popup = $('tgMsgPopup');
    overlay.classList.remove('hidden');

    const popW = 248;
    const popH = isOwn ? 225 : 150;
    const rect = el.querySelector('.chat-bubble')?.getBoundingClientRect() || { left: clientX, top: clientY, right: clientX };
    let left = isOwn ? (rect.right - popW) : rect.left;
    let top = (clientY || rect.top) - 52;

    left = Math.max(10, Math.min(window.innerWidth - popW - 10, left));
    top = Math.max(12, Math.min(window.innerHeight - popH - 12, top));

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  function closeTelegramMsgMenu() {
    if (activeTgMenuCtx?.el) {
      activeTgMenuCtx.el.classList.remove('context-active');
    }
    activeTgMenuCtx = null;
    $('tgMsgOverlay')?.classList.add('hidden');
  }

  $('tgMsgOverlay')?.addEventListener('click', (e) => {
    if (e.target === $('tgMsgOverlay')) closeTelegramMsgMenu();
  });

  document.querySelectorAll('#tgReactionStrip .tg-rx-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!activeTgMenuCtx) return;
      const { msg, contextType, friendId } = activeTgMenuCtx;
      closeTelegramMsgMenu();
      handleToggleMessageReaction(msg, btn.dataset.tgRx, contextType, friendId);
    });
  });

  $('tgMenuReplyBtn')?.addEventListener('click', () => {
    if (!activeTgMenuCtx) return;
    const { msg, composerTarget } = activeTgMenuCtx;
    closeTelegramMsgMenu();
    setComposerReply(composerTarget, msg);
  });

  $('tgMenuCopyBtn')?.addEventListener('click', () => {
    if (!activeTgMenuCtx) return;
    const txt = activeTgMenuCtx.msg?.text || '';
    closeTelegramMsgMenu();
    if (txt) {
      navigator.clipboard.writeText(txt).then(() => showToast('Скопировано в буфер обмена')).catch(() => {});
    }
  });

  $('tgMenuEditBtn')?.addEventListener('click', () => {
    if (!activeTgMenuCtx) return;
    const { msg, composerTarget, friendId } = activeTgMenuCtx;
    closeTelegramMsgMenu();
    setComposerEdit(composerTarget, msg, friendId);
  });

  $('tgMenuDeleteBtn')?.addEventListener('click', () => {
    if (!activeTgMenuCtx) return;
    const { msg, contextType, friendId } = activeTgMenuCtx;
    closeTelegramMsgMenu();
    handleDeleteMessage(msg, contextType, friendId);
  });

  function buildRichBubbleInner(msg, options = {}) {
    const { showAuthor = false, isOwn = false, contextType = 'room' } = options;
    const u = msg.user || msg.sender || {};
    let html = '';

    if (showAuthor && !isOwn) {
      html += `<div class="chat-author" style="color:${esc(u.color || '#64d2ff')}">${esc(u.displayName || 'Гость')}</div>`;
    }

    if (msg.replyTo && msg.replyTo.id) {
      html += `
        <div class="msg-reply-quote" data-scroll-msg="${esc(msg.replyTo.id)}">
          <div class="msg-reply-author">${esc(msg.replyTo.senderName || 'Сообщение')}</div>
          <div class="msg-reply-text">${esc(msg.replyTo.text || '📷 Фотография')}</div>
        </div>
      `;
    }

    if (msg.viewOnce) {
      if (msg.viewed) {
        html += `
          <div class="tg-viewonce-card viewed">
            <div class="tg-viewonce-icon">💨</div>
            <div class="tg-viewonce-info">
              <div class="tg-viewonce-title">Фотография</div>
              <div class="tg-viewonce-sub">Просмотрено</div>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="tg-viewonce-card" data-open-viewonce="1">
            <div class="tg-viewonce-icon">1</div>
            <div class="tg-viewonce-info">
              <div class="tg-viewonce-title">Фотография</div>
              <div class="tg-viewonce-sub">${isOwn ? 'Одноразовое · Отправлено' : 'Нажмите для просмотра'}</div>
            </div>
          </div>
        `;
      }
    } else if (msg.imageUrl) {
      html += `<img class="msg-photo" src="${esc(msg.imageUrl)}" alt="Фото" loading="lazy" />`;
    }

    const timeStr = formatMsgTime(msg.createdAt);
    const editedTag = msg.editedAt ? 'изм. ' : '';
    const ticksHtml = (contextType === 'dm' && isOwn)
      ? `<span class="chat-ticks">${msg.read ? '✓✓' : '✓'}</span>`
      : '';
    const metaInline = `<span class="chat-meta-inline">${esc(editedTag)}${esc(timeStr)}${ticksHtml}</span>`;

    if (msg.text) {
      html += `<div class="chat-text-wrap"><span class="chat-text">${esc(msg.text)}</span>${metaInline}</div>`;
    } else {
      html += `<div class="chat-text-wrap">${metaInline}</div>`;
    }

    // Active reaction pills inside the bubble (only rendered if reactions exist!)
    const reactions = msg.reactions || {};
    const rxEntries = Object.entries(reactions).filter(([, arr]) => Array.isArray(arr) && arr.length > 0);
    if (rxEntries.length > 0) {
      html += `<div class="msg-reactions-bar">` + rxEntries.map(([emoji, users]) => {
        const mine = state.user && users.includes(state.user.id);
        return `<button type="button" class="msg-rx-pill ${mine ? 'mine' : ''}" data-rx="${esc(emoji)}"><span>${esc(emoji)}</span><span>${users.length}</span></button>`;
      }).join('') + `</div>`;
    }

    return html;
  }

  function bindRichMessageEvents(el, msg, contextType, composerTarget, friendId = null) {
    const u = msg.user || msg.sender || {};
    const av = el.querySelector('.chat-av');
    if (av && u.id) av.onclick = (e) => {
      e.stopPropagation();
      openUserCard(u.id);
    };

    const photo = el.querySelector('.msg-photo');
    if (photo && msg.imageUrl) {
      photo.onclick = (e) => {
        e.stopPropagation();
        openPhotoLightbox(msg.imageUrl, msg.text || '', false);
      };
    }

    const voBtn = el.querySelector('[data-open-viewonce]');
    if (voBtn) {
      voBtn.onclick = (e) => {
        e.stopPropagation();
        handleViewOnceClick(msg, contextType, friendId);
      };
    }

    const quote = el.querySelector('[data-scroll-msg]');
    if (quote) {
      quote.onclick = (e) => {
        e.stopPropagation();
        const targetEl = document.querySelector(`[data-msg-id="${CSS.escape(msg.replyTo.id)}"]`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetEl.classList.add('context-active');
          setTimeout(() => targetEl.classList.remove('context-active'), 1100);
        }
      };
    }

    el.querySelectorAll('[data-rx]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        handleToggleMessageReaction(msg, btn.dataset.rx, contextType, friendId);
      };
    });

    const ctxObj = { msg, el, contextType, composerTarget, friendId };
    const bubble = el.querySelector('.chat-bubble');
    const hoverTrig = el.querySelector('.tg-hover-trigger');

    if (hoverTrig) {
      hoverTrig.onclick = (e) => {
        e.stopPropagation();
        openTelegramMsgMenu(e.clientX, e.clientY, ctxObj);
      };
    }

    if (bubble) {
      // 1. Right-click on PC -> Telegram Context Menu + Reactions
      bubble.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openTelegramMsgMenu(e.clientX, e.clientY, ctxObj);
      });

      // 2. Double-click on PC -> Quick Reply like Telegram Desktop
      bubble.addEventListener('dblclick', (e) => {
        e.preventDefault();
        setComposerReply(composerTarget, msg);
      });

      // 3. Single click / tap on bubble (if not clicking photo, quote, or reaction pill) -> open Telegram menu
      bubble.addEventListener('click', (e) => {
        if (e.target.closest('.msg-photo, [data-open-viewonce], .msg-reply-quote, .msg-rx-pill')) return;
        if (window.getSelection && String(window.getSelection()).length > 0) return;
        openTelegramMsgMenu(e.clientX, e.clientY, ctxObj);
      });

      // 4. Mobile Touch: Swipe-left to Reply like Telegram iOS/Android
      let touchStartX = 0;
      let touchStartY = 0;
      let swipedReply = false;
      bubble.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        swipedReply = false;
      }, { passive: true });

      bubble.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        const dx = t.clientX - touchStartX;
        const dy = Math.abs(t.clientY - touchStartY);
        if (dx < -18 && dy < 30) {
          const shift = Math.max(-56, dx);
          el.style.transform = `translateX(${shift}px)`;
          if (dx < -46 && !swipedReply) {
            swipedReply = true;
          }
        }
      }, { passive: true });

      bubble.addEventListener('touchend', () => {
        el.style.transform = '';
        if (swipedReply) {
          setComposerReply(composerTarget, msg);
        }
      });
    }
  }

  function createRichMessageElement(msg, contextType = 'room', composerTarget = 'room', friendId = null) {
    const el = document.createElement('div');
    el.dataset.msgId = msg.id || '';

    if (msg.system) {
      el.className = 'chat-msg system';
      el.textContent = msg.text;
      return el;
    }

    const uid = msg.fromId || msg.user?.id || '';
    const isOwn = !!(state.user && uid === state.user.id);
    const u = msg.user || msg.sender || (isOwn ? state.user : {});
    el.className = `chat-msg ${isOwn ? 'own' : ''}`;
    el.dataset.authorId = uid;
    el.dataset.msgSig = JSON.stringify({
      t: msg.text,
      e: msg.editedAt,
      v: msg.viewed,
      r: msg.read,
      rx: msg.reactions
    });

    el.innerHTML = `
      <div class="chat-av" style="background:${esc(u?.color || '#7c5cff')}">${avatarInnerHtml(u)}</div>
      <div class="chat-msg-body">
        <div class="chat-bubble">
          ${buildRichBubbleInner(msg, { showAuthor: contextType === 'room', isOwn, contextType })}
        </div>
        <button type="button" class="tg-hover-trigger" title="Реакции и меню">😊</button>
      </div>
    `;

    bindRichMessageEvents(el, msg, contextType, composerTarget, friendId);
    return el;
  }

  // Group consecutive messages from the same sender like Telegram
  function refreshMessageGrouping(container) {
    if (!container) return;
    const items = Array.from(container.querySelectorAll('.chat-msg'));
    for (let i = 0; i < items.length; i++) {
      const cur = items[i];
      const prev = items[i - 1];
      const next = items[i + 1];
      const curAuthor = cur.dataset.authorId;
      if (!curAuthor || cur.classList.contains('system')) continue;
      const samePrev = prev && !prev.classList.contains('system') && prev.dataset.authorId === curAuthor;
      const sameNext = next && !next.classList.contains('system') && next.dataset.authorId === curAuthor;
      cur.classList.toggle('grouped-prev', !!samePrev);
      cur.classList.toggle('grouped-next', !!sameNext);
    }
  }

  function updateChatMessageDom(msg, contextType = 'room') {
    if (!msg || !msg.id) return;
    document.querySelectorAll(`[data-msg-id="${CSS.escape(msg.id)}"]`).forEach(existing => {
      const parent = existing.parentElement;
      const parentId = parent?.id || '';
      const composerTarget = parentId === 'roomDmMessages' ? 'roomDm' : (parentId === 'dmMessages' ? 'dm' : 'room');
      const friendId = composerTarget === 'roomDm' ? roomActiveDmFriendId : activeDmFriendId;
      const fresh = createRichMessageElement(msg, contextType, composerTarget, friendId);
      existing.replaceWith(fresh);
      refreshMessageGrouping(parent);
    });
  }

  function removeChatMessageDom(messageId) {
    if (!messageId) return;
    document.querySelectorAll(`[data-msg-id="${CSS.escape(messageId)}"]`).forEach(existing => {
      const parent = existing.parentElement;
      existing.remove();
      refreshMessageGrouping(parent);
    });
  }

  function syncRoomMessagesFromPoll(messages) {
    const box = $('chatMessages');
    if (!box) return;
    const validIds = new Set(messages.map(m => m.id));
    box.querySelectorAll('.chat-msg[data-msg-id]').forEach(el => {
      if (el.dataset.msgId && !validIds.has(el.dataset.msgId)) el.remove();
    });
    messages.forEach(m => {
      const existing = box.querySelector(`[data-msg-id="${CSS.escape(m.id)}"]`);
      if (!existing) {
        appendChatMessage(m, false);
      } else {
        const nextSig = JSON.stringify({ t: m.text, e: m.editedAt, v: m.viewed, r: m.read, rx: m.reactions });
        if (existing.dataset.msgSig !== nextSig) {
          updateChatMessageDom(m, 'room');
        }
      }
    });
    refreshMessageGrouping(box);
  }

  function syncDmMessagesFromPoll(friendId, messages) {
    ['dmMessages', 'roomDmMessages'].forEach(boxId => {
      const box = $(boxId);
      if (!box) return;
      const isTarget = (boxId === 'dmMessages' && activeDmFriendId === friendId) ||
                       (boxId === 'roomDmMessages' && roomActiveDmFriendId === friendId);
      if (!isTarget) return;
      const validIds = new Set(messages.map(m => m.id));
      box.querySelectorAll('.chat-msg[data-msg-id]').forEach(el => {
        if (el.dataset.msgId && !validIds.has(el.dataset.msgId)) el.remove();
      });
      messages.forEach(m => {
        const existing = box.querySelector(`[data-msg-id="${CSS.escape(m.id)}"]`);
        if (!existing) {
          if (box.querySelector('div[style*="text-align:center"]')) box.innerHTML = '';
          const compTarget = boxId === 'roomDmMessages' ? 'roomDm' : 'dm';
          box.appendChild(createRichMessageElement(m, 'dm', compTarget, friendId));
          box.scrollTop = box.scrollHeight;
        } else {
          const nextSig = JSON.stringify({ t: m.text, e: m.editedAt, v: m.viewed, r: m.read, rx: m.reactions });
          if (existing.dataset.msgSig !== nextSig) {
            updateChatMessageDom(m, 'dm');
          }
        }
      });
      refreshMessageGrouping(box);
    });
  }

  // ================= ROOM UI: HEADER, CHAT, REACTIONS, PARTICIPANTS =================
  function renderRoomHeader(room) {
    $('roomTitleText').textContent = room.name;
    $('roomPrivacyBadge').textContent = room.isPublic ? 'Публичная' : 'Приватная';
    $('roomCodeLabel').textContent = `#${room.code}`;
    const isHost = state.user && room.hostId === state.user.id;
    $('roomSettingsBtn').classList.toggle('hidden', !isHost);
  }

  $('roomSettingsBtn').addEventListener('click', () => {
    if (!state.room) return;
    const nextPublic = !state.room.isPublic;
    socket.emit('room:settings', { isPublic: nextPublic });
    if (!socket.connected) {
      api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
        method: 'POST',
        body: JSON.stringify({ settings: { isPublic: nextPublic } })
      }).catch(() => {});
    }
    showToast(nextPublic ? 'Комната теперь публичная' : 'Комната теперь приватная (только по коду/ссылке)');
  });

  function renderRoomParticipants(list) {
    $('roomUserCount').textContent = list.length;
    const mobCnt = $('roomUserCountMobile');
    if (mobCnt) mobCnt.textContent = list.length;
    const container = $('roomParticipantsList');
    container.innerHTML = '';
    list.forEach(p => {
      const isHost = state.room && p.id === state.room.hostId;
      const row = document.createElement('div');
      row.className = 'user-row';
      row.style.cursor = 'pointer';
      row.innerHTML = `
        <div class="user-row-left">
          <div class="avatar-circle" style="background:${esc(p.color || '#7c5cff')}">${avatarInnerHtml(p)}</div>
          <div>
            <div class="user-row-name">${esc(p.displayName)} ${isHost ? '👑' : ''}</div>
            <div class="user-row-sub">@${esc(p.username)} ${p.inVoice ? '· 🎙️ В голосе' : ''}</div>
          </div>
        </div>
      `;
      row.addEventListener('click', () => openUserCard(p.id));
      container.appendChild(row);
    });
  }

  function renderRoomMessages(messages) {
    const box = $('chatMessages');
    box.innerHTML = '';
    messages.forEach(m => appendChatMessage(m, false));
  }

  function spawnVideoChatPill(msg) {
    if (!msg || msg.system || !msg.user) return;
    const overlay = $('videoChatOverlay');
    if (!overlay) return;
    const pill = document.createElement('div');
    pill.className = 'vchat-pill';
    const preview = msg.text || (msg.viewOnce ? '💣 Одноразовое фото' : '📷 Фото');
    pill.innerHTML = `<strong>${esc(msg.user.displayName)}:</strong> <span>${esc(preview)}</span>`;
    overlay.appendChild(pill);
    while (overlay.children.length > 3) {
      overlay.firstElementChild.remove();
    }
    setTimeout(() => {
      if (pill.parentNode) pill.remove();
    }, 4500);
  }

  function appendChatMessage(msg, isLive = false) {
    const box = $('chatMessages');
    if (msg.id && box.querySelector(`[data-msg-id="${CSS.escape(msg.id)}"]`)) return;
    const el = createRichMessageElement(msg, 'room', 'room', null);
    if (!msg.system && isLive) {
      spawnVideoChatPill(msg);
      const isOwn = state.user && msg.user?.id === state.user.id;
      if (!isOwn && (document.hidden || state.mobileRoomTab !== 'chat')) {
        if (state.mobileRoomTab !== 'chat') {
          state.unreadChatCount++;
          const badge = $('chatUnreadBadge');
          if (badge) {
            badge.textContent = state.unreadChatCount;
            badge.classList.remove('hidden');
          }
        }
        if (document.hidden) {
          const preview = msg.text || (msg.viewOnce ? '🔥 Одноразовое фото' : '📷 Фотография');
          triggerAppNotification({
            title: `${msg.user?.displayName || 'Участник'} (в комнате)`,
            body: preview,
            user: msg.user,
            data: { roomCode: state.room?.code, tag: 'roomchat-' + msg.id },
            onClick: () => setMobileRoomTab('chat')
          });
        } else {
          playNotificationSound('message');
        }
      }
    }
    box.appendChild(el);
    refreshMessageGrouping(box);
    box.scrollTop = box.scrollHeight;
  }

  $('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.room) return;
    const input = $('chatInput');
    const text = input.value.trim();
    const comp = composers.room;

    // Handle Edit Mode in Room Chat
    if (comp.editingMsg) {
      const editId = comp.editingMsg.id;
      input.value = '';
      comp.editingMsg = null;
      renderComposerBar('room');
      if (!text) return;
      if (socket.connected) {
        socket.emit('chat:edit', { messageId: editId, text });
      } else {
        try {
          const res = await api(`/api/rooms/${encodeURIComponent(state.room.code)}/chat/${encodeURIComponent(editId)}`, {
            method: 'PUT',
            body: JSON.stringify({ text })
          });
          if (res.message) updateChatMessageDom(res.message, 'room');
        } catch (err) { showToast(err.message); }
      }
      return;
    }

    if (!text && !comp.imageUrl) return;

    const payload = {
      text,
      imageUrl: comp.imageUrl || '',
      viewOnce: !!comp.viewOnce,
      replyTo: comp.replyTo || null
    };

    input.value = '';
    comp.imageUrl = '';
    comp.viewOnce = false;
    comp.replyTo = null;
    renderComposerBar('room');

    if (socket.connected) {
      socket.emit('chat:send', payload);
    } else {
      try {
        const res = await api(`/api/rooms/${encodeURIComponent(state.room.code)}/chat`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (res.message) appendChatMessage(res.message, false);
      } catch (err) {
        showToast(err.message);
      }
    }
  });

  // Mobile Room Quick Switcher (💬 Комната | 💌 Друзья | 🎞️ Озвучка | 👥 Зрители)
  function setMobileRoomTab(tabName) {
    state.mobileRoomTab = tabName;
    const layout = document.querySelector('.room-layout');
    document.querySelectorAll('.m-rtab').forEach(b => {
      b.classList.toggle('active', b.dataset.mrtab === tabName);
    });
    if (tabName === 'z01') {
      layout?.classList.add('mobile-tab-z01');
      $('z01Panel').classList.remove('hidden');
    } else {
      layout?.classList.remove('mobile-tab-z01');
      const rtab = tabName === 'users' ? 'users' : (tabName === 'dms' ? 'dms' : 'chat');
      document.querySelectorAll('.side-tab').forEach(t => t.classList.toggle('active', t.dataset.rtab === rtab));
      document.querySelectorAll('.rtab-content').forEach(c => c.classList.remove('active'));
      $(`rtab-${rtab}`)?.classList.add('active');
      if (rtab === 'chat') {
        state.unreadChatCount = 0;
        $('chatUnreadBadge')?.classList.add('hidden');
        const box = $('chatMessages');
        if (box) box.scrollTop = box.scrollHeight;
      } else if (rtab === 'dms') {
        renderRoomDmFriendsList();
      }
    }
  }

  document.querySelectorAll('.m-rtab').forEach(btn => {
    btn.addEventListener('click', () => setMobileRoomTab(btn.dataset.mrtab));
  });

  // Desktop Sidebar tabs (Chat / Friends DM / Participants)
  document.querySelectorAll('.side-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.side-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.rtab-content').forEach(c => c.classList.remove('active'));
      $(`rtab-${tab.dataset.rtab}`).classList.add('active');
      if (tab.dataset.rtab === 'dms') {
        renderRoomDmFriendsList();
      }
    });
  });

  // Floating Reactions
  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('room:reaction', { emoji: btn.dataset.emoji });
      if (!socket.connected) spawnFloatingEmoji(btn.dataset.emoji);
    });
  });

  function spawnFloatingEmoji(emoji) {
    const layer = $('reactionsLayer');
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    el.style.left = `${15 + Math.random() * 70}%`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ================= FRIENDS & PRIVATE CHAT (DMs) =================
  let activeDmFriendId = null;
  let roomActiveDmFriendId = null;

  function formatMsgTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function updateDmBadges() {
    const unreadDmTotal = (state.friends || []).reduce((acc, f) => acc + (f.unreadCount || 0), 0);
    const totalNavBadge = (state.incomingRequests?.length || 0) + unreadDmTotal;

    const reqBadge = $('friendsReqBadge');
    if (totalNavBadge > 0) {
      reqBadge.textContent = totalNavBadge;
      reqBadge.classList.remove('hidden');
    } else {
      reqBadge.classList.add('hidden');
    }

    ['roomDmBadge', 'roomDmBadgeMobile'].forEach(id => {
      const b = $(id);
      if (!b) return;
      if (unreadDmTotal > 0) {
        b.textContent = unreadDmTotal;
        b.classList.remove('hidden');
      } else {
        b.classList.add('hidden');
      }
    });
  }

  async function inviteFriendToCurrentRoom(friendId) {
    if (!state.room || !friendId) return;
    if (socket.connected) {
      socket.emit('room:invite', { friendId });
    } else {
      try {
        await api(`/api/rooms/${encodeURIComponent(state.room.code)}/invite`, {
          method: 'POST',
          body: JSON.stringify({ friendId })
        });
        showToast('🍿 Приглашение отправлено другу!');
      } catch (e) {
        showToast(e.message);
      }
    }
  }

  async function loadFriends() {
    if (!state.user) {
      $('friendsList').innerHTML = '<div style="color:var(--text-muted);padding:20px 0;">Войдите в аккаунт, чтобы добавлять друзей и переписываться с ними.</div>';
      return;
    }
    try {
      const data = await api('/api/friends');
      const newFriends = data.friends || [];
      const newIncoming = data.incoming || [];
      const serverNotifs = data.notifications || [];

      // Detect new incoming DMs & friend requests for notifications
      for (const f of newFriends) {
        if (f.lastMessage && f.lastMessage.id && f.lastMessage.fromId !== state.user.id) {
          if (!initialFriendsLoaded) {
            notifiedDmIds.add(f.lastMessage.id);
          } else if (!notifiedDmIds.has(f.lastMessage.id)) {
            notifiedDmIds.add(f.lastMessage.id);
            const isViewing = (state.currentView === 'friends' && activeDmFriendId === f.id && !document.hidden) ||
                              (state.currentView === 'room' && roomActiveDmFriendId === f.id && !$('roomDmChatView')?.classList.contains('hidden') && !document.hidden);
            if (!isViewing) {
              triggerAppNotification({
                title: f.displayName,
                body: f.lastMessage.text || 'Новое сообщение',
                user: f,
                data: { friendId: f.id, tag: 'dm-' + f.id },
                onClick: () => {
                  if (state.currentView === 'room') {
                    setMobileRoomTab('dms');
                    openRoomDmChat(f.id);
                  } else {
                    switchView('friends');
                    openFriendChat(f.id);
                  }
                }
              });
            }
          }
        }
      }

      for (const req of newIncoming) {
        if (!initialFriendsLoaded) {
          notifiedReqIds.add(req.id);
        } else if (!notifiedReqIds.has(req.id)) {
          notifiedReqIds.add(req.id);
          triggerAppNotification({
            title: 'Новая заявка в друзья 👋',
            body: `${req.user.displayName} (@${req.user.username}) хочет добавить вас в друзья`,
            user: req.user,
            kind: 'invite',
            data: { view: 'friends', tag: 'freq-' + req.id },
            onClick: () => switchView('friends')
          });
        }
      }

      for (const n of serverNotifs) {
        if (n.type === 'room_invite' && n.invitePayload) {
          const { from, room } = n.invitePayload;
          triggerAppNotification({
            title: `${from.displayName} зовёт в комнату! 🍿`,
            body: `Смотреть вместе: «${room.mediaTitle}»`,
            user: from,
            kind: 'invite',
            data: { roomCode: room.code, tag: 'invite-' + room.code },
            onClick: () => joinRoomByCode(room.code)
          });
        } else if (n.title) {
          triggerAppNotification({
            title: n.title,
            body: n.body || '',
            kind: 'invite',
            onClick: () => switchView('friends')
          });
        }
      }

      initialFriendsLoaded = true;
      state.friends = newFriends;
      state.incomingRequests = newIncoming;
      state.outgoingRequests = data.outgoing || [];

      updateDmBadges();
      renderFriendsView();
      renderRoomDmFriendsList();

      if (activeDmFriendId) {
        const f = state.friends.find(x => x.id === activeDmFriendId);
        if (f) updateDmHeader(f);
      }
    } catch {}
  }

  // Background poll every 4.5s for new notifications, DMs, friend requests & online status
  setInterval(() => {
    if (state.user) loadFriends();
  }, 4500);

  function renderFriendsView() {
    // Incoming requests
    const incBlock = $('incomingRequestsBlock');
    const incList = $('incomingRequestsList');
    if (state.incomingRequests.length > 0) {
      incBlock.classList.remove('hidden');
      incList.innerHTML = '';
      state.incomingRequests.forEach(req => {
        const row = document.createElement('div');
        row.className = 'user-row';
        row.innerHTML = `
          <div class="user-row-left" style="cursor:pointer;">
            <div class="avatar-circle" style="background:${esc(req.user.color)}">${avatarInnerHtml(req.user)}</div>
            <div>
              <div class="user-row-name">${esc(req.user.displayName)}</div>
              <div class="user-row-sub">@${esc(req.user.username)}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="pill-btn tiny accent" data-accept="${esc(req.id)}">Принять</button>
            <button class="pill-btn tiny" data-decline="${esc(req.id)}">✕</button>
          </div>
        `;
        row.querySelector('.user-row-left').onclick = () => openUserCard(req.user.id);
        row.querySelector('[data-accept]').onclick = () => respondFriend(req.id, true);
        row.querySelector('[data-decline]').onclick = () => respondFriend(req.id, false);
        incList.appendChild(row);
      });
    } else {
      incBlock.classList.add('hidden');
    }

    // Friends list
    const fList = $('friendsList');
    fList.innerHTML = '';
    if (state.friends.length === 0) {
      fList.innerHTML = '<div style="color:var(--text-muted);padding:16px 0;">У вас пока нет друзей. Найдите друга по логину выше!</div>';
      return;
    }

    state.friends.forEach(f => {
      const row = document.createElement('div');
      row.className = `user-row ${activeDmFriendId === f.id ? 'active-dm' : ''}`;
      row.style.cursor = 'pointer';
      const roomStatus = f.currentRoom
        ? `🍿 Смотрит: ${f.currentRoom.mediaTitle}`
        : (f.lastMessage ? `${f.lastMessage.fromId === state.user?.id ? 'Вы: ' : ''}${f.lastMessage.text}` : (f.online ? 'В сети' : 'Не в сети'));

      row.innerHTML = `
        <div class="user-row-left">
          <span class="status-dot ${f.online ? 'online' : ''}"></span>
          <div class="avatar-circle" style="background:${esc(f.color)}">${avatarInnerHtml(f)}</div>
          <div style="min-width:0;">
            <div class="user-row-name">${esc(f.displayName)}</div>
            <div class="user-row-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;">${esc(roomStatus)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          ${f.unreadCount > 0 ? `<span class="nav-badge inline-badge">${f.unreadCount}</span>` : ''}
          ${f.currentRoom ? `<button class="pill-btn tiny accent" data-join-friend="${esc(f.currentRoom.code)}" title="Войти в комнату друга">▶️</button>` : ''}
          <button class="pill-btn tiny" data-chat-friend="${esc(f.id)}">💬 Чат</button>
        </div>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-join-friend]')) return;
        openFriendChat(f.id);
      });
      const joinBtn = row.querySelector('[data-join-friend]');
      if (joinBtn) joinBtn.onclick = (e) => {
        e.stopPropagation();
        joinRoomByCode(f.currentRoom.code);
      };
      fList.appendChild(row);
    });
  }

  function updateDmHeader(friend) {
    setAvatarElement($('dmFriendAvatar'), friend, '🦊');
    $('dmFriendName').textContent = friend.displayName;
    const statusTxt = friend.currentRoom
      ? `🍿 Смотрит: ${friend.currentRoom.mediaTitle}`
      : (friend.online ? '🟢 В сети' : '⚪ Не в сети');
    $('dmFriendStatus').textContent = statusTxt;
    $('dmFriendHeaderMeta').onclick = () => openUserCard(friend.id);

    const joinBtn = $('dmJoinRoomBtn');
    if (friend.currentRoom) {
      joinBtn.classList.remove('hidden');
      joinBtn.onclick = () => joinRoomByCode(friend.currentRoom.code);
    } else {
      joinBtn.classList.add('hidden');
    }

    const invBtn = $('dmInviteRoomBtn');
    if (state.room) {
      invBtn.classList.remove('hidden');
      invBtn.onclick = () => inviteFriendToCurrentRoom(friend.id);
    } else {
      invBtn.classList.add('hidden');
    }
  }

  async function openFriendChat(friendId) {
    activeDmFriendId = friendId;
    $('friendsLayout')?.classList.add('chat-open');
    $('dmEmptyPrompt')?.classList.add('hidden');
    $('dmActiveBox')?.classList.remove('hidden');

    const localFriend = state.friends.find(x => x.id === friendId);
    if (localFriend) {
      localFriend.unreadCount = 0;
      updateDmHeader(localFriend);
    }
    updateDmBadges();
    renderFriendsView();

    const box = $('dmMessages');
    box.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Загрузка переписки...</div>';

    try {
      const data = await api(`/api/dms/${encodeURIComponent(friendId)}`);
      if (data.friend) updateDmHeader(data.friend);
      box.innerHTML = '';
      const msgs = data.messages || [];
      if (msgs.length === 0) {
        box.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:24px;font-size:0.84rem;">Сообщений пока нет. Напишите привет или отправьте фото! 👋📷</div>';
      } else {
        msgs.forEach(m => box.appendChild(createRichMessageElement(m, 'dm', 'dm', friendId)));
        refreshMessageGrouping(box);
        box.scrollTop = box.scrollHeight;
      }
      $('dmInput')?.focus();
    } catch (e) {
      box.innerHTML = `<div style="text-align:center;color:var(--danger);padding:20px;">${esc(e.message)}</div>`;
    }
  }

  $('dmBackBtn')?.addEventListener('click', () => {
    $('friendsLayout')?.classList.remove('chat-open');
  });

  async function submitDirectMessageForm(friendId, inputId, composerKey) {
    if (!friendId) return;
    const input = $(inputId);
    const text = input ? input.value.trim() : '';
    const comp = composers[composerKey];

    // Handle Edit Mode in Direct Messages
    if (comp && comp.editingMsg) {
      const editId = comp.editingMsg.id;
      if (input) input.value = '';
      comp.editingMsg = null;
      renderComposerBar(composerKey);
      if (!text) return;
      if (socket.connected) {
        socket.emit('dm:edit', { friendId, messageId: editId, text });
      } else {
        try {
          const res = await api(`/api/dms/${encodeURIComponent(friendId)}/${encodeURIComponent(editId)}`, {
            method: 'PUT',
            body: JSON.stringify({ text })
          });
          if (res.message) updateChatMessageDom(res.message, 'dm');
        } catch (err) { showToast(err.message); }
      }
      return;
    }

    if (!text && (!comp || !comp.imageUrl)) return;

    const payload = {
      toId: friendId,
      text,
      imageUrl: comp?.imageUrl || '',
      viewOnce: !!comp?.viewOnce,
      replyTo: comp?.replyTo || null
    };

    if (input) input.value = '';
    if (comp) {
      comp.imageUrl = '';
      comp.viewOnce = false;
      comp.replyTo = null;
      renderComposerBar(composerKey);
    }

    if (socket.connected) {
      socket.emit('dm:send', payload);
    } else {
      try {
        const res = await api(`/api/dms/${encodeURIComponent(friendId)}`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (res.message) handleIncomingOrOutgoingDm(res.message);
      } catch (err) {
        showToast(err.message);
      }
    }
  }

  $('dmForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitDirectMessageForm(activeDmFriendId, 'dmInput', 'dm');
  });

  // Friends Private Chat inside Watch Party Room (#rtab-dms)
  function renderRoomDmFriendsList() {
    const container = $('roomDmFriendsList');
    if (!container) return;
    container.innerHTML = '';
    if (!state.friends.length) {
      container.innerHTML = '<div style="color:var(--text-muted);padding:16px;font-size:0.84rem;text-align:center;">Добавьте друзей во вкладке «Друзья», чтобы переписываться с ними прямо во время просмотра.</div>';
      return;
    }
    state.friends.forEach(f => {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.style.cursor = 'pointer';
      const sub = f.lastMessage
        ? `${f.lastMessage.fromId === state.user?.id ? 'Вы: ' : ''}${f.lastMessage.text}`
        : (f.online ? '🟢 В сети' : '⚪ Не в сети');
      row.innerHTML = `
        <div class="user-row-left">
          <span class="status-dot ${f.online ? 'online' : ''}"></span>
          <div class="avatar-circle" style="background:${esc(f.color)}">${avatarInnerHtml(f)}</div>
          <div style="min-width:0;">
            <div class="user-row-name">${esc(f.displayName)}</div>
            <div class="user-row-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;">${esc(sub)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          ${f.unreadCount > 0 ? `<span class="nav-badge inline-badge">${f.unreadCount}</span>` : ''}
          <span class="pill-btn tiny">💬</span>
        </div>
      `;
      row.onclick = () => openRoomDmChat(f.id);
      container.appendChild(row);
    });
  }

  async function openRoomDmChat(friendId) {
    roomActiveDmFriendId = friendId;
    $('roomDmFriendsView')?.classList.add('hidden');
    $('roomDmChatView')?.classList.remove('hidden');

    const f = state.friends.find(x => x.id === friendId);
    if (f) {
      f.unreadCount = 0;
      setAvatarElement($('roomDmFriendAvatar'), f, '🦊');
      $('roomDmFriendName').textContent = f.displayName;
      $('roomDmInviteBtn').onclick = () => inviteFriendToCurrentRoom(f.id);
    }
    updateDmBadges();
    renderRoomDmFriendsList();

    const box = $('roomDmMessages');
    box.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:0.82rem;">Загрузка...</div>';
    try {
      const data = await api(`/api/dms/${encodeURIComponent(friendId)}`);
      box.innerHTML = '';
      (data.messages || []).forEach(m => box.appendChild(createRichMessageElement(m, 'dm', 'roomDm', friendId)));
      refreshMessageGrouping(box);
      box.scrollTop = box.scrollHeight;
      $('roomDmInput')?.focus();
    } catch {}
  }

  $('roomDmBackBtn')?.addEventListener('click', () => {
    roomActiveDmFriendId = null;
    $('roomDmChatView')?.classList.add('hidden');
    $('roomDmFriendsView')?.classList.remove('hidden');
    renderRoomDmFriendsList();
  });

  $('roomDmForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitDirectMessageForm(roomActiveDmFriendId, 'roomDmInput', 'roomDm');
  });

  function handleIncomingOrOutgoingDm(msg) {
    if (!state.user) return;
    const otherId = msg.fromId === state.user.id ? msg.toId : msg.fromId;
    const friend = state.friends.find(x => x.id === otherId);
    const previewText = msg.text || (msg.viewOnce ? '🔥 Одноразовое фото' : (msg.hasPhoto || msg.hasImage || msg.imageUrl ? '📷 Фотография' : ''));
    if (friend) {
      friend.lastMessage = {
        text: previewText,
        fromId: msg.fromId,
        createdAt: msg.createdAt
      };
    }

    const isViewingInFriendsPage = state.currentView === 'friends' && activeDmFriendId === otherId;
    const isViewingInRoomSidebar = state.currentView === 'room' && roomActiveDmFriendId === otherId && !$('roomDmChatView')?.classList.contains('hidden');

    if (activeDmFriendId === otherId) {
      const box = $('dmMessages');
      if (box && !box.querySelector(`[data-msg-id="${CSS.escape(msg.id)}"]`)) {
        if (box.querySelector('div[style*="text-align:center"]')) box.innerHTML = '';
        box.appendChild(createRichMessageElement(msg, 'dm', 'dm', otherId));
        refreshMessageGrouping(box);
        box.scrollTop = box.scrollHeight;
      }
    }

    if (roomActiveDmFriendId === otherId) {
      const rBox = $('roomDmMessages');
      if (rBox && !rBox.querySelector(`[data-msg-id="${CSS.escape(msg.id)}"]`)) {
        rBox.appendChild(createRichMessageElement(msg, 'dm', 'roomDm', otherId));
        refreshMessageGrouping(rBox);
        rBox.scrollTop = rBox.scrollHeight;
      }
    }

    if (msg.fromId !== state.user.id) {
      notifiedDmIds.add(msg.id);
      if ((isViewingInFriendsPage || isViewingInRoomSidebar) && !document.hidden) {
        socket.emit('dm:read', { friendId: otherId });
        playNotificationSound('message');
      } else {
        if (friend) friend.unreadCount = (friend.unreadCount || 0) + 1;
        triggerAppNotification({
          title: msg.sender?.displayName || friend?.displayName || 'Друг',
          body: previewText,
          user: msg.sender || friend,
          data: { friendId: otherId, tag: 'dm-' + otherId },
          onClick: () => {
            if (state.currentView === 'room') {
              setMobileRoomTab('dms');
              openRoomDmChat(otherId);
            } else {
              switchView('friends');
              openFriendChat(otherId);
            }
          }
        });
      }
    }

    updateDmBadges();
    renderFriendsView();
    renderRoomDmFriendsList();
  }

  // Real-time incoming/outgoing Direct Message handler
  socket.on('dm:message', handleIncomingOrOutgoingDm);

  socket.on('dm:updated', (msg) => {
    updateChatMessageDom(msg, 'dm');
  });

  socket.on('dm:deleted', ({ id }) => {
    removeChatMessageDom(id);
  });

  async function respondFriend(requestId, accept) {
    try {
      await api('/api/friends/respond', {
        method: 'POST',
        body: JSON.stringify({ requestId, accept })
      });
      loadFriends();
    } catch (e) {
      showToast(e.message);
    }
  }

  $('friendSearchBtn').addEventListener('click', async () => {
    if (!(await ensureAuthenticated())) return;
    const q = $('friendSearchInput').value.trim();
    if (!q) return;
    try {
      const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
      const box = $('friendSearchResults');
      box.classList.remove('hidden');
      box.innerHTML = '';
      if (!data.users?.length) {
        box.innerHTML = '<div style="color:var(--text-muted);padding:8px 0;">Пользователи не найдены</div>';
        return;
      }
      data.users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'user-row';
        row.innerHTML = `
          <div class="user-row-left" style="cursor:pointer;">
            <div class="avatar-circle" style="background:${esc(u.color)}">${avatarInnerHtml(u)}</div>
            <div>
              <div class="user-row-name">${esc(u.displayName)}</div>
              <div class="user-row-sub">@${esc(u.username)}</div>
            </div>
          </div>
          <button class="pill-btn tiny accent">+ Добавить</button>
        `;
        row.querySelector('.user-row-left').onclick = () => openUserCard(u.id);
        row.querySelector('button').onclick = async () => {
          try {
            await api('/api/friends/request', {
              method: 'POST',
              body: JSON.stringify({ target: u.id })
            });
            showToast(`Заявка отправлена ${u.displayName}`);
            box.classList.add('hidden');
            loadFriends();
          } catch (err) {
            showToast(err.message);
          }
        };
        box.appendChild(row);
      });
    } catch (e) {
      showToast(e.message);
    }
  });

  // Invite Friends Modal inside Room
  $('inviteFriendsModalBtn').addEventListener('click', async () => {
    if (!state.room) return;
    const shareUrl = `${window.location.origin}/?room=${state.room.code}`;
    $('inviteShareUrl').value = shareUrl;
    $('inviteModal').classList.remove('hidden');
    await loadFriends();

    const list = $('inviteFriendsList');
    list.innerHTML = '';
    if (!state.friends.length) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:0.84rem;">Скопируйте ссылку выше и отправьте друзьям!</div>';
      return;
    }
    state.friends.forEach(f => {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `
        <div class="user-row-left">
          <span class="status-dot ${f.online ? 'online' : ''}"></span>
          <div class="avatar-circle" style="background:${esc(f.color)}">${avatarInnerHtml(f)}</div>
          <div class="user-row-name">${esc(f.displayName)}</div>
        </div>
        <button class="pill-btn tiny accent">Пригласить</button>
      `;
      row.querySelector('button').onclick = () => {
        inviteFriendToCurrentRoom(f.id);
      };
      list.appendChild(row);
    });
  });

  $('copyShareUrlBtn').addEventListener('click', () => {
    navigator.clipboard.writeText($('inviteShareUrl').value).then(() => {
      showToast('Ссылка скопирована!');
    });
  });

  // ================= WEBRTC VOICE CHAT IN ROOM =================
  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  async function toggleVoiceChat() {
    if (!state.room) return;
    if (state.voiceActive) {
      stopVoiceChat();
      showToast('Голосовой чат выключен');
      return;
    }
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      state.voiceActive = true;
      $('voiceToggleBtn').classList.add('active');
      socket.emit('voice:toggle', { active: true, muted: false });
      showToast('🎙️ Вы подключились к голосовому чату');
    } catch {
      showToast('Нет доступа к микрофону');
    }
  }

  function stopVoiceChat() {
    state.voiceActive = false;
    $('voiceToggleBtn').classList.remove('active');
    if (state.localStream) {
      state.localStream.getTracks().forEach(t => t.stop());
      state.localStream = null;
    }
    for (const pc of state.peers.values()) {
      try { pc.close(); } catch {}
    }
    state.peers.clear();
    $('remoteAudioContainer').innerHTML = '';
    if (state.room) {
      socket.emit('voice:toggle', { active: false, muted: false });
    }
  }

  $('voiceToggleBtn').addEventListener('click', toggleVoiceChat);

  function createPeerConnection(peerSocketId, initiator) {
    if (state.peers.has(peerSocketId)) return state.peers.get(peerSocketId);
    const pc = new RTCPeerConnection(rtcConfig);
    state.peers.set(peerSocketId, pc);

    if (state.localStream) {
      state.localStream.getTracks().forEach(track => pc.addTrack(track, state.localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('voice:signal', { toSocketId: peerSocketId, data: { candidate: e.candidate } });
      }
    };

    pc.ontrack = (e) => {
      let audio = document.getElementById(`audio_${peerSocketId}`);
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio_${peerSocketId}`;
        audio.autoplay = true;
        $('remoteAudioContainer').appendChild(audio);
      }
      audio.srcObject = e.streams[0];
    };

    if (initiator) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socket.emit('voice:signal', { toSocketId: peerSocketId, data: { sdp: offer } });
      });
    }

    return pc;
  }

  socket.on('voice:peer_joined', ({ socketId }) => {
    if (!state.voiceActive) return;
    createPeerConnection(socketId, true);
  });

  socket.on('voice:signal', async ({ fromSocketId, data }) => {
    if (!state.voiceActive) return;
    const pc = createPeerConnection(fromSocketId, false);
    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('voice:signal', { toSocketId: fromSocketId, data: { sdp: answer } });
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch {}
    }
  });

  socket.on('voice:peer_left', ({ socketId }) => {
    const pc = state.peers.get(socketId);
    if (pc) {
      try { pc.close(); } catch {}
      state.peers.delete(socketId);
    }
    const audio = document.getElementById(`audio_${socketId}`);
    if (audio) audio.remove();
  });

  // ================= INITIALIZATION =================
  async function boot() {
    updateNotificationBellUi();
    loadCatalog(true);
    loadPublicRooms();
    await initAuth();
    updateNotificationBellUi();

    // Check URL for ?room=CODE
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    if (roomCode) {
      if (state.user) {
        joinRoomByCode(roomCode);
      } else {
        openAuthModal();
        showToast(`Войдите, чтобы подключиться к комнате #${roomCode.toUpperCase()}`);
      }
    }
  }

  boot();
})();
