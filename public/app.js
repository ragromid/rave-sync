(() => {
  'use strict';

  // Canonical Domain & HTTPS Redirect (always use https://oulo.duckdns.org)
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === '130.61.47.155';
    if ((isIp && host !== '127.0.0.1' && host !== 'localhost') || (host === 'oulo.duckdns.org' && window.location.protocol === 'http:') || host === 'rave-sync.duckdns.org') {
      const target = 'https://oulo.duckdns.org' + window.location.pathname + window.location.search + window.location.hash;
      window.location.replace(target);
      return;
    }
  }

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
    proxyMode: localStorage.getItem('ravelampa_proxy_mode') || 'auto', // 'auto' | 'always' | 'off'
    soundEnabled: localStorage.getItem('ravelampa_sound_enabled') !== 'false',
    inAppNotifsEnabled: localStorage.getItem('ravelampa_inapp_notifs') !== 'false',
    autoSync: localStorage.getItem('ravelampa_auto_sync') !== 'false',

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
    clientId: 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36),
    lastAppliedActionId: '',
    tvMode: /SmartTV|Tizen|Web0S|WebOS|NetCast|BRAVIA|AFT|Android TV|GoogleTV|Viera|Hisense|VIDAA|PhilipsTV|Opera TV|HbbTV/i.test(navigator.userAgent || ''),
    tvCinemaMode: false,
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
    ? window.io({
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
      })
    : { connected: false, on() {}, emit() {} };

  // ================= HELPERS & API =================
  const $ = (id) => document.getElementById(id);

  // ================= UNIFIED MOBILE KEYBOARD & VIEWPORT HANDLER =================
  function setupMobileViewport() {
    let isTyping = false;

    function update() {
      const vv = window.visualViewport;
      const windowH = window.innerHeight;
      const vvH = vv ? Math.round(vv.height) : windowH;
      const offsetTop = vv ? Math.round(vv.offsetTop) : 0;

      const keyboardOverlap = Math.max(0, Math.round(windowH - (offsetTop + vvH)));
      const isKeyboardOpen = isTyping || keyboardOverlap > 50 || (windowH - vvH > 80);

      document.documentElement.style.setProperty('--app-height', `${vvH}px`);
      document.documentElement.style.setProperty('--app-top', `${offsetTop}px`);
      document.body.classList.toggle('keyboard-open', isKeyboardOpen);

      const shell = document.querySelector('.app-shell');
      if (shell) {
        shell.style.height = `${vvH}px`;
        shell.style.top = `${offsetTop}px`;
      }

      if (isKeyboardOpen) {
        if (state.currentView === 'room') {
          const chatMsgs = $('chatMessages');
          if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
          const rDMs = $('roomDmMessages');
          if (rDMs) rDMs.scrollTop = rDMs.scrollHeight;
        } else if (state.currentView === 'friends') {
          const fDMs = $('dmMessages');
          if (fDMs) fDMs.scrollTop = fDMs.scrollHeight;
        }
      }
    }

    document.addEventListener('focusin', (e) => {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (target.classList.contains('chat-input-field') || target.id === 'chatInput' || target.id === 'roomDmInput' || target.id === 'dmInput') {
          isTyping = true;
          document.body.classList.add('keyboard-open');
          setTimeout(() => {
            update();
            const chatMsgs = $('chatMessages');
            if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
          }, 120);
        }
      }
    });

    document.addEventListener('focusout', (e) => {
      const target = e.target;
      if (target && (target.classList.contains('chat-input-field') || target.id === 'chatInput' || target.id === 'roomDmInput' || target.id === 'dmInput')) {
        setTimeout(() => {
          const active = document.activeElement;
          if (!active || (!active.classList?.contains('chat-input-field') && active.id !== 'chatInput' && active.id !== 'roomDmInput' && active.id !== 'dmInput')) {
            isTyping = false;
            document.body.classList.remove('keyboard-open');
            update();
          }
        }, 120);
      }
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', update);
      window.visualViewport.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', () => setTimeout(update, 200));
    update();
  }
  setupMobileViewport();

  // Helper functions for contenteditable and input fields
  function getChatInputValue(elOrId) {
    const el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
    if (!el) return '';
    if (el.isContentEditable) {
      return (el.innerText || el.textContent || '').trim();
    }
    return (el.value || '').trim();
  }

  function setChatInputValue(elOrId, val) {
    const el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
    if (!el) return;
    if (el.isContentEditable) {
      el.innerText = val || '';
    } else {
      el.value = val || '';
    }
  }

  function clearChatInput(elOrId) {
    const el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
    if (!el) return;
    if (el.isContentEditable) {
      el.innerHTML = '';
      el.innerText = '';
    } else {
      el.value = '';
    }
  }

  function focusChatInput(elOrId) {
    const el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
    if (!el) return;
    el.focus();
    if (el.isContentEditable && window.getSelection && document.createRange) {
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}
    }
  }

  function attachChatInputHandlers(inputId, sendBtnId, sendFn) {
    const input = $(inputId);
    const btn = $(sendBtnId);

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendFn();
        }
      });
      if (input.isContentEditable) {
        input.addEventListener('paste', (e) => {
          e.preventDefault();
          const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
          document.execCommand('insertText', false, text);
        });
      }
    }

    if (btn) {
      btn.addEventListener('pointerdown', (e) => {
        // Crucial for iOS: prevent input from losing focus / keyboard from retracting on send click
        e.preventDefault();
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        sendFn();
      });
    }
  }

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
    el.style.background = (u && u.color) || '#00e676';
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
  const notifiedEventIds = new Set();
  let initialFriendsLoaded = false;
  let friendsPollInFlight = false;
  let dmPollInFlight = false;

  socket.on('connect', () => {
    if (state.token) {
      socket.emit('auth:identify', { token: state.token });
    }
    // Auto-rejoin active room if connection was interrupted (server restart, deploy, Wi-Fi blink)
    let activeCode = state.room?.code;
    if (!activeCode) {
      try { activeCode = sessionStorage.getItem('active_room_code'); } catch {}
    }
    if (activeCode) {
      socket.emit('room:join', { code: activeCode, token: state.token });
    }
  });

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function ensureWebPushSubscribed() {
    try {
      if (!state.user || !swRegistration || !swRegistration.pushManager) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      let sub = await swRegistration.pushManager.getSubscription();
      if (!sub) {
        const keyRes = await api('/api/push/vapid-public-key');
        if (!keyRes?.publicKey) return;
        sub = await swRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey)
        });
      }
      if (sub) {
        await api('/api/push/subscribe', {
          method: 'POST',
          body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub })
        });
      }
    } catch {}
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      swRegistration = reg;
      ensureWebPushSubscribed();
    }).catch(() => {});

    navigator.serviceWorker.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'RAVELAMPA_NOTIFICATION_CLICK') {
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
      } else if (msg.type === 'RAVELAMPA_PUSH_EVENT' && msg.payload) {
        const p = msg.payload;
        if (p.type === 'dm_message' && p.msg) {
          const dm = p.msg;
          if (dm.id && !notifiedDmIds.has(dm.id)) {
            notifiedDmIds.add(dm.id);
            playNotificationSound('message');
            flashTabTitle(p.title || 'Новое сообщение');
            showTelegramTopCard({
              title: p.title || 'Друг',
              body: p.body || 'Новое сообщение',
              user: dm.sender,
              onClick: () => {
                if (state.currentView === 'room') {
                  setMobileRoomTab('dms');
                  openRoomDmChat(dm.fromId);
                } else {
                  switchView('friends');
                  openFriendChat(dm.fromId);
                }
              }
            });
          }
          handleIncomingOrOutgoingDm(dm);
          if (activeDmFriendId === dm.fromId || roomActiveDmFriendId === dm.fromId) {
            pollActiveDmChat();
          }
        } else if (p.type === 'room_chat' && p.msg) {
          appendChatMessage(p.msg, true);
        } else if (p.title) {
          playNotificationSound('invite');
          flashTabTitle(p.title);
          showTelegramTopCard({
            title: p.title,
            body: p.body || '',
            user: p.invitePayload?.from || null,
            onClick: () => {
              if (p.data?.roomCode) joinRoomByCode(p.data.roomCode);
              else switchView('friends');
            }
          });
          loadFriends();
        }
      }
    });
  }

  function playNotificationSound(kind = 'message') {
    if (state.soundEnabled === false) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc2.type = 'sine';
      if (kind === 'invite') {
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.11); // A5
        osc2.frequency.setValueAtTime(1174.66, now + 0.11); // D6
      } else {
        osc.frequency.setValueAtTime(659.25, now); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.08); // G5
        osc2.frequency.setValueAtTime(1318.5, now + 0.08); // E6
      }
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.55, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc2.start(now);
      osc.stop(now + 0.35);
      osc2.stop(now + 0.35);
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
          user: state.user || { avatar: '🍏', color: '#00e676' }
        });
      } else {
        triggerAppNotification({
          title: 'Встроенные уведомления включены! 🔔',
          body: 'Вы будете получать всплывающие карточки и звуковой сигнал при новых сообщениях.',
          user: state.user || { avatar: '🔔', color: '#00e676' }
        });
      }
      return;
    }

    try {
      const perm = await requestPermissionCompat();
      updateNotificationBellUi();
      if (perm === 'granted') {
        ensureWebPushSubscribed();
        triggerAppNotification({
          title: 'Уведомления включены! 🔔',
          body: 'Теперь вы будете получать сообщения от друзей и приглашения в комнаты как в Telegram.',
          user: state.user || { avatar: '🔔', color: '#00e676' },
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
        body: 'Уведомления и звук oulo работают отлично!',
        user: state.user || { avatar: '🔔', color: '#00e676' },
        forceSystem: true
      });
    }
  });

  function showTelegramTopCard({ title, body, user, onClick }) {
    if (state.inAppNotifsEnabled === false) return;
    const container = $('tgTopNotifContainer');
    if (!container) return;
    const card = document.createElement('div');
    card.className = 'tg-notif-card';
    const avHtml = avatarInnerHtml(user, '🔔');
    const avBg = (user && user.color) || '#00e676';
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

  let titleFlashTimer = null;
  function flashTabTitle(text) {
    clearTimeout(titleFlashTimer);
    document.title = `💬 ${text} — oulo`;
    titleFlashTimer = setTimeout(() => {
      document.title = 'oulo — совместный просмотр';
    }, 5000);
  }

  function triggerAppNotification({ title, body, user, onClick, data = {}, kind = 'message', forceSystem = false }) {
    playNotificationSound(kind);
    showTelegramTopCard({ title, body, user, onClick });
    flashTabTitle(title);

    if ('Notification' in window && Notification.permission === 'granted') {
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

  // ================= VIEW NAVIGATION =================
  function switchView(viewName) {
    state.currentView = viewName;
    document.body.classList.toggle('in-room-view', viewName === 'room');
    if (viewName !== 'friends') document.body.classList.remove('in-friends-chat');
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

  // Interactive Easter Egg on Brand Logo (#brandLogo)
  let brandClickCombo = 0;
  let brandComboResetTimer = null;
  const easterSecretQuotes = [
    '🎬 Секретный режим oulo активирован — запущен рандомный топ-фильм!',
    '🍿 Пасхалка найдена! Включаем случайный шедевр на вечер...',
    '⚡ oulo OVERDRIVE: выбираем для вас лучший фильм из каталога!',
    '✨ Магия кино активирована — ловите случайную рекомендацию!'
  ];

  function playBrandEasterSound(stage = 1) {
    if (!state.soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const notes = stage >= 5
        ? [523.25, 659.25, 783.99, 1046.5] // C5 - E5 - G5 - C6 chord arpeggio
        : [587.33 + stage * 70, 880 + stage * 90];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = stage >= 5 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.055);
        gain.gain.setValueAtTime(0.08, now + i * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.055);
        osc.stop(now + i * 0.055 + 0.3);
      });
      setTimeout(() => ctx.close().catch(() => {}), 800);
    } catch {}
  }

  function spawnBrandParticles(originEl, count = 14, spread = 65) {
    if (!originEl) return;
    const rect = originEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'oulo-easter-particle';
      const isGreen = i % 3 !== 0;
      const size = Math.round(4 + Math.random() * 5);
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const dist = spread * (0.45 + Math.random() * 0.75);
      const tx = Math.round(Math.cos(angle) * dist);
      const ty = Math.round(Math.sin(angle) * dist);
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${cx - size / 2}px`;
      p.style.top = `${cy - size / 2}px`;
      p.style.background = isGreen ? '#00e676' : '#ffffff';
      p.style.boxShadow = isGreen ? '0 0 10px #00e676' : '0 0 8px #ffffff';
      p.style.setProperty('--tx', `${tx}px`);
      p.style.setProperty('--ty', `${ty}px`);
      p.style.setProperty('--dur', `${500 + Math.round(Math.random() * 350)}ms`);
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 900);
    }
  }

  $('brandLogo').addEventListener('click', () => {
    switchView('explore');
    const brand = $('brandLogo');
    const icon = brand?.querySelector('.brand-icon') || brand;
    brandClickCombo++;
    clearTimeout(brandComboResetTimer);
    brandComboResetTimer = setTimeout(() => {
      brandClickCombo = 0;
    }, 1800);

    if (brand) {
      brand.classList.remove('easter-spin');
      void brand.offsetWidth;
      brand.classList.add('easter-spin');
    }

    if (brandClickCombo >= 5) {
      brandClickCombo = 0;
      spawnBrandParticles(icon, 36, 130);
      playBrandEasterSound(5);
      if (brand) {
        brand.classList.add('easter-overdrive');
        setTimeout(() => brand.classList.remove('easter-overdrive'), 2600);
      }
      const msg = easterSecretQuotes[Math.floor(Math.random() * easterSecretQuotes.length)];
      showToast(msg);
      // Open a random movie from the loaded catalog as a surprise!
      const cards = Array.from(document.querySelectorAll('#catalogGrid .poster-card'));
      if (cards.length > 0) {
        const randomCard = cards[Math.floor(Math.random() * cards.length)];
        setTimeout(() => randomCard.click(), 350);
      }
    } else {
      spawnBrandParticles(icon, 12 + brandClickCombo * 4, 55 + brandClickCombo * 12);
      playBrandEasterSound(brandClickCombo);
      if (brandClickCombo === 3) {
        showToast('👀 Ещё 2 нажатия до секретной пасхалки oulo...');
      }
    }
  });
  $('returnToRoomBtn').addEventListener('click', () => switchView('room'));

  // Modal open/close helpers
  function openModal(id) {
    const el = $(id);
    if (el) el.classList.remove('hidden');
  }
  function closeModal(id) {
    const el = $(id);
    if (el) el.classList.add('hidden');
  }

  // Universal Smart TV & Keyboard Select / OK key detector
  // Handles Samsung Tizen (13, 29443), LG webOS (13, 10182), Android TV / Fire TV (23, 66), and desktop
  function isTvSelectKey(e) {
    if (!e) return false;
    const k = e.key;
    const c = e.keyCode || e.which;
    return (
      k === 'Enter' ||
      k === ' ' ||
      k === 'Spacebar' ||
      k === 'Select' ||
      k === 'OK' ||
      k === 'Accept' ||
      c === 13 ||       // Enter
      c === 32 ||       // Space
      c === 23 ||       // Android TV KEYCODE_DPAD_CENTER
      c === 66 ||       // Android KEYCODE_ENTER
      c === 29443 ||    // Samsung Tizen Enter / OK
      c === 10182 ||    // LG webOS Select
      c === 1536 ||     // LG webOS Wheel Click
      c === 1537 ||     // LG webOS Wheel Click Alt
      c === 10252       // Smart TV OK
    );
  }

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
      $('headerUserAvatar').style.background = '#00e676';
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
      document.querySelectorAll('.btn-toggle-proxy, #toggleProxyStreamBtn').forEach(btn => {
        const btnSpan = btn.querySelector('span');
        if (btnSpan && labels[state.proxyMode]) btnSpan.textContent = labels[state.proxyMode];
        else if (labels[state.proxyMode]) btn.textContent = labels[state.proxyMode];
      });
    }
    updateHeaderUser();
    updateNotificationBellUi();
    ensureWebPushSubscribed();
    if (state.token) {
      socket.emit('auth:identify', { token: state.token });
    }
  }

  async function initAuth() {
    try {
      // Remove any legacy browser cache token so only server session is used
      try { localStorage.removeItem('ravelampa_token'); } catch {}
      const data = await api('/api/auth/me');
      if (data && data.user && data.user.username && data.user.username.startsWith('guest_')) {
        try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
        state.token = '';
        state.user = null;
        updateHeaderUser();
        return;
      }
      applyServerUserData(data);
      loadFriends();
    } catch {
      state.token = '';
      state.user = null;
      updateHeaderUser();
    }
  }

  function computeUserAchievements(st = {}) {
    const badges = [];
    const watchHours = (st.watchSeconds || 0) / 3600;
    const totalWatched = (st.moviesWatched || 0) + (st.episodesWatched || 0) || (st.historyCount || 0);
    if (totalWatched >= 1 || watchHours >= 0.5) {
      badges.push({ ico: '🍿', label: totalWatched >= 25 ? 'Киноман (25+)' : 'Зритель oulo' });
    }
    if (watchHours >= 10) {
      badges.push({ ico: '🦉', label: `${Math.floor(watchHours)}ч в кинозале` });
    }
    if ((st.roomsCreated || 0) >= 1) {
      badges.push({ ico: '👑', label: (st.roomsCreated || 0) >= 10 ? 'Топ-хост комнат' : 'Создатель комнат' });
    }
    if ((st.messagesSent || 0) >= 15 || (st.reactionsSent || 0) >= 15) {
      badges.push({ ico: '🔥', label: 'Душа компании' });
    }
    if ((st.friendsCount || 0) >= 3) {
      badges.push({ ico: '🤝', label: 'Киноклуб' });
    }
    return badges;
  }

  function renderBadgesStrip(containerId, st = {}) {
    const el = $(containerId);
    if (!el) return;
    const badges = computeUserAchievements(st);
    el.innerHTML = badges.map(b => `<span class="ach-badge"><span class="ach-badge-ico">${b.ico}</span><span>${esc(b.label)}</span></span>`).join('');
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
    renderBadgesStrip('profileBadgesStrip', { ...st, friendsCount: friendsCnt, bookmarksCount: bmCnt });
  }

  function switchProfileFolder(target) {
    document.querySelectorAll('.pfolder-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.ptab === target);
    });
    document.querySelectorAll('.pfolder-content').forEach(c => {
      c.classList.toggle('active', c.id === `ptab-${target}`);
    });
    if (target === 'notifications') {
      updateProfileNotifUI();
    } else if (target === 'playback') {
      updateProfilePlaybackUI();
    }
  }

  document.querySelectorAll('.pfolder-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchProfileFolder(tab.dataset.ptab);
    });
  });

  function updateProfileNotifUI() {
    const hasNotifApi = 'Notification' in window;
    const perm = hasNotifApi ? Notification.permission : (inAppSoundUnlocked ? 'granted' : 'default');
    const icon = $('notifFolderIcon');
    const sub = $('notifFolderSub');
    const btn = $('profileNotifToggleBtn');
    const soundToggle = $('profileSoundToggle');
    const inAppToggle = $('profileInAppNotifToggle');

    if (soundToggle) soundToggle.checked = state.soundEnabled !== false;
    if (inAppToggle) inAppToggle.checked = state.inAppNotifsEnabled !== false;

    if (!btn) return;
    if (perm === 'granted' || inAppSoundUnlocked) {
      if (icon) icon.textContent = '🔔';
      if (sub) sub.textContent = 'Оповещения включены и активны в браузере';
      btn.textContent = '🔔 Проверить звук и пуш';
      btn.className = 'btn primary';
    } else if (perm === 'denied') {
      if (icon) icon.textContent = '🔕';
      if (sub) sub.textContent = 'Уведомления заблокированы в настройках браузера';
      btn.textContent = '🔕 Разрешить в браузере';
      btn.className = 'btn glass danger';
    } else {
      if (icon) icon.textContent = '🔔';
      if (sub) sub.textContent = 'Нажмите кнопку, чтобы разрешить системные уведомления';
      btn.textContent = '🔔 Включить уведомления';
      btn.className = 'btn primary';
    }
  }

  $('profileNotifToggleBtn')?.addEventListener('click', async () => {
    const hasGrant = ('Notification' in window && Notification.permission === 'granted');
    if (!hasGrant) {
      await requestBrowserNotificationPermission();
      updateProfileNotifUI();
    } else {
      triggerAppNotification({
        title: 'Проверка уведомлений 🔔',
        body: 'Уведомления и звук oulo работают отлично!',
        user: state.user || { avatar: '🔔', color: '#00e676' },
        forceSystem: true
      });
      showToast('Тестовое уведомление отправлено!');
    }
  });

  $('profileSoundToggle')?.addEventListener('change', (e) => {
    state.soundEnabled = e.target.checked;
    localStorage.setItem('ravelampa_sound_enabled', state.soundEnabled ? 'true' : 'false');
    showToast(state.soundEnabled ? '🔊 Звуки сообщений включены' : '🔇 Звуки сообщений выключены');
  });

  $('profileInAppNotifToggle')?.addEventListener('change', (e) => {
    state.inAppNotifsEnabled = e.target.checked;
    localStorage.setItem('ravelampa_inapp_notifs', state.inAppNotifsEnabled ? 'true' : 'false');
    showToast(state.inAppNotifsEnabled ? '💬 Всплывающие карточки включены' : '💬 Всплывающие карточки выключены');
  });

  function updateProfilePlaybackUI() {
    const grid = $('profileProxyGrid');
    if (grid) {
      grid.querySelectorAll('.proxy-opt-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pmode === state.proxyMode);
      });
    }
    const syncToggle = $('profileSyncToggle');
    if (syncToggle) syncToggle.checked = state.autoSync !== false;

    document.querySelectorAll('.audio-boost-btn').forEach(btn => {
      const val = parseFloat(btn.dataset.boost);
      btn.classList.toggle('active', Math.abs(val - currentVolumeMultiplier) < 0.05);
    });
  }

  document.querySelectorAll('.audio-boost-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = parseFloat(btn.dataset.boost);
      adjustTvVolume(target - currentVolumeMultiplier);
    });
  });

  $('profileProxyGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.proxy-opt-btn');
    if (!btn) return;
    state.proxyMode = btn.dataset.pmode || 'auto';
    localStorage.setItem('ravelampa_proxy_mode', state.proxyMode);
    updateProfilePlaybackUI();
    const modeNames = { auto: '⚡ Авто', always: '🛡️ Всегда через сервер', off: '🚀 Напрямую без прокси' };
    showToast(`Режим потока: ${modeNames[state.proxyMode] || state.proxyMode}`);
  });

  $('profileSyncToggle')?.addEventListener('change', (e) => {
    state.autoSync = e.target.checked;
    localStorage.setItem('ravelampa_auto_sync', state.autoSync ? 'true' : 'false');
    showToast(state.autoSync ? '🔄 Автосинхронизация включена' : '⏸️ Автосинхронизация выключена');
  });

  $('profileClearCacheBtn')?.addEventListener('click', () => {
    localStorage.removeItem('ravelampa_progress');
    showToast('Кэш просмотра очищен');
  });

  $('savePersonalizationBtn')?.addEventListener('click', () => {
    $('profileForm')?.requestSubmit();
  });

  async function openAuthModal(defaultTab = 'profile') {
    const modal = $('authModal');
    modal.classList.remove('hidden');
    if (state.user) {
      $('authGuestView').classList.add('hidden');
      $('authProfileView').classList.remove('hidden');
      switchProfileFolder(defaultTab);
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
        sw.classList.toggle('selected', sw.dataset.color === (state.user.color || '#00e676'));
      });

      populateProfileStats(state.user);
      updateProfileNotifUI();
      updateProfilePlaybackUI();

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

  $('userMenuBtn')?.addEventListener('click', () => openAuthModal('profile'));

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
      try {
        const pendingRoom = sessionStorage.getItem('active_room_code');
        if (pendingRoom) {
          sessionStorage.removeItem('active_room_code');
          joinRoomByCode(pendingRoom);
        }
      } catch {}
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
    const color = document.querySelector('#profileColorPicker .color-swatch.selected')?.dataset.color || state.user.color || '#00e676';
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
      $('ucBio').textContent = u.bio || 'Смотрит фильмы в oulo 🍿';
      const st = u.stats || {};
      renderBadgesStrip('ucBadgesStrip', st);

      const tmBox = $('ucTasteMatchBox');
      if (tmBox) {
        const tm = data.tasteMatch;
        if (tm && (tm.matchPercent > 0 || (tm.theirBookmarks && tm.theirBookmarks.length > 0))) {
          tmBox.classList.remove('hidden');
          const sharedList = (tm.sharedMovies && tm.sharedMovies.length > 0) ? tm.sharedMovies : (tm.theirBookmarks || []).slice(0, 6);
          const sharedLabel = (tm.sharedMovies && tm.sharedMovies.length > 0)
            ? `Общие фильмы (${tm.sharedMovies.length}):`
            : 'Избранное пользователя:';
          tmBox.innerHTML = `
            <div class="taste-match-header">
              <span>🎯 Совместимость вкусов</span>
              <span class="taste-match-pct">${tm.matchPercent || 0}%</span>
            </div>
            <div class="taste-match-bar">
              <div class="taste-match-fill" style="width:${Math.max(6, tm.matchPercent || 0)}%"></div>
            </div>
            ${sharedList.length ? `
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:8px;">${esc(sharedLabel)}</div>
              <div class="taste-shared-strip">
                ${sharedList.map((m, idx) => `<button type="button" class="taste-shared-chip" data-tm-idx="${idx}">🎬 ${esc(m.title)}</button>`).join('')}
              </div>
            ` : ''}
          `;
          tmBox.querySelectorAll('[data-tm-idx]').forEach(btn => {
            btn.onclick = () => {
              const mv = sharedList[Number(btn.dataset.tmIdx)];
              if (mv) {
                $('userCardModal').classList.add('hidden');
                openMovieModal(mv);
              }
            };
          });
        } else {
          tmBox.classList.add('hidden');
          tmBox.innerHTML = '';
        }
      }

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
    if (state.user && (!state.user.username || !state.user.username.startsWith('guest_'))) {
      return true;
    }
    openAuthModal();
    showToast('Войдите или зарегистрируйтесь для продолжения');
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
      state.catalogItems = reset ? items : [...(state.catalogItems || []), ...items];
      if (reset && items.length > 0 && state.tvMode) {
        setTimeout(() => {
          const firstCard = $('catalogGrid').querySelector('.poster-card');
          if (firstCard && (!document.activeElement || document.activeElement === document.body)) {
            firstCard.focus();
          }
        }, 120);
      }
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
    if (state.heroMovie) openMovieModal(state.heroMovie);
  });
  $('heroDetailsBtn').addEventListener('click', () => {
    if (state.heroMovie) openMovieModal(state.heroMovie);
  });

  // Event delegation helper for movie grids so clicking is guaranteed to work
  function setupGridDelegation(gridEl) {
    if (!gridEl || gridEl._delegatedBound) return;
    gridEl._delegatedBound = true;
    gridEl.addEventListener('click', (e) => {
      const card = e.target.closest('.poster-card');
      if (!card) return;
      const movieId = card.dataset.movieId;
      const item = (state.catalogItems || []).find(x => String(x.id) === String(movieId)) ||
                   (state.bookmarks || []).find(x => String(x.id) === String(movieId)) ||
                   (state.history || []).map(h => h.movie).find(x => String(x?.id) === String(movieId));
      if (!item) return;
      openMovieModal(item);
    });
  }

  function renderPosterCards(items, container, clear = true) {
    if (clear) container.innerHTML = '';
    if (!items.length && clear) {
      container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">Пока пусто</div>';
      return;
    }

    // Ensure delegated clicks are active on container
    setupGridDelegation(container);

    for (const item of items) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'poster-card tv-focusable';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', item.title || 'Фильм');
      card.dataset.movieId = String(item.id);
      const posterUrl = item.poster || item.backdrop || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="%23171a29"/></svg>';
      card.innerHTML = `
        <div class="poster-art">
          <img src="${esc(posterUrl)}" loading="lazy" alt="${esc(item.title)}" />
          ${item.vote_average ? `<span class="poster-rating">★ ${esc(item.vote_average)}</span>` : ''}
          <span class="poster-type">${item.type === 'tv' ? 'Сериал' : 'Фильм'}</span>
        </div>
        <div class="poster-title">${esc(item.title)}</div>
        <div class="poster-sub">${esc(item.year || '')}</div>
      `;
      card.addEventListener('click', () => {
        openMovieModal(item);
      });
      card.addEventListener('keydown', (e) => {
        if (isTvSelectKey(e)) {
          e.preventDefault();
          e.stopPropagation();
          openMovieModal(item);
        }
      });
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
    if (!movie) return;
    state.selectedMovie = movie;
    try {
      if ($('modalBackdrop')) {
        $('modalBackdrop').style.backgroundImage = `url('${movie.backdrop || movie.poster || ''}')`;
      }
      if ($('modalPoster')) {
        $('modalPoster').src = movie.poster || movie.backdrop || '';
        $('modalPoster').alt = movie.title || '';
      }
      if ($('modalType')) $('modalType').textContent = movie.type === 'tv' ? 'Сериал' : 'Фильм';
      if ($('modalRating')) $('modalRating').textContent = movie.vote_average ? `★ ${movie.vote_average}` : '★ —';
      if ($('modalYear')) $('modalYear').textContent = movie.year || '';
      if ($('modalTitle')) $('modalTitle').textContent = movie.title || '';
      if ($('modalOrigTitle')) {
        $('modalOrigTitle').textContent = movie.original_title && movie.original_title !== movie.title ? movie.original_title : '';
      }
      if ($('modalOverview')) $('modalOverview').textContent = movie.overview || 'Описание скоро появится.';
      if ($('modalStartPublicRoomLabel')) {
        $('modalStartPublicRoomLabel').textContent = movie.type === 'tv' ? 'Смотреть сериал' : 'Смотреть фильм';
      }

      const isBookmarked = Array.isArray(state.bookmarks) && state.bookmarks.some(m => String(m.id) === String(movie.id));
      updateModalBookmarkUi(isBookmarked);

      if ($('modalPlayInCurrentRoomBtn')) {
        $('modalPlayInCurrentRoomBtn').classList.toggle('hidden', !state.room);
      }
      if ($('modalAddToQueueBtn')) {
        $('modalAddToQueueBtn').classList.toggle('hidden', !state.room);
      }
      $('movieModal').classList.remove('hidden');

      // Auto-focus primary Watch button so Smart TV remote OK/Enter immediately starts watching
      setTimeout(() => {
        const primaryBtn = state.room ? $('modalPlayInCurrentRoomBtn') : $('modalStartPublicRoomBtn');
        if (primaryBtn && !primaryBtn.classList.contains('hidden')) {
          primaryBtn.focus();
        }
      }, 50);

      // Enrich details in background (imdb_id, kinopoisk_id)
      try {
        const det = await api(`/api/catalog/details?id=${encodeURIComponent(movie.id)}&type=${encodeURIComponent(movie.type || 'movie')}`);
        if (det.movie && state.selectedMovie && String(state.selectedMovie.id) === String(movie.id)) {
          state.selectedMovie = det.movie;
          if (det.movie.overview && $('modalOverview')) $('modalOverview').textContent = det.movie.overview;
        }
      } catch {}
    } catch (err) {
      console.error('openMovieModal error, launching movie directly:', err);
      startRoomWithMovie(movie, true);
    }
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

  $('modalAddToQueueBtn')?.addEventListener('click', () => {
    if (!state.selectedMovie || !state.room) return;
    socket.emit('room:queue_add', { movie: state.selectedMovie });
    $('movieModal').classList.add('hidden');
  });

  function updateModalBookmarkUi(isBookmarked) {
    const btn = $('modalBookmarkBtn');
    const lbl = $('modalBookmarkLabel');
    const ico = $('modalBookmarkIcon');
    if (btn) btn.classList.toggle('bookmarked', !!isBookmarked);
    if (lbl) lbl.textContent = isBookmarked ? 'В закладках' : 'В закладки';
    if (ico) ico.setAttribute('fill', isBookmarked ? 'currentColor' : 'none');
  }

  $('modalBookmarkBtn').addEventListener('click', async () => {
    if (!(await ensureAuthenticated()) || !state.selectedMovie) return;
    try {
      const res = await api('/api/bookmarks/toggle', {
        method: 'POST',
        body: JSON.stringify({ movie: state.selectedMovie })
      });
      state.bookmarks = res.bookmarks || [];
      updateModalBookmarkUi(res.added);
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
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'room-card tv-focusable';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
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
    el.addEventListener('keydown', (e) => {
      if (isTvSelectKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        joinRoomByCode(r.code);
      }
    });
    return el;
  }

  async function startRoomWithMovie(movie, isPublic = true) {
    if (!movie) return;
    showToast(`Запуск фильма «${movie.title || 'Фильм'}»...`);
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
    try { sessionStorage.removeItem('active_room_code'); } catch {}
    try { localStorage.removeItem('active_room_code'); } catch {}
    stopVoiceChat();
    destroyPlayers();
    if (socket && socket.connected) {
      socket.emit('room:leave');
    }
    if (prevCode) {
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

  $('joinByCodeBtn')?.addEventListener('click', () => {
    if (state.user) {
      openAuthModal('quick-actions');
    } else {
      $('joinCodeModal')?.classList.remove('hidden');
      $('joinCodeInput')?.focus();
    }
  });

  $('joinCodeForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('joinCodeInput').value.trim().toUpperCase();
    if (!code) return;
    $('joinCodeModal')?.classList.add('hidden');
    $('joinCodeInput').value = '';
    joinRoomByCode(code);
  });

  $('pfolderJoinCodeForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('pfolderJoinCodeInput').value.trim().toUpperCase();
    if (!code) return;
    $('authModal')?.classList.add('hidden');
    $('pfolderJoinCodeInput').value = '';
    joinRoomByCode(code);
  });

  // Custom link (YouTube / MP4 / M3U8)
  function openCustomLinkModal() {
    if (state.user) {
      openAuthModal('quick-actions');
    } else {
      $('customLinkModal')?.classList.remove('hidden');
      $('customLinkUrl')?.focus();
    }
  }
  $('customLinkBtn')?.addEventListener('click', openCustomLinkModal);
  $('openLinkFromRoomBtn')?.addEventListener('click', openCustomLinkModal);
  $('openCatalogFromRoomBtn')?.addEventListener('click', () => switchView('explore'));

  function extractYouTubeId(url) {
    const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  async function handleLaunchCustomVideo(rawUrl, customTitle) {
    if (!(await ensureAuthenticated())) return;
    if (!rawUrl) return;

    $('customLinkModal')?.classList.add('hidden');
    $('authModal')?.classList.add('hidden');

    if (/rezka/i.test(rawUrl)) {
      try {
        setPlayerOverlay(true, true, 'Загружаем HDRezka...');
        const details = await api(`/api/rezka/details?url=${encodeURIComponent(rawUrl)}`);
        const movieObj = {
          id: details.id,
          title: details.title,
          original_title: details.origTitle,
          poster: details.poster,
          serial: details.isSeries ? 1 : 0,
          type: details.isSeries ? 'tv' : 'movie'
        };
        if (state.room) {
          switchView('room');
          await loadZ01ForMovieInRoom(movieObj, true);
        } else {
          await startRoomWithMovie(movieObj, true);
        }
      } catch (err) {
        setPlayerOverlay(false, false, '');
        showToast('Не удалось загрузить ссылку HDRezka: ' + err.message);
      }
      return;
    }

    const ytId = extractYouTubeId(rawUrl);
    const isHls = /\.m3u8(\?|$)/i.test(rawUrl);
    const media = {
      type: ytId ? 'youtube' : 'direct',
      title: customTitle,
      streamUrl: rawUrl,
      youtubeId: ytId || '',
      streamType: ytId ? 'youtube' : (isHls ? 'hls' : 'mp4')
    };

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
  }

  $('customLinkForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUrl = $('customLinkUrl').value.trim();
    const customTitle = $('customLinkTitle').value.trim() || 'Видео по ссылке';
    $('customLinkUrl').value = '';
    $('customLinkTitle').value = '';
    handleLaunchCustomVideo(rawUrl, customTitle);
  });

  $('pfolderCustomLinkForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUrl = $('pfolderCustomLinkUrl').value.trim();
    const customTitle = $('pfolderCustomLinkTitle').value.trim() || 'Видео по ссылке';
    $('pfolderCustomLinkUrl').value = '';
    $('pfolderCustomLinkTitle').value = '';
    handleLaunchCustomVideo(rawUrl, customTitle);
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

      // Auto-select user's preferred voice if available
      const prefVoice = (localStorage.getItem('oulo_preferred_voice') || '').trim().toLowerCase();
      if (prefVoice) {
        if (state.z01.voices.length > 1) {
          const matchVIdx = state.z01.voices.findIndex(v => (v.title || '').toLowerCase().includes(prefVoice));
          if (matchVIdx >= 0 && matchVIdx !== state.z01.activeVoiceIdx && state.z01.voices[matchVIdx].url) {
            renderZ01Panel();
            return queryZ01SubUrl(state.z01.voices[matchVIdx].url, 'voice', matchVIdx);
          }
        } else if (state.z01.videos.length > 1 && !state.z01.seasons.length && !state.z01.videos[0]?.episode) {
          const matchVidIdx = state.z01.videos.findIndex(v => ((v.voice_name || v.title || '').toLowerCase().includes(prefVoice)));
          if (matchVidIdx >= 0) {
            state.z01.activeVideoIdx = matchVidIdx;
          }
        }
      }

      renderZ01Panel();

      if (autoPlay && state.z01.videos[state.z01.activeVideoIdx]) {
        await selectZ01VideoItem(state.z01.activeVideoIdx, true);
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

      const rawQualities = resolved.proxiedQualities || {};
      const sortedQKeys = sortQualityKeys(Object.keys(rawQualities));
      const sortedQualities = {};
      sortedQKeys.forEach(k => { sortedQualities[k] = rawQualities[k]; });
      state.z01.qualities = sortedQualities;

      const prefQuality = localStorage.getItem('oulo_preferred_quality') || '';
      const matchedQ = (prefQuality && sortedQKeys.find(k => k.toLowerCase() === prefQuality.toLowerCase())) || sortedQKeys[0] || item.quality || 'Auto';
      state.z01.activeQuality = matchedQ;
      const needsProxy = resolved.recommendedUrl === resolved.proxyUrl;
      if (state.z01.qualities[matchedQ]) {
        resolved.url = state.z01.qualities[matchedQ].raw || resolved.url;
        resolved.proxyUrl = state.z01.qualities[matchedQ].proxy || resolved.proxyUrl;
        resolved.recommendedUrl = state.proxyMode === 'off'
          ? resolved.url
          : (needsProxy ? (resolved.proxyUrl || resolved.url) : resolved.url);
      }
      renderZ01Panel();

      const activeSource = state.z01.sources.find(s => s.key === state.z01.activeSourceKey);
      const streamUrl = pickStreamUrl(resolved);
      const isHlsResolved = /\.m3u8(\?|$)/i.test(resolved.url || '') || String(resolved.url || '').includes('manifest.m3u8');

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
        qualities: state.z01.qualities,
        needsProxy,
        rawUrl: resolved.url,
        proxyUrl: resolved.proxyUrl,
        recommendedUrl: resolved.recommendedUrl,
        streamUrl,
        streamType: isHlsResolved ? 'hls' : (resolved.streamType || 'hls'),
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

  function sortQualityKeys(keys) {
    const rank = (k) => {
      const s = String(k || '').toLowerCase();
      if (s.includes('2160') || s.includes('4k')) return 2160;
      if (s.includes('1440') || s.includes('2k')) return 1440;
      if (s.includes('1080') || s.includes('fhd')) return 1080;
      if (s.includes('720') || s.includes('hd')) return 720;
      if (s.includes('480')) return 480;
      if (s.includes('360')) return 360;
      if (s.includes('240')) return 240;
      if (s.includes('auto') || s.includes('авто')) return 1;
      return parseInt(s, 10) || 0;
    };
    return [...keys].sort((a, b) => rank(b) - rank(a));
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
        <div class="z01-seg-top">
          <span class="z01-seg-label">${esc(label)}</span>
          <svg class="z01-seg-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
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

    // 1. Sources: Источник Z01 and HDRezka side-by-side
    const z01Sources = sources.filter(s => s.key !== 'hdrezka');
    const rezkaSource = sources.find(s => s.key === 'hdrezka');
    const isRezkaActive = activeSourceKey === 'hdrezka';
    const activeZ01 = z01Sources.find(s => s.key === activeSourceKey) || z01Sources[0];

    // 1A. Balancer Z01 segment
    const z01Seg = document.createElement('div');
    z01Seg.className = `z01-seg ${!isRezkaActive ? 'active' : ''} ${openDropdown === 'source' ? 'open' : ''}`;
    z01Seg.innerHTML = `
      <div class="z01-seg-top">
        <span class="z01-seg-label">Источник Z01</span>
        <svg class="z01-seg-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="z01-seg-val">
        ${activeZ01?.badge ? `<span class="z01-tag">${esc(activeZ01.badge)}</span>` : ''}
        <span>${esc(activeZ01 ? activeZ01.name : 'Z01')}</span>
      </div>
    `;
    z01Seg.addEventListener('click', () => {
      if (isRezkaActive) {
        state.z01.openDropdown = '';
        if (activeZ01) selectZ01Balancer(activeZ01.key, true);
      } else {
        state.z01.openDropdown = state.z01.openDropdown === 'source' ? '' : 'source';
        renderZ01Panel();
      }
    });
    segBox.appendChild(z01Seg);

    // 1B. HDRezka segment (shown side-by-side right next to Источник Z01)
    if (rezkaSource) {
      const rezkaSeg = document.createElement('div');
      rezkaSeg.className = `z01-seg ${isRezkaActive ? 'active' : ''}`;
      rezkaSeg.innerHTML = `
        <span class="z01-seg-label">HDRezka</span>
        <div class="z01-seg-val">
          <span class="z01-tag">${esc(rezkaSource.badge || 'FHD')}</span>
          <span>HDRezka</span>
        </div>
      `;
      rezkaSeg.addEventListener('click', () => {
        if (!isRezkaActive) {
          state.z01.openDropdown = '';
          selectZ01Balancer('hdrezka', true);
        }
      });
      segBox.appendChild(rezkaSeg);
    }

    // 2. Season segment (if series)
    if (seasons.length > 1) {
      const curS = seasons[activeSeasonIdx] || seasons[0];
      addSegment('season', 'Сезон', curS.title);
    }

    // 3. Voice segment
    if (voices.length >= 1) {
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
      z01Sources.forEach(s => {
        const btn = document.createElement('button');
        btn.className = `z01-opt ${s.key === activeSourceKey ? 'active' : ''}`;
        btn.innerHTML = `
          <div class="z01-opt-title">${s.badge ? `<span class="z01-tag">${esc(s.badge)}</span> ` : ''}${esc(s.name)}</div>
          <div class="z01-opt-note">${s.show ? 'Онлайн' : 'Доп. источник'}</div>
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
        btn.onclick = () => {
          if (v.title) localStorage.setItem('oulo_preferred_voice', v.title);
          queryZ01SubUrl(v.url, 'voice', idx);
        };
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
          const vName = v.voice_name || v.title || '';
          if (vName) localStorage.setItem('oulo_preferred_voice', vName);
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
          localStorage.setItem('oulo_preferred_quality', qk);
          state.z01.activeQuality = qk;
          state.z01.openDropdown = '';
          const qObj = qualities[qk];
          if (qObj) {
            if (typeof qObj.hlsLevel === 'number' && state.hls) {
              state.hls.currentLevel = qObj.hlsLevel;
              state.hls.nextLevel = qObj.hlsLevel;
              if (state.room && state.room.media) state.room.media.quality = qk;
              showToast(`Качество: ${qk}`);
            } else if (qObj.raw && state.room && state.room.media) {
              const video = $('mainVideo');
              const currentTime = video.currentTime || 0;
              const wasPlaying = !video.paused;
              const needsProxy = state.room.media.needsProxy !== undefined
                ? state.room.media.needsProxy
                : (state.room.media.recommendedUrl === state.room.media.proxyUrl);
              const nextRecommended = needsProxy ? (qObj.proxy || qObj.raw) : qObj.raw;
              const isHlsUrl = /\.m3u8(\?|$)/i.test(qObj.raw) || String(qObj.raw).includes('manifest.m3u8');

              state.room.media.rawUrl = qObj.raw;
              state.room.media.proxyUrl = qObj.proxy;
              state.room.media.recommendedUrl = nextRecommended;
              state.room.media.quality = qk;
              state.room.media.streamType = isHlsUrl ? 'hls' : 'mp4';
              state.room.media.streamUrl = pickStreamUrl(state.room.media);
              loadMediaIntoPlayer(state.room.media, { playing: wasPlaying, currentTime });
              showToast(`Качество: ${qk}`);
            }
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
    if ($('mobileZ01TabLabel')) {
      $('mobileZ01TabLabel').textContent = isSeriesEpisodes ? 'Озвучка и серии' : 'Озвучка';
    }
    const tvSrcLbl = document.querySelector('#tvSourceBtn .tv-ctrl-lbl');
    if (tvSrcLbl) {
      tvSrcLbl.textContent = isSeriesEpisodes ? 'Озвучка и серии' : 'Озвучка';
    }
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
  function toggleProxyStreamMode() {
    const modes = ['auto', 'always', 'off'];
    const labels = { auto: 'Прокси: Авто', always: 'Прокси: Вкл', off: 'Прокси: Выкл' };
    const nextIdx = (modes.indexOf(state.proxyMode) + 1) % modes.length;
    state.proxyMode = modes[nextIdx];

    document.querySelectorAll('.btn-toggle-proxy, #toggleProxyStreamBtn').forEach(btn => {
      const span = btn.querySelector('span');
      if (span) span.textContent = labels[state.proxyMode];
      else btn.textContent = labels[state.proxyMode];
    });

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
    }
    showToast(`Режим потока: ${labels[state.proxyMode]}`);
  }

  document.querySelectorAll('.btn-toggle-proxy, #toggleProxyStreamBtn').forEach(btn => {
    btn.addEventListener('click', toggleProxyStreamMode);
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
    state.loadedStreamKey = '';
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
    state.loadedStreamKey = media?.streamUrl || media?.youtubeId || '';
    $('unmuteSyncBtn').classList.add('hidden');
    if (!media || (!media.streamUrl && !media.youtubeId)) {
      setPlayerOverlay(true, false, 'Выберите фильм из каталога или источник Z01 ниже');
      return;
    }

    setPlayerOverlay(false, false, '');
    const video = $('mainVideo');
    video.controls = window.innerWidth <= 900;
    state.justLoadedMediaUntil = Date.now() + 2600;

    if (media.qualities && Object.keys(media.qualities).length > 0 && (!state.z01.qualities || Object.keys(state.z01.qualities).length === 0)) {
      state.z01.qualities = media.qualities;
      state.z01.activeQuality = media.quality || Object.keys(media.qualities)[0] || '';
      renderZ01Panel();
    }

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
        lowLatencyMode: false,
        maxBufferLength: 45,             // Buffer up to 45s ahead to eliminate internet hiccups
        maxMaxBufferLength: 120,         // Healthy max buffer
        maxBufferSize: 60 * 1000 * 1000, // 60MB max buffer size
        backBufferLength: 20,            // Clean up played segments (essential for Smart TV memory)
        maxBufferHole: 0.6,              // Bridge micro-drops in video without freeze
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 5,
        manifestLoadingTimeOut: 12000,
        levelLoadingTimeOut: 12000,
        fragLoadingTimeOut: 25000,
        fragLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 5
      });
      state.hls = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        const existingQKeys = Object.keys(state.z01.qualities || {});
        const hasUrlMap = existingQKeys.length > 1 && state.z01.qualities[existingQKeys[0]]?.raw;
        if (!hasUrlMap && Array.isArray(hls.levels) && hls.levels.length > 1) {
          const levelMap = {};
          hls.levels.forEach((lvl, idx) => {
            const h = lvl.height || (lvl.attrs && parseInt(lvl.attrs.RESOLUTION?.split('x')[1], 10)) || 0;
            const label = h ? `${h}p` : `Уровень ${idx + 1}`;
            levelMap[label] = { hlsLevel: idx };
          });
          const sortedLabels = sortQualityKeys(Object.keys(levelMap));
          const orderedMap = {};
          sortedLabels.forEach(k => { orderedMap[k] = levelMap[k]; });
          orderedMap['Авто'] = { hlsLevel: -1 };
          state.z01.qualities = orderedMap;

          const prefQ = localStorage.getItem('oulo_preferred_quality') || '';
          const matchKey = (prefQ && Object.keys(orderedMap).find(k => k.toLowerCase() === prefQ.toLowerCase())) || sortedLabels[0] || 'Авто';
          state.z01.activeQuality = matchKey;
          if (orderedMap[matchKey] && typeof orderedMap[matchKey].hlsLevel === 'number') {
            hls.currentLevel = orderedMap[matchKey].hlsLevel;
          }
          renderZ01Panel();
        }
        onLoaded();
      });
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS network error, attempting auto-recovery...', data.details);
              hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS media error, attempting auto-recovery...', data.details);
              hls.recoverMediaError();
              break;
            default:
              if (media.proxyUrl && streamUrl !== media.proxyUrl) {
                console.log('Direct HLS unrecoverable, falling back to backend stream proxy...');
                media.recommendedUrl = media.proxyUrl;
                media.streamUrl = media.proxyUrl;
                hls.loadSource(media.proxyUrl);
              } else {
                hls.destroy();
                tryFallbackToNextBalancer();
              }
              break;
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
        } else {
          tryFallbackToNextBalancer();
        }
      }, { once: true });
    }
  }

  function tryFallbackToNextBalancer() {
    if (!state.z01 || !Array.isArray(state.z01.sources) || !state.z01.sources.length) return;
    const curSrc = state.z01.sources.find(s => s.key === state.z01.activeSourceKey);
    if (curSrc) curSrc._tried = true;
    const nextCandidate = state.z01.sources.find(s => s.show && s.key !== state.z01.activeSourceKey && !s._tried);
    if (nextCandidate) {
      showToast(`Поток недоступен, переключаем на ${nextCandidate.name}...`);
      selectZ01Balancer(nextCandidate.key, true);
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

  function emitPlayerSync(action, extra = {}) {
    if (!state.room || state.suppressSyncEmit) return;
    if (!state.room.media || state.room.media.streamType === 'youtube') return;

    // Guard: if this device just loaded the stream at 0:00 while the room is already ahead, request sync instead of resetting room!
    if (Date.now() < state.justLoadedMediaUntil && (mainVideo.currentTime || 0) < 2 && action !== 'seek' && action !== 'remote') {
      socket.emit('player:request_sync');
      return;
    }

    const now = Date.now();
    if (action === 'timeupdate' && now - state.lastSyncAt < 3000) return;
    state.lastSyncAt = now;

    const payload = {
      action,
      playing: typeof extra.playing === 'boolean' ? extra.playing : !mainVideo.paused,
      currentTime: typeof extra.currentTime === 'number' ? extra.currentTime : (mainVideo.currentTime || 0),
      rate: mainVideo.playbackRate || 1,
      clientId: state.clientId,
      ...extra
    };

    if (socket.connected) {
      socket.emit('player:sync', payload);
    } else {
      api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
        method: 'POST',
        body: JSON.stringify(payload)
      }).then(res => {
        if (res?.room?.playback?.lastActionId) {
          state.lastAppliedActionId = res.room.playback.lastActionId;
        }
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

  mainVideo.addEventListener('play', () => {
    updateTvOsdUi();
    emitPlayerSync('play');
  });
  mainVideo.addEventListener('pause', () => {
    updateTvOsdUi();
    if (mainVideo.seeking) return;
    emitPlayerSync('pause');
  });
  mainVideo.addEventListener('seeked', () => {
    updateTvOsdUi();
    emitPlayerSync('seek');
  });
  mainVideo.addEventListener('timeupdate', () => {
    updateTvOsdUi();
  });
  mainVideo.addEventListener('loadedmetadata', () => {
    updateTvOsdUi();
  });
  mainVideo.addEventListener('ratechange', () => emitPlayerSync('rate'));
  mainVideo.addEventListener('volumechange', () => {
    if (!mainVideo.muted) $('unmuteSyncBtn').classList.add('hidden');
    updateTvOsdUi();
  });

  // Periodic 2.5s Heartbeat for tight multi-device sync + watch time stats + Serverless HTTP Room Poll
  setInterval(async () => {
    if (!state.room) return;

    // If running on Vercel Serverless (where WebSockets are disabled), poll room state via HTTP
    if (!socket.connected) {
      try {
        const isHost = state.user && state.room.hostId === state.user.id;
        const recentlyActed = Date.now() - state.lastSyncAt < 3500;
        const body = isHost && state.room.media && state.room.media.streamType !== 'youtube' && !mainVideo.paused && !recentlyActed
          ? { action: 'heartbeat', playing: true, currentTime: mainVideo.currentTime || 0, rate: mainVideo.playbackRate || 1, clientId: state.clientId }
          : { clientId: state.clientId };
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
          } else if (res.room.playback) {
            const pb = res.room.playback;
            const hasNewExplicitCmd = pb.lastActionId && pb.lastActionId !== state.lastAppliedActionId && pb.actorClientId !== state.clientId;
            if (hasNewExplicitCmd) {
              state.lastAppliedActionId = pb.lastActionId;
              applyRemoteSync({ ...pb, action: pb.lastAction || 'sync' }, false);
            } else if (!isHost) {
              applyRemoteSync(pb, true);
            }
          }
        }
      } catch (err) {
        if (err && err.message && (err.message.includes('найдена') || err.message.includes('закрыта') || err.message.includes('404'))) {
          showToast('Комната была закрыта');
          leaveRoom();
          switchView('explore');
        }
      }
      return;
    }

    if (!state.room.media || state.room.media.streamType === 'youtube') return;
    if (mainVideo.paused || state.suppressSyncEmit) return;
    if (Date.now() < state.justLoadedMediaUntil && (mainVideo.currentTime || 0) < 2) return;
    socket.emit('player:heartbeat', {
      playing: !mainVideo.paused,
      currentTime: mainVideo.currentTime || 0,
      rate: mainVideo.playbackRate || 1,
      watchDelta: 2.5,
      clientId: state.clientId
    });
  }, 2500);

  // Fast HTTP DM poll when in Friends / Room DMs
  async function pollActiveDmChat() {
    if (!state.user || dmPollInFlight) return;
    const targetFriendId = state.currentView === 'friends' ? activeDmFriendId : (state.currentView === 'room' ? roomActiveDmFriendId : null);
    if (!targetFriendId) return;
    dmPollInFlight = true;
    try {
      const data = await api(`/api/dms/${encodeURIComponent(targetFriendId)}`);
      if (data.friend) {
        const idx = state.friends.findIndex(x => x.id === data.friend.id);
        if (idx >= 0) state.friends[idx] = { ...state.friends[idx], ...data.friend };
        if (activeDmFriendId === data.friend.id) updateDmHeader(data.friend);
      }
      syncDmMessagesFromPoll(targetFriendId, data.messages || []);
    } catch {} finally {
      dmPollInFlight = false;
    }
  }
  setInterval(pollActiveDmChat, 1200);

  async function triggerPlayerResync() {
    if (socket.connected) {
      socket.emit('player:request_sync');
    } else if (state.room) {
      try {
        const res = await api(`/api/rooms/${encodeURIComponent(state.room.code)}`);
        if (res.room?.playback) applyRemoteSync({ ...res.room.playback, action: 'resync' }, false);
      } catch {}
    }
    showToast('Синхронизировано с комнатой');
  }

  document.querySelectorAll('.btn-resync-player, #resyncPlayerBtn').forEach(btn => {
    btn.addEventListener('click', triggerPlayerResync);
  });

  function applyRemoteSync(data, isHeartbeat = false) {
    if (!state.room || !state.room.media || state.room.media.streamType === 'youtube') return;
    if (!mainVideo.src && !state.hls) return;

    if (data.lastActionId) {
      state.lastAppliedActionId = data.lastActionId;
    }

    const targetTime = Number(data.currentTime) || 0;
    const curTime = mainVideo.currentTime || 0;
    const timeDiff = targetTime - curTime;
    const absDiff = Math.abs(timeDiff);

    state.suppressSyncEmit = true;

    // Remote volume / mute control (e.g. from Phone TV Remote to Smart TV)
    if (!isHeartbeat && (data.action === 'volume' || data.action === 'mute')) {
      if (typeof data.volume === 'number') {
        const nextMultiplier = Math.max(0, Math.min(2.5, data.volume));
        currentVolumeMultiplier = nextMultiplier;
        localStorage.setItem('oulo_volume_multiplier', String(currentVolumeMultiplier));
        mainVideo.volume = Math.min(1, nextMultiplier);
        if (typeof audioBoostGain !== 'undefined' && audioBoostGain && audioBoostCtx) {
          if (audioBoostCtx.state === 'suspended') audioBoostCtx.resume().catch(() => {});
          audioBoostGain.gain.setTargetAtTime(nextMultiplier, audioBoostCtx.currentTime, 0.05);
        }
      }
      if (typeof data.muted === 'boolean') {
        mainVideo.muted = data.muted;
        $('unmuteSyncBtn').classList.toggle('hidden', !mainVideo.muted);
      }
      const pct = Math.round((currentVolumeMultiplier ?? 1) * 100);
      const boostLabel = (currentVolumeMultiplier ?? 1) > 1 ? ' (Усиление)' : '';
      showTvCenterFeedback(mainVideo.muted ? '🔇' : ((currentVolumeMultiplier ?? 1) > 1 ? '📢' : '🔊'), mainVideo.muted ? 'Без звука' : `Громкость ${pct}%${boostLabel}`);
      updateTvOsdUi();
      updateProfilePlaybackUI();
    }

    if (isHeartbeat) {
      // Smooth Sync Algorithm (No Buffer Flush Stuttering):
      // 1. Tiny drift (< 0.8s): completely imperceptible, do nothing!
      if (absDiff < 0.8) {
        if (mainVideo.playbackRate !== (data.rate || 1.0)) {
          mainVideo.playbackRate = data.rate || 1.0;
        }
      }
      // 2. Moderate drift (0.8s - 3.5s): gently speed up / slow down by 4% to smoothly catch up without flushing video buffer!
      else if (absDiff <= 3.5) {
        const baseRate = data.rate || 1.0;
        const adjustedRate = timeDiff > 0 ? baseRate * 1.04 : baseRate * 0.96;
        if (Math.abs(mainVideo.playbackRate - adjustedRate) > 0.01) {
          mainVideo.playbackRate = adjustedRate;
        }
      }
      // 3. Massive drift (> 3.5s): long pause/buffering occurred, perform hard seek
      else {
        mainVideo.playbackRate = data.rate || 1.0;
        try { mainVideo.currentTime = targetTime; } catch {}
      }
    } else if (data.action === 'seek' || data.action === 'resync' || absDiff > 4.0) {
      // Explicit user seek or resync
      mainVideo.playbackRate = data.rate || 1.0;
      try { mainVideo.currentTime = targetTime; } catch {}
      if (data.actor) {
        showSyncBadge(`${data.actor.avatar || '🍿'} ${data.actor.displayName} перемотал(а)`);
      }
    }

    if (data.rate && !isHeartbeat && mainVideo.playbackRate !== data.rate) {
      mainVideo.playbackRate = data.rate;
    }

    if (data.playing && mainVideo.paused) {
      mainVideo.play().then(() => {
        $('unmuteSyncBtn').classList.toggle('hidden', !mainVideo.muted);
        updateTvOsdUi();
      }).catch(() => {
        mainVideo.muted = true;
        $('unmuteSyncBtn').classList.remove('hidden');
        mainVideo.play().catch(() => {});
        updateTvOsdUi();
      });
      if (!isHeartbeat && data.actor) {
        showSyncBadge(`${data.actor.avatar || '▶️'} ${data.actor.displayName} нажал(а) Play`);
        showTvCenterFeedback('▶️', 'Воспроизведение');
      }
    } else if (!data.playing && !mainVideo.paused && !isHeartbeat) {
      mainVideo.pause();
      updateTvOsdUi();
      if (data.actor) {
        showSyncBadge(`${data.actor.avatar || '⏸️'} ${data.actor.displayName} поставил(а) на паузу`);
        showTvCenterFeedback('⏸️', 'Пауза');
      }
    }

    updateTvOsdUi();
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

  // ================= SMART TV PLAYER OSD, REMOTE DECK & D-PAD ENGINE =================
  let tvOsdHideTimer = null;
  let tvFeedbackTimer = null;

  function formatTvTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    const mm = mins < 10 ? '0' + mins : String(mins);
    const ss = rem < 10 ? '0' + rem : String(rem);
    return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function showTvCenterFeedback(icon, text) {
    const box = $('tvCenterFeedback');
    const icoEl = $('tvFeedbackIcon');
    const txtEl = $('tvFeedbackText');
    if (!box || !icoEl || !txtEl) return;
    icoEl.textContent = icon || '▶️';
    txtEl.textContent = text || '';
    box.classList.remove('hidden');
    clearTimeout(tvFeedbackTimer);
    tvFeedbackTimer = setTimeout(() => {
      box.classList.add('hidden');
    }, 1150);
  }

  function updateTvOsdUi() {
    const cur = mainVideo.currentTime || 0;
    const dur = (mainVideo.duration && isFinite(mainVideo.duration)) ? mainVideo.duration : 0;
    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;

    if ($('tvTimeCurrent')) $('tvTimeCurrent').textContent = formatTvTime(cur);
    if ($('tvTimeDuration')) $('tvTimeDuration').textContent = formatTvTime(dur);
    if ($('tvTimelineFill')) $('tvTimelineFill').style.width = `${pct.toFixed(2)}%`;
    if ($('tvTimelineThumb')) $('tvTimelineThumb').style.left = `${pct.toFixed(2)}%`;

    const isPaused = mainVideo.paused;
    if ($('tvPlayPauseIcon')) {
      $('tvPlayPauseIcon').innerHTML = isPaused
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
    }
    if ($('tvPlayPauseLabel')) $('tvPlayPauseLabel').textContent = isPaused ? 'Плей' : 'Пауза';

    const effectiveVol = (typeof currentVolumeMultiplier !== 'undefined' && currentVolumeMultiplier !== null) ? currentVolumeMultiplier : (mainVideo.volume ?? 1);
    const volPct = mainVideo.muted ? 'Выкл' : `${Math.round(effectiveVol * 100)}%`;
    if ($('tvMuteIcon')) {
      $('tvMuteIcon').innerHTML = (mainVideo.muted || effectiveVol === 0)
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
    }
    if ($('tvVolumeLabel')) $('tvVolumeLabel').textContent = volPct;

    // Also update Remote Deck modal if open
    if ($('tvRemoteTimeText')) {
      $('tvRemoteTimeText').textContent = `${formatTvTime(cur)} / ${formatTvTime(dur)}`;
    }
    if ($('tvRemoteStateBadge')) {
      $('tvRemoteStateBadge').textContent = isPaused ? '⏸ Пауза' : '▶️ Идёт показ';
    }
    if ($('tvRemotePlayIcon')) {
      $('tvRemotePlayIcon').textContent = isPaused ? '▶️' : '⏸️';
    }
    if ($('tvRemotePlayLbl')) {
      $('tvRemotePlayLbl').textContent = isPaused ? 'Плей' : 'Пауза';
    }
  }

  function wakeTvOsd(focusFirstBtn = false) {
    const osd = $('tvPlayerOsd');
    if (!osd || !state.room || !state.room.media) return;
    updateTvOsdUi();
    osd.classList.remove('hidden');
    clearTimeout(tvOsdHideTimer);
    if (focusFirstBtn) {
      const playBtn = $('tvPlayPauseBtn');
      if (playBtn && !osd.contains(document.activeElement)) {
        playBtn.focus();
      }
    }
    tvOsdHideTimer = setTimeout(() => {
      // Keep visible if paused or if user is actively focusing a TV control button
      if (mainVideo.paused) return;
      if (osd.contains(document.activeElement) && state.tvMode) return;
      osd.classList.add('hidden');
    }, 4200);
  }

  function toggleTvPlayPause() {
    if (!state.room || !state.room.media) return;
    wakeTvOsd();
    if (mainVideo.paused) {
      mainVideo.play().then(() => {
        showTvCenterFeedback('▶️', 'Воспроизведение');
        updateTvOsdUi();
      }).catch(() => {
        mainVideo.muted = true;
        $('unmuteSyncBtn').classList.remove('hidden');
        mainVideo.play().catch(() => {});
        showTvCenterFeedback('▶️', 'Воспроизведение');
        updateTvOsdUi();
      });
    } else {
      mainVideo.pause();
      showTvCenterFeedback('⏸️', 'Пауза');
      updateTvOsdUi();
    }
  }

  function seekTvRelative(deltaSec) {
    if (!state.room || !state.room.media) return;
    wakeTvOsd();
    const baseTime = (mainVideo.src || state.hls)
      ? (mainVideo.currentTime || 0)
      : (state.room?.playback?.currentTime || 0);
    const dur = (mainVideo.duration && isFinite(mainVideo.duration)) ? mainVideo.duration : 999999;
    const nextTime = Math.max(0, Math.min(dur, baseTime + deltaSec));
    if (mainVideo.src || state.hls) {
      try { mainVideo.currentTime = nextTime; } catch {}
    }
    const sign = deltaSec > 0 ? '+' : '';
    showTvCenterFeedback(deltaSec > 0 ? '⏩' : '⏪', `${sign}${deltaSec} сек (${formatTvTime(nextTime)})`);
    updateTvOsdUi();
    emitPlayerSync('seek', { currentTime: nextTime, playing: !mainVideo.paused });
  }

  // ================= DYNAMIC AUDIO BOOSTER (UP TO 250% LOUDNESS) =================
  let audioBoostCtx = null;
  let audioBoostSource = null;
  let audioBoostGain = null;
  let audioBoostCompressor = null;
  let currentVolumeMultiplier = parseFloat(localStorage.getItem('oulo_volume_multiplier') || '1.8'); // 180% boost by default!

  function initAudioBooster() {
    if (audioBoostGain) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioBoostCtx = new AudioCtx();
      audioBoostSource = audioBoostCtx.createMediaElementSource(mainVideo);
      audioBoostGain = audioBoostCtx.createGain();

      // Professional limiter compressor to prevent distortion or clipping when sound is boosted up to 250%
      audioBoostCompressor = audioBoostCtx.createDynamicsCompressor();
      audioBoostCompressor.threshold.setValueAtTime(-4, audioBoostCtx.currentTime);
      audioBoostCompressor.knee.setValueAtTime(8, audioBoostCtx.currentTime);
      audioBoostCompressor.ratio.setValueAtTime(14, audioBoostCtx.currentTime);
      audioBoostCompressor.attack.setValueAtTime(0.002, audioBoostCtx.currentTime);
      audioBoostCompressor.release.setValueAtTime(0.2, audioBoostCtx.currentTime);

      audioBoostGain.gain.setValueAtTime(currentVolumeMultiplier, audioBoostCtx.currentTime);

      audioBoostSource.connect(audioBoostGain);
      audioBoostGain.connect(audioBoostCompressor);
      audioBoostCompressor.connect(audioBoostCtx.destination);
    } catch (e) {
      console.warn('AudioBooster init fallback:', e);
    }
  }

  function ensureAudioBoosterActive() {
    if (!audioBoostGain) initAudioBooster();
    if (audioBoostCtx && audioBoostCtx.state === 'suspended') {
      audioBoostCtx.resume().catch(() => {});
    }
  }

  document.addEventListener('click', ensureAudioBoosterActive, { passive: true });
  document.addEventListener('touchstart', ensureAudioBoosterActive, { passive: true });
  mainVideo.addEventListener('play', ensureAudioBoosterActive);

  function adjustTvVolume(delta) {
    wakeTvOsd();
    ensureAudioBoosterActive();
    let nextVol = Math.round((currentVolumeMultiplier + delta) * 10) / 10;
    nextVol = Math.max(0, Math.min(2.5, nextVol));
    currentVolumeMultiplier = nextVol;
    localStorage.setItem('oulo_volume_multiplier', String(currentVolumeMultiplier));

    if (nextVol === 0) {
      mainVideo.muted = true;
    } else {
      mainVideo.muted = false;
      mainVideo.volume = Math.min(1, nextVol);
      if (audioBoostGain && audioBoostCtx) {
        if (audioBoostCtx.state === 'suspended') audioBoostCtx.resume().catch(() => {});
        audioBoostGain.gain.setTargetAtTime(nextVol, audioBoostCtx.currentTime, 0.05);
      }
    }

    if (!mainVideo.muted) $('unmuteSyncBtn').classList.add('hidden');
    const pct = Math.round(nextVol * 100);
    const boostLabel = nextVol > 1 ? ' (Усиление)' : '';
    showTvCenterFeedback(nextVol === 0 ? '🔇' : (nextVol > 1 ? '📢' : '🔊'), nextVol === 0 ? 'Без звука' : `Громкость ${pct}%${boostLabel}`);
    updateTvOsdUi();
    updateProfilePlaybackUI();
    emitPlayerSync('remote', { remoteCmd: 'volume', volume: nextVol, muted: mainVideo.muted });
  }

  function toggleTvMute() {
    wakeTvOsd();
    ensureAudioBoosterActive();
    mainVideo.muted = !mainVideo.muted;
    if (!mainVideo.muted && currentVolumeMultiplier === 0) {
      currentVolumeMultiplier = 1.0;
      localStorage.setItem('oulo_volume_multiplier', '1.0');
    }
    if (!mainVideo.muted) {
      mainVideo.volume = Math.min(1, currentVolumeMultiplier);
      if (audioBoostGain && audioBoostCtx) {
        audioBoostGain.gain.setTargetAtTime(currentVolumeMultiplier, audioBoostCtx.currentTime, 0.05);
      }
      $('unmuteSyncBtn').classList.add('hidden');
    }
    const pct = Math.round(currentVolumeMultiplier * 100);
    showTvCenterFeedback(mainVideo.muted ? '🔇' : '🔊', mainVideo.muted ? 'Без звука' : `Звук ${pct}%`);
    updateTvOsdUi();
    updateProfilePlaybackUI();
    emitPlayerSync('remote', { remoteCmd: 'mute', volume: currentVolumeMultiplier, muted: mainVideo.muted });
  }

  function switchTvEpisode(deltaIdx) {
    const videos = state.z01?.videos || [];
    if (videos.length <= 1) {
      showTvCenterFeedback('🎬', 'Одна серия / фильм');
      return;
    }
    const nextIdx = (state.z01.activeVideoIdx || 0) + deltaIdx;
    if (nextIdx < 0 || nextIdx >= videos.length) {
      showTvCenterFeedback('🎬', deltaIdx > 0 ? 'Это последняя серия' : 'Это первая серия');
      return;
    }
    const item = videos[nextIdx];
    const epNum = item.episode || (nextIdx + 1);
    showTvCenterFeedback(deltaIdx > 0 ? '⏭' : '⏮', `${epNum} серия`);
    selectZ01VideoItem(nextIdx, true);
  }

  function toggleTvFullscreen() {
    const wrapper = $('playerWrapper');
    if (!wrapper) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else if (wrapper.requestFullscreen) {
      wrapper.requestFullscreen().catch(() => {
        if (mainVideo.webkitEnterFullscreen) mainVideo.webkitEnterFullscreen();
      });
    } else if (wrapper.webkitRequestFullscreen) {
      wrapper.webkitRequestFullscreen();
    } else if (mainVideo.webkitEnterFullscreen) {
      mainVideo.webkitEnterFullscreen();
    }
  }

  function toggleTvCinemaMode() {
    state.tvCinemaMode = !state.tvCinemaMode;
    document.body.classList.toggle('tv-cinema-mode', state.tvCinemaMode);
    showTvCenterFeedback('📺', state.tvCinemaMode ? 'Режим ТВ: Широкий экран' : 'Обычный режим');
  }

  function setSmartTvMode(enabled) {
    state.tvMode = !!enabled;
    document.body.classList.toggle('tv-mode', state.tvMode);
    if ($('tvModeToggleBtn')) {
      $('tvModeToggleBtn').textContent = state.tvMode
        ? '✅ Режим Smart TV включён (крупные кнопки + пульт)'
        : '🖥️ Режим Smart TV (крупные кнопки для пульта)';
    }
  }
  if (state.tvMode) setSmartTvMode(true);

  // Bind TV OSD Buttons
  $('tvPlayPauseBtn')?.addEventListener('click', (e) => { e.stopPropagation(); toggleTvPlayPause(); });
  $('tvRewindBtn')?.addEventListener('click', (e) => { e.stopPropagation(); seekTvRelative(-10); });
  $('tvForwardBtn')?.addEventListener('click', (e) => { e.stopPropagation(); seekTvRelative(10); });
  $('tvPrevEpBtn')?.addEventListener('click', (e) => { e.stopPropagation(); switchTvEpisode(-1); });
  $('tvNextEpBtn')?.addEventListener('click', (e) => { e.stopPropagation(); switchTvEpisode(1); });
  $('tvMuteBtn')?.addEventListener('click', (e) => { e.stopPropagation(); toggleTvMute(); });
  $('tvCinemaBtn')?.addEventListener('click', (e) => { e.stopPropagation(); toggleTvCinemaMode(); });
  $('tvFullscreenBtn')?.addEventListener('click', (e) => { e.stopPropagation(); toggleTvFullscreen(); });
  $('tvSourceBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setMobileRoomTab('z01');
    const panel = $('z01Panel');
    if (panel) {
      panel.classList.remove('hidden');
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const firstBtn = panel.querySelector('button');
      if (firstBtn) firstBtn.focus();
    }
  });

  // Timeline click/scrub
  $('tvTimelineBar')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const bar = $('tvTimelineBar');
    const dur = mainVideo.duration;
    if (!bar || !dur || !isFinite(dur)) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = ratio * dur;
    try { mainVideo.currentTime = target; } catch {}
    showTvCenterFeedback('⏩', formatTvTime(target));
    updateTvOsdUi();
    emitPlayerSync('seek', { currentTime: target, playing: !mainVideo.paused });
  });

  // Wake OSD on mouse/pointer movement inside playerWrapper
  $('playerWrapper')?.addEventListener('mousemove', () => wakeTvOsd(false));
  $('playerWrapper')?.addEventListener('touchstart', () => wakeTvOsd(false), { passive: true });

  // On desktop (> 900px), native video controls are hidden so only the custom oulo OSD is shown:
  // single-click on video toggles Play/Pause, double-click toggles Fullscreen
  mainVideo.addEventListener('click', (e) => {
    if (window.innerWidth > 900) {
      e.preventDefault();
      toggleTvPlayPause();
    }
  });
  mainVideo.addEventListener('dblclick', (e) => {
    if (window.innerWidth > 900) {
      e.preventDefault();
      toggleTvFullscreen();
    }
  });
  window.addEventListener('resize', () => {
    if (state.loadedStreamKey) {
      mainVideo.controls = window.innerWidth <= 900;
    }
  });
  function toggleSmartTvOsd() {
    const isTv = !document.body.classList.contains('tv-mode');
    setSmartTvMode(isTv);
    if (isTv) {
      wakeTvOsd(true);
      showToast('Управление пультом ТВ активно (стрелки ◀ ▶ и OK)');
    } else {
      $('tvPlayerOsd')?.classList.add('hidden');
      showToast('Кнопки ТВ скрыты');
    }
  }

  document.querySelectorAll('.btn-toggle-tv-osd, #toggleTvOsdBtn').forEach(btn => {
    btn.addEventListener('click', toggleSmartTvOsd);
  });

  // Open TV Remote Control Modal Deck
  function openTvRemoteModalDeck() {
    if ($('tvRemoteMovieTitle')) {
      $('tvRemoteMovieTitle').textContent = state.room?.media?.title || state.room?.name || 'Управление видео на ТВ';
    }
    updateTvOsdUi();
    openModal('tvRemoteModal');
  }

  document.querySelectorAll('.btn-open-tv-remote, #openTvRemoteBtn').forEach(btn => {
    btn.addEventListener('click', openTvRemoteModalDeck);
  });

  // Room Options Deck helper buttons
  $('optionsInviteBtn')?.addEventListener('click', () => $('inviteFriendsModalBtn')?.click());
  $('optionsCopyLinkBtn')?.addEventListener('click', () => $('copyRoomCodeBtn')?.click());
  $('optionsLeaveRoomBtn')?.addEventListener('click', leaveRoom);

  document.querySelectorAll('[data-tv-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.tvCmd;
      if (cmd === 'toggle_play') toggleTvPlayPause();
      else if (cmd === 'seek_-10') seekTvRelative(-10);
      else if (cmd === 'seek_+10') seekTvRelative(10);
      else if (cmd === 'seek_-30') seekTvRelative(-30);
      else if (cmd === 'seek_+30') seekTvRelative(30);
      else if (cmd === 'vol_up') adjustTvVolume(0.1);
      else if (cmd === 'vol_down') adjustTvVolume(-0.1);
      else if (cmd === 'toggle_mute') toggleTvMute();
      else if (cmd === 'prev_ep') switchTvEpisode(-1);
      else if (cmd === 'next_ep') switchTvEpisode(1);
      else if (cmd === 'toggle_tv_mode') {
        setSmartTvMode(!state.tvMode);
        showToast(state.tvMode ? 'Режим Smart TV включён' : 'Режим Smart TV выключен');
      } else if (cmd === 'open_z01') {
        closeModal('tvRemoteModal');
        setMobileRoomTab('z01');
        const panel = $('z01Panel');
        if (panel) {
          panel.classList.remove('hidden');
          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    });
  });

  // 2D Spatial D-Pad Navigation for Smart TV Remotes (Catalog, Modals, Z01 Voices/Episodes, Sidebar)
  function isElemVisible(el) {
    if (!el || el.disabled) return false;
    if (el.closest('.hidden')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  }

  function getFocusableElements() {
    const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (openModal) {
      return Array.from(openModal.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')).filter(isElemVisible);
    }
    const selector = '.poster-card, .room-card, .cat-pill, .ep-btn, .z01-seg-btn, .z01-opt, .tv-ctrl-btn, .tv-timeline-bar, .nav-item, .bnav-item, button, input:not([type="hidden"])';
    return Array.from(document.querySelectorAll(selector)).filter(el => {
      if (!isElemVisible(el)) return false;
      const viewPage = el.closest('.view-page');
      if (viewPage && !viewPage.classList.contains('active')) return false;
      return true;
    });
  }

  function moveSpatialDpadFocus(dir) {
    setSmartTvMode(true);
    const items = getFocusableElements();
    if (!items.length) return false;

    const cur = document.activeElement;
    if (!cur || cur === document.body || !items.includes(cur)) {
      const firstPoster = items.find(el => el.classList.contains('poster-card') || el.classList.contains('room-card')) || items[0];
      firstPoster.focus();
      firstPoster.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return true;
    }

    const curRect = cur.getBoundingClientRect();
    const cx = curRect.left + curRect.width / 2;
    const cy = curRect.top + curRect.height / 2;

    let bestEl = null;
    let bestScore = Infinity;

    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const dx = ex - cx;
      const dy = ey - cy;

      if (dir === 'left' && dx >= -6) continue;
      if (dir === 'right' && dx <= 6) continue;
      if (dir === 'up' && dy >= -6) continue;
      if (dir === 'down' && dy <= 6) continue;

      const primaryDist = (dir === 'left' || dir === 'right') ? Math.abs(dx) : Math.abs(dy);
      const crossDist = (dir === 'left' || dir === 'right') ? Math.abs(dy) : Math.abs(dx);

      // Weight cross-axis distance heavier so D-Pad stays in the same row/column naturally
      const score = primaryDist + crossDist * 2.6;
      if (score < bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    if (bestEl) {
      bestEl.focus();
      bestEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      return true;
    }
    return false;
  }

  // Global Smart TV Remote (D-Pad / Media Keys / WebOS / Tizen / Android TV) Key Handler
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
    if (isInput) {
      if (e.key === 'Escape' || e.keyCode === 10009 || e.keyCode === 461) {
        e.target.blur();
      }
      return;
    }

    const key = e.key || '';
    const kc = e.keyCode || e.which || 0;

    // 1. Hardware Media Keys on Smart TV Remotes (Tizen, webOS, Android TV, Hisense, Philips)
    if (key === 'MediaPlayPause' || kc === 179) {
      e.preventDefault();
      toggleTvPlayPause();
      return;
    }
    if (key === 'MediaPlay' || kc === 415) {
      e.preventDefault();
      if (mainVideo.paused) toggleTvPlayPause();
      return;
    }
    if (key === 'MediaPause' || key === 'MediaStop' || kc === 19 || kc === 413) {
      e.preventDefault();
      if (!mainVideo.paused) toggleTvPlayPause();
      return;
    }
    if (key === 'MediaRewind' || kc === 412) {
      e.preventDefault();
      seekTvRelative(-10);
      return;
    }
    if (key === 'MediaFastForward' || kc === 417) {
      e.preventDefault();
      seekTvRelative(10);
      return;
    }
    if (key === 'MediaTrackNext' || kc === 176 || kc === 425) {
      e.preventDefault();
      switchTvEpisode(1);
      return;
    }
    if (key === 'MediaTrackPrevious' || kc === 177 || kc === 424) {
      e.preventDefault();
      switchTvEpisode(-1);
      return;
    }

    // Back button on Tizen (10009) / webOS (461) / Escape
    if (key === 'Escape' || key === 'GoBack' || kc === 10009 || kc === 461) {
      const openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
      if (openModals.length > 0) {
        e.preventDefault();
        openModals.forEach(m => m.classList.add('hidden'));
        return;
      }
      if (state.tvCinemaMode) {
        e.preventDefault();
        toggleTvCinemaMode();
        return;
      }
    }

    const anyModalOpen = document.querySelectorAll('.modal-backdrop:not(.hidden)').length > 0;
    const dirMap = {
      ArrowLeft: 'left', 37: 'left',
      ArrowRight: 'right', 39: 'right',
      ArrowUp: 'up', 38: 'up',
      ArrowDown: 'down', 40: 'down'
    };
    const dpadDir = dirMap[key] || dirMap[kc] || null;

    // 2. If any modal is open OR we are in Catalog / Rooms / Saved / Friends view -> D-Pad navigates cards & buttons!
    const hasLoadedStream = !!(state.room?.media?.streamUrl || state.room?.media?.youtubeId);
    const inZ01OrOverlay = document.activeElement && (
      document.activeElement.closest('#z01Panel') ||
      document.activeElement.closest('#playerEmptyOverlay') ||
      document.activeElement.closest('.room-topbar')
    );

    if (anyModalOpen || state.currentView !== 'room' || !hasLoadedStream || inZ01OrOverlay) {
      if (dpadDir) {
        e.preventDefault();
        moveSpatialDpadFocus(dpadDir);
        return;
      }
      if (isTvSelectKey(e)) {
        let active = document.activeElement;
        if (!active || active === document.body) {
          active = document.querySelector('.modal-backdrop:not(.hidden) button, #catalogGrid .poster-card, #heroWatchPartyBtn');
        }
        if (active && active !== document.body) {
          e.preventDefault();
          active.click();
          return;
        }
      }
      return;
    }

    // 3. Room Video Player Keyboard & D-Pad Shortcuts when video is active in Room view
    if (state.currentView === 'room' && state.room && !anyModalOpen) {
      const osd = $('tvPlayerOsd');
      const controlsRow = $('tvControlsRow');
      const activeInControls = controlsRow && controlsRow.contains(document.activeElement);
      const isTimelineFocused = document.activeElement === $('tvTimelineBar');

      // Space or K: Play/Pause anytime in room (unless a specific button is focused and Enter was pressed)
      if (key === ' ' || key === 'Spacebar' || key.toLowerCase() === 'k') {
        if (!activeInControls) {
          e.preventDefault();
          toggleTvPlayPause();
          return;
        }
      }

      // Enter / OK on TV remote: if no specific button is focused (or body/video is focused), toggle Play/Pause & wake OSD!
      if (isTvSelectKey(e)) {
        const focusedTag = document.activeElement ? document.activeElement.tagName.toUpperCase() : '';
        if (!focusedTag || focusedTag === 'BODY' || focusedTag === 'VIDEO' || document.activeElement === $('playerWrapper') || isTimelineFocused) {
          e.preventDefault();
          toggleTvPlayPause();
          return;
        }
      }

      // Left / Right Arrows:
      // - If focused inside TV control buttons row, move focus Left/Right between buttons!
      // - Otherwise (or if focused on timeline/video/body), seek -10s / +10s!
      if (dpadDir === 'left') {
        if (activeInControls && !isTimelineFocused) {
          e.preventDefault();
          const btns = Array.from(controlsRow.querySelectorAll('.tv-ctrl-btn'));
          const idx = btns.indexOf(document.activeElement);
          if (idx > 0) btns[idx - 1].focus();
          wakeTvOsd();
          return;
        }
        e.preventDefault();
        seekTvRelative(-10);
        return;
      }

      if (dpadDir === 'right') {
        if (activeInControls && !isTimelineFocused) {
          e.preventDefault();
          const btns = Array.from(controlsRow.querySelectorAll('.tv-ctrl-btn'));
          const idx = btns.indexOf(document.activeElement);
          if (idx >= 0 && idx < btns.length - 1) btns[idx + 1].focus();
          wakeTvOsd();
          return;
        }
        e.preventDefault();
        seekTvRelative(10);
        return;
      }

      // Down Arrow in Room:
      // - Wakes OSD and focuses Play/Pause button
      // - If already in TV control buttons row, moves down to Z01 panel (voices/episodes)
      if (dpadDir === 'down') {
        if (osd && osd.classList.contains('hidden')) {
          e.preventDefault();
          wakeTvOsd(true);
          return;
        }
        if (isTimelineFocused) {
          e.preventDefault();
          $('tvPlayPauseBtn')?.focus();
          wakeTvOsd();
          return;
        }
        if (activeInControls) {
          const z01First = document.querySelector('#z01Panel:not(.hidden) button');
          if (z01First) {
            e.preventDefault();
            z01First.focus();
            z01First.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
          }
        }
        e.preventDefault();
        adjustTvVolume(-0.1);
        return;
      }

      if (dpadDir === 'up') {
        if (activeInControls) {
          e.preventDefault();
          $('tvTimelineBar')?.focus();
          wakeTvOsd();
          return;
        }
        if (isTimelineFocused) {
          e.preventDefault();
          $('leaveRoomBtn')?.focus();
          return;
        }
        e.preventDefault();
        adjustTvVolume(0.1);
        return;
      }

      // Quick keys: F (Fullscreen), M (Mute), N (Next ep), P (Prev ep)
      if (key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleTvFullscreen();
        return;
      }
      if (key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleTvMute();
        return;
      }
      if (key.toLowerCase() === 'n') {
        e.preventDefault();
        switchTvEpisode(1);
        return;
      }
      if (key.toLowerCase() === 'p') {
        e.preventDefault();
        switchTvEpisode(-1);
        return;
      }
    }
  });

  // ================= SOCKET.IO & ROOM EVENTS =================
  socket.on('rooms:public_list', (list) => {
    renderPublicRooms(list || []);
  });

  function forceEvictToHomeScreen(reason = 'Комната закрыта администратором') {
    // 1. Immediately exit full-screen mode if video was fullscreen
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement) {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    } catch {}

    // 2. Tear down players, audio streams and WebRTC
    try { stopVoiceChat(); } catch {}
    try { destroyPlayers(); } catch {}

    // 3. Clear stored room tokens and state
    try { sessionStorage.removeItem('active_room_code'); } catch {}
    try { localStorage.removeItem('active_room_code'); } catch {}
    state.room = null;

    // 4. Save eviction notice to show toast on home screen
    try {
      sessionStorage.setItem('eviction_notice', reason);
    } catch {}

    // 5. Force instant navigation to main screen (/)
    window.location.replace('/');
  }

  function handleRoomClosedEviction(data) {
    const targetCode = data?.code ? String(data.code).replace(/^#/, '').trim().toUpperCase() : null;
    const currentCode = state.room?.code ? String(state.room.code).replace(/^#/, '').trim().toUpperCase() : null;
    const urlCode = new URLSearchParams(window.location.search).get('room')?.replace(/^#/, '').trim().toUpperCase();
    let storedCode = '';
    try { storedCode = (sessionStorage.getItem('active_room_code') || '').replace(/^#/, '').trim().toUpperCase(); } catch {}

    // If specific room code given, check if this client is part of it
    if (targetCode) {
      const match = (currentCode && currentCode === targetCode) ||
                    (urlCode && urlCode === targetCode) ||
                    (storedCode && storedCode === targetCode);
      if (!match && state.currentView !== 'room') {
        return; // Client not in this room
      }
    }

    forceEvictToHomeScreen(data?.reason || data?.message || 'Комната закрыта администратором');
  }

  socket.on('room:closed', handleRoomClosedEviction);
  socket.on('room:kicked', handleRoomClosedEviction);
  socket.on('room:evicted', handleRoomClosedEviction);

  socket.on('room:error', ({ error }) => {
    try { sessionStorage.removeItem('active_room_code'); } catch {}
    try { localStorage.removeItem('active_room_code'); } catch {}
    if (state.currentView === 'room' || window.location.search.includes('room=')) {
      forceEvictToHomeScreen(error || 'Комната недоступна');
    } else {
      showToast(error || 'Ошибка комнаты');
    }
  });

  async function handleRoomJoined(room) {
    const isRejoin = state.room && state.room.code === room.code;
    state.room = room;
    try { sessionStorage.setItem('active_room_code', room.code); } catch {}
    switchView('room');
    setMobileRoomTab('chat');

    // Update URL query param so user can share or refresh
    const url = new URL(window.location.href);
    url.searchParams.set('room', room.code);
    window.history.replaceState({}, '', url.toString());

    renderRoomHeader(room);
    renderRoomParticipants(room.participants || []);
    renderRoomMessages(room.messages || []);
    renderRoomQueue(room.queue || []);

    if (room.media) {
      const streamKey = room.media.streamUrl || room.media.youtubeId || '';
      const isAlreadyPlayingSameMedia = isRejoin && state.loadedStreamKey && state.loadedStreamKey === streamKey;

      if (room.media.type === 'z01' && room.media.movie) {
        if (room.media.streamUrl) {
          if (isAlreadyPlayingSameMedia) {
            applyRemoteSync(room.playback, false);
          } else {
            loadMediaIntoPlayer(room.media, room.playback);
          }
          loadZ01ForMovieInRoom(room.media.movie, false);
        } else {
          await loadZ01ForMovieInRoom(room.media.movie, true);
        }
      } else {
        $('z01Panel').classList.add('hidden');
        if (isAlreadyPlayingSameMedia) {
          applyRemoteSync(room.playback, false);
        } else {
          loadMediaIntoPlayer(room.media, room.playback);
        }
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
    renderRoomQueue(room.queue || []);
  });

  socket.on('room:queue_updated', (queue) => {
    if (state.room) state.room.queue = queue || [];
    renderRoomQueue(queue || []);
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
    if (!text) return;
    const lower = text.toLowerCase();
    if (lower.includes('закрыта администратором') || lower.includes('закрыты администратором') || lower.includes('выселен')) {
      forceEvictToHomeScreen(text);
      return;
    }
    showToast(text);
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
        clearChatInput(c.inputId);
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
    focusChatInput(c.inputId);
  }

  function setComposerEdit(target, msg, friendId = null) {
    const c = composers[target];
    if (!c) return;
    c.replyTo = null;
    c.editingMsg = { id: msg.id, text: msg.text || '', friendId };
    renderComposerBar(target);
    setChatInputValue(c.inputId, msg.text || '');
    focusChatInput(c.inputId);
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
      html += `<div class="chat-author" style="color:${esc(u.color || '#00e676')}">${esc(u.displayName || 'Пользователь')}</div>`;
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
      <div class="chat-av" style="background:${esc(u?.color || '#00e676')}">${avatarInnerHtml(u)}</div>
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
        appendChatMessage(m, true);
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

          if (state.user && m.fromId !== state.user.id && !notifiedDmIds.has(m.id)) {
            notifiedDmIds.add(m.id);
            const friend = state.friends.find(x => x.id === friendId) || m.sender || { id: friendId, displayName: 'Друг' };
            const preview = m.text || (m.viewOnce ? '💣 Одноразовое фото' : '📷 Фотография');
            triggerAppNotification({
              title: friend.displayName || 'Друг',
              body: preview,
              user: friend,
              data: { friendId, tag: 'dm-msg-' + m.id },
              onClick: () => {
                if (state.currentView === 'room') {
                  setMobileRoomTab('dms');
                  openRoomDmChat(friendId);
                } else {
                  switchView('friends');
                  openFriendChat(friendId);
                }
              }
            });
          }
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
  function updateVoiceSettingsUi() {
    const active = !!state.voiceActive;
    const voiceToggleBtn = $('voiceToggleBtn');
    if (voiceToggleBtn) voiceToggleBtn.classList.toggle('active', active);

    const voiceBtn = $('settingsVoiceToggleBtn');
    const voiceSub = $('settingsVoiceSub');
    const voiceBadge = $('settingsVoiceBadge');

    if (voiceBtn) voiceBtn.classList.toggle('active', active);
    if (voiceSub) voiceSub.textContent = active ? 'Микрофон включен' : 'Микрофон отключен';
    if (voiceBadge) voiceBadge.textContent = active ? 'Отключить' : 'Включить';
  }

  function openRoomSettingsModal() {
    if (!state.room) return;
    const room = state.room;
    if ($('settingsRoomCode')) $('settingsRoomCode').textContent = `#${room.code}`;
    if ($('settingsModalRoomTitle')) $('settingsModalRoomTitle').textContent = room.name || 'Комната';

    const isHost = state.user && room.hostId === state.user.id;
    const hostGroup = $('settingsHostGroup');
    if (hostGroup) hostGroup.style.display = isHost ? 'flex' : 'none';

    const privBadge = $('settingsModalPrivacyBadge');
    if (privBadge) {
      privBadge.textContent = room.isPublic ? 'Публичная' : 'Приватная';
      privBadge.className = `badge tiny ${room.isPublic ? 'accent' : ''}`;
    }

    const privAction = $('settingsPrivacyAction');
    if (privAction) {
      privAction.textContent = room.isPublic ? 'Сделать приватной' : 'Сделать публичной';
    }

    const privIcon = $('settingsPrivacyIcon');
    if (privIcon) {
      privIcon.innerHTML = room.isPublic
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    }

    const privSub = $('settingsPrivacySub');
    if (privSub) {
      privSub.textContent = room.isPublic ? 'В общем каталоге комнат' : 'Доступ только по прямой ссылке';
    }

    updateVoiceSettingsUi();
    openModal('roomSettingsModal');
  }

  function toggleRoomPrivacy() {
    if (!state.room) return;
    const nextPublic = !state.room.isPublic;
    state.room.isPublic = nextPublic;
    socket.emit('room:settings', { isPublic: nextPublic });
    if (!socket.connected) {
      api(`/api/rooms/${encodeURIComponent(state.room.code)}/sync`, {
        method: 'POST',
        body: JSON.stringify({ settings: { isPublic: nextPublic } })
      }).catch(() => {});
    }
    const privBadge = $('settingsModalPrivacyBadge');
    if (privBadge) {
      privBadge.textContent = nextPublic ? 'Публичная' : 'Приватная';
      privBadge.className = `badge tiny ${nextPublic ? 'accent' : ''}`;
    }
    const roomBadge = $('roomPrivacyBadge');
    if (roomBadge) {
      roomBadge.textContent = nextPublic ? 'Публичная' : 'Приватная';
      roomBadge.className = `badge tiny ${nextPublic ? 'accent' : ''}`;
    }
    const privAction = $('settingsPrivacyAction');
    if (privAction) privAction.textContent = nextPublic ? 'Сделать приватной' : 'Сделать публичной';
    const privIcon = $('settingsPrivacyIcon');
    if (privIcon) {
      privIcon.innerHTML = nextPublic
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    }
    const privSub = $('settingsPrivacySub');
    if (privSub) privSub.textContent = nextPublic ? 'В общем каталоге комнат' : 'Доступ только по прямой ссылке';
    showToast(nextPublic ? 'Комната теперь публичная' : 'Комната теперь приватная (только по коду/ссылке)');
  }

  function renderRoomHeader(room) {
    $('roomTitleText').textContent = room.name;
    const privBadge = $('roomPrivacyBadge');
    if (privBadge) {
      privBadge.textContent = room.isPublic ? 'Публичная' : 'Приватная';
      privBadge.className = `badge tiny ${room.isPublic ? 'accent' : ''}`;
    }
    $('roomCodeLabel').textContent = `#${room.code}`;
    if ($('roomCodeOptionsDisplay')) $('roomCodeOptionsDisplay').textContent = `#${room.code}`;
    if ($('settingsRoomCode')) $('settingsRoomCode').textContent = `#${room.code}`;
    $('roomSettingsBtn')?.classList.remove('hidden');
  }

  $('roomSettingsBtn')?.addEventListener('click', openRoomSettingsModal);
  $('viewersInviteBtn')?.addEventListener('click', () => $('inviteFriendsModalBtn')?.click());
  $('settingsInviteFriendsBtn')?.addEventListener('click', () => {
    closeModal('roomSettingsModal');
    $('inviteFriendsModalBtn')?.click();
  });
  $('settingsVoiceToggleBtn')?.addEventListener('click', () => {
    toggleVoiceChat();
    updateVoiceSettingsUi();
  });
  $('settingsTogglePrivacyBtn')?.addEventListener('click', toggleRoomPrivacy);
  $('settingsResyncBtn')?.addEventListener('click', () => {
    closeModal('roomSettingsModal');
    $('resyncPlayerBtn')?.click();
  });
  $('settingsTvRemoteBtn')?.addEventListener('click', () => {
    closeModal('roomSettingsModal');
    openModal('tvRemoteModal');
  });
  $('settingsLeaveRoomBtn')?.addEventListener('click', () => {
    closeModal('roomSettingsModal');
    leaveRoom();
  });

  function renderRoomParticipants(list) {
    $('roomUserCount').textContent = list.length;
    const mobCnt = $('roomUserCountMobile');
    if (mobCnt) mobCnt.textContent = list.length;
    const headCnt = $('roomViewersHeadCount');
    if (headCnt) headCnt.textContent = list.length;
    const container = $('roomParticipantsList');
    container.innerHTML = '';
    list.forEach(p => {
      const isHost = state.room && p.id === state.room.hostId;
      const row = document.createElement('div');
      row.className = 'user-row viewer-card-row';
      row.innerHTML = `
        <div class="user-row-left">
          <div class="viewer-avatar-wrap">
            <div class="avatar-circle" style="background:${esc(p.color || '#00e676')}">${avatarInnerHtml(p)}</div>
            <span class="viewer-online-dot"></span>
          </div>
          <div class="viewer-meta-col">
            <div class="user-row-name">
              <span>${esc(p.displayName)}</span>
              ${isHost ? '<span class="viewer-role-badge">Хост</span>' : ''}
              ${p.inVoice ? '<span class="viewer-voice-badge">В эфире</span>' : ''}
            </div>
            <div class="user-row-sub">@${esc(p.username)}</div>
          </div>
        </div>
        <svg class="viewer-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      `;
      row.addEventListener('click', () => openUserCard(p.id));
      container.appendChild(row);
    });
  }

  function renderRoomMessages(messages) {
    const box = $('chatMessages');
    box.innerHTML = '';
    messages.forEach(m => {
      if (m.id) notifiedDmIds.add(m.id);
      appendChatMessage(m, false);
    });
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
      if (!isOwn && (!msg.id || !notifiedDmIds.has(msg.id))) {
        if (msg.id) notifiedDmIds.add(msg.id);
        if (state.mobileRoomTab !== 'chat') {
          state.unreadChatCount++;
          const badge = $('chatUnreadBadge');
          if (badge) {
            badge.textContent = state.unreadChatCount;
            badge.classList.remove('hidden');
          }
        }
        const preview = msg.text || (msg.viewOnce ? '🔥 Одноразовое фото' : '📷 Фотография');
        triggerAppNotification({
          title: `${msg.user?.displayName || 'Участник'} (в комнате)`,
          body: preview,
          user: msg.user,
          data: { roomCode: state.room?.code, tag: 'roomchat-' + (msg.id || Date.now()) },
          onClick: () => setMobileRoomTab('chat')
        });
      }
    }
    box.appendChild(el);
    refreshMessageGrouping(box);
    box.scrollTop = box.scrollHeight;
  }

  async function sendActiveRoomChat() {
    if (!state.room) return;
    const input = $('chatInput');
    const text = getChatInputValue(input);
    const comp = composers.room;

    // Handle Edit Mode in Room Chat
    if (comp.editingMsg) {
      const editId = comp.editingMsg.id;
      clearChatInput(input);
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

    clearChatInput(input);
    focusChatInput(input);
    comp.imageUrl = '';
    comp.viewOnce = false;
    comp.replyTo = null;
    renderComposerBar('room');

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

  attachChatInputHandlers('chatInput', 'chatSendBtn', sendActiveRoomChat);

  // Mobile Room Quick Switcher (💬 Чат | 🎬 Серии | 👥 Зрители | 💌 Друзья | ⚙️ Опции)
  function setMobileRoomTab(tabName) {
    state.mobileRoomTab = tabName;
    const layout = document.querySelector('.room-layout');
    document.querySelectorAll('.m-rtab').forEach(b => {
      b.classList.toggle('active', b.dataset.mrtab === tabName);
    });
    if (tabName === 'z01') {
      layout?.classList.add('mobile-tab-z01');
      $('z01Panel')?.classList.remove('hidden');
    } else {
      layout?.classList.remove('mobile-tab-z01');
      const validTabs = ['chat', 'users', 'dms', 'options'];
      const rtab = validTabs.includes(tabName) ? tabName : 'chat';
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
      } else if (rtab === 'options') {
        openRoomSettingsModal();
      }
    }
  }

  document.querySelectorAll('.m-rtab').forEach(btn => {
    btn.addEventListener('click', () => setMobileRoomTab(btn.dataset.mrtab));
  });

  // Mobile Landscape auto-switch to Chat
  function checkMobileOrientation() {
    const isLandscape = window.innerWidth > window.innerHeight && window.innerHeight <= 600;
    if (isLandscape) {
      document.body.classList.add('mobile-landscape');
      // If currently viewing room, immediately switch to Chat tab
      if (state.room || $('view-room')?.classList.contains('active')) {
        setMobileRoomTab('chat');
      }
    } else {
      document.body.classList.remove('mobile-landscape');
    }
  }
  window.addEventListener('resize', checkMobileOrientation);
  window.addEventListener('orientationchange', () => {
    setTimeout(checkMobileOrientation, 60);
    setTimeout(checkMobileOrientation, 220);
  });

  // Desktop Sidebar tabs (💬 Чат | 👥 Зрители | 💌 Друзья | ⚙️ Опции)
  document.querySelectorAll('.side-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const rtab = tab.dataset.rtab;
      document.querySelectorAll('.side-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.rtab-content').forEach(c => c.classList.remove('active'));
      $(`rtab-${rtab}`)?.classList.add('active');
      if (rtab === 'chat') {
        state.unreadChatCount = 0;
        $('chatUnreadBadge')?.classList.add('hidden');
        const box = $('chatMessages');
        if (box) box.scrollTop = box.scrollHeight;
      } else if (rtab === 'dms') {
        renderRoomDmFriendsList();
      } else if (rtab === 'options') {
        openRoomSettingsModal();
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
    if (friendsPollInFlight) return;
    friendsPollInFlight = true;
    try {
      const data = await api('/api/friends');
      const newFriends = data.friends || [];
      const newIncoming = data.incoming || [];
      const serverNotifs = data.notifications || [];

      // Detect new incoming DMs & friend requests for notifications
      for (const f of newFriends) {
        const incomingCandidates = Array.isArray(f.recentIncoming) && f.recentIncoming.length > 0
          ? f.recentIncoming
          : (f.lastMessage && f.lastMessage.fromId !== state.user.id ? [f.lastMessage] : []);

        for (const msgItem of incomingCandidates) {
          if (!msgItem || !msgItem.id || msgItem.fromId === state.user.id) continue;
          if (!initialFriendsLoaded) {
            notifiedDmIds.add(msgItem.id);
          } else if (!notifiedDmIds.has(msgItem.id)) {
            notifiedDmIds.add(msgItem.id);
            triggerAppNotification({
              title: f.displayName,
              body: msgItem.text || 'Новое сообщение',
              user: f,
              data: { friendId: f.id, tag: 'dm-msg-' + msgItem.id },
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
            if (activeDmFriendId === f.id || roomActiveDmFriendId === f.id) {
              pollActiveDmChat();
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
        if (!n) continue;
        if (!initialFriendsLoaded) {
          if (n.id) notifiedEventIds.add(n.id);
          if (n.msgId) notifiedDmIds.add(n.msgId);
          continue;
        }
        if (n.id && notifiedEventIds.has(n.id)) continue;
        if (n.id) notifiedEventIds.add(n.id);

        if (n.type === 'room_invite' && n.invitePayload) {
          const { from, room } = n.invitePayload;
          triggerAppNotification({
            title: `${from.displayName} зовёт в комнату! 🍿`,
            body: `Смотреть вместе: «${room.mediaTitle}»`,
            user: from,
            kind: 'invite',
            data: { roomCode: room.code, tag: 'invite-' + (n.id || room.code) },
            onClick: () => joinRoomByCode(room.code)
          });
        } else if (n.type === 'dm_message') {
          if (!n.msgId || !notifiedDmIds.has(n.msgId)) {
            if (n.msgId) notifiedDmIds.add(n.msgId);
            const senderId = n.fromId || n.from?.id;
            triggerAppNotification({
              title: n.title || n.from?.displayName || 'Новое сообщение',
              body: n.body || 'Новое сообщение',
              user: n.from,
              data: { friendId: senderId, tag: 'dm-msg-' + (n.msgId || n.id || Date.now()) },
              onClick: () => {
                if (!senderId) return switchView('friends');
                if (state.currentView === 'room') {
                  setMobileRoomTab('dms');
                  openRoomDmChat(senderId);
                } else {
                  switchView('friends');
                  openFriendChat(senderId);
                }
              }
            });
            if (senderId && (activeDmFriendId === senderId || roomActiveDmFriendId === senderId)) {
              pollActiveDmChat();
            }
          }
        } else if (n.title) {
          triggerAppNotification({
            title: n.title,
            body: n.body || '',
            kind: 'invite',
            data: { tag: 'ntf-' + (n.id || Date.now()) },
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
    } catch {} finally {
      friendsPollInFlight = false;
    }
  }

  // Fast background poll every 1.5s (plus unthrottled Web Worker ticker when tab is in background)
  function runBackgroundSyncTick() {
    if (!state.user) return;
    loadFriends();
    pollActiveDmChat();
  }
  setInterval(runBackgroundSyncTick, 1500);

  try {
    const workerBlob = new Blob([
      'setInterval(function(){ postMessage("tick"); }, 2000);'
    ], { type: 'application/javascript' });
    const bgWorker = new Worker(URL.createObjectURL(workerBlob));
    bgWorker.onmessage = () => {
      if (document.hidden && state.user) {
        runBackgroundSyncTick();
      }
    };
  } catch {}

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.user) {
      loadFriends();
      pollActiveDmChat();
    }
  });
  window.addEventListener('focus', () => {
    if (state.user) {
      loadFriends();
      pollActiveDmChat();
    }
  });

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
    if ($('dmFriendStatus')) {
      if (friend.currentRoom) {
        $('dmFriendStatus').innerHTML = `<span class="dm-status-dot online"></span><span>Смотрит: ${esc(friend.currentRoom.mediaTitle)}</span>`;
      } else if (friend.online) {
        $('dmFriendStatus').innerHTML = '<span class="dm-status-dot online"></span><span>В сети</span>';
      } else {
        $('dmFriendStatus').innerHTML = '<span class="dm-status-dot"></span><span>Не в сети</span>';
      }
    }
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
    document.body.classList.add('in-friends-chat');
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
        msgs.forEach(m => {
          if (m.id) notifiedDmIds.add(m.id);
          box.appendChild(createRichMessageElement(m, 'dm', 'dm', friendId));
        });
        refreshMessageGrouping(box);
        box.scrollTop = box.scrollHeight;
      }
      focusChatInput('dmInput');
    } catch (e) {
      box.innerHTML = `<div style="text-align:center;color:var(--danger);padding:20px;">${esc(e.message)}</div>`;
    }
  }

  $('dmBackBtn')?.addEventListener('click', () => {
    $('friendsLayout')?.classList.remove('chat-open');
    document.body.classList.remove('in-friends-chat');
  });

  async function submitDirectMessageForm(friendId, inputId, composerKey) {
    if (!friendId) return;
    const input = $(inputId);
    const text = getChatInputValue(input);
    const comp = composers[composerKey];

    // Handle Edit Mode in Direct Messages
    if (comp && comp.editingMsg) {
      const editId = comp.editingMsg.id;
      clearChatInput(input);
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

    clearChatInput(input);
    focusChatInput(input);
    if (comp) {
      comp.imageUrl = '';
      comp.viewOnce = false;
      comp.replyTo = null;
      renderComposerBar(composerKey);
    }

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

  attachChatInputHandlers('dmInput', 'dmSendBtn', () => {
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
      (data.messages || []).forEach(m => {
        if (m.id) notifiedDmIds.add(m.id);
        box.appendChild(createRichMessageElement(m, 'dm', 'roomDm', friendId));
      });
      refreshMessageGrouping(box);
      box.scrollTop = box.scrollHeight;
      focusChatInput('roomDmInput');
    } catch {}
  }

  $('roomDmBackBtn')?.addEventListener('click', () => {
    roomActiveDmFriendId = null;
    $('roomDmChatView')?.classList.add('hidden');
    $('roomDmFriendsView')?.classList.remove('hidden');
    renderRoomDmFriendsList();
  });

  attachChatInputHandlers('roomDmInput', 'roomDmSendBtn', () => {
    submitDirectMessageForm(roomActiveDmFriendId, 'roomDmInput', 'roomDm');
  });

  function handleIncomingOrOutgoingDm(msg) {
    if (!state.user) return;
    const otherId = msg.fromId === state.user.id ? msg.toId : msg.fromId;
    const friend = state.friends.find(x => x.id === otherId);
    const previewText = msg.text || (msg.viewOnce ? '🔥 Одноразовое фото' : (msg.hasPhoto || msg.hasImage || msg.imageUrl ? '📷 Фотография' : ''));
    if (friend) {
      friend.lastMessage = {
        id: msg.id,
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
      if ((isViewingInFriendsPage || isViewingInRoomSidebar) && !document.hidden) {
        socket.emit('dm:read', { friendId: otherId });
      } else if (friend) {
        friend.unreadCount = (friend.unreadCount || 0) + 1;
      }

      if (!notifiedDmIds.has(msg.id)) {
        notifiedDmIds.add(msg.id);
        triggerAppNotification({
          title: msg.sender?.displayName || friend?.displayName || 'Друг',
          body: previewText,
          user: msg.sender || friend,
          data: { friendId: otherId, tag: 'dm-msg-' + msg.id },
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
      updateVoiceSettingsUi();
      socket.emit('voice:toggle', { active: true, muted: false });
      showToast('🎙️ Вы подключились к голосовому чату');
    } catch {
      showToast('Нет доступа к микрофону');
    }
  }

  function stopVoiceChat() {
    state.voiceActive = false;
    updateVoiceSettingsUi();
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

  // ================= ROOM QUEUE, SKIP INTRO, AUTO-NEXT, AMBIENT GLOW, PIP, SLEEP TIMER, BUFFERING WAIT & VOICE SPEAKERS =================
  function renderRoomQueue(queue = []) {
    const countEl = $('roomQueueCount');
    const listEl = $('roomQueueList');
    if (countEl) countEl.textContent = queue.length;
    if (!listEl) return;
    if (!queue.length) {
      listEl.innerHTML = '<div class="queue-empty-state">Очередь пуста — добавьте фильмы из каталога</div>';
      return;
    }
    listEl.innerHTML = '';
    queue.forEach(item => {
      const m = item.movie || {};
      const votes = Array.isArray(item.votes) ? item.votes : [];
      const hasVoted = state.user && votes.includes(state.user.id);
      const row = document.createElement('div');
      row.className = 'queue-item-row';
      row.innerHTML = `
        <img class="queue-item-poster" src="${esc(m.poster || m.backdrop || '')}" alt="" />
        <div class="queue-item-info">
          <div class="queue-item-title">${esc(m.title || 'Фильм')}</div>
          <div class="queue-item-meta">${esc(m.year || '')}${item.addedBy?.displayName ? ` · от ${esc(item.addedBy.displayName)}` : ''}</div>
        </div>
        <div class="queue-item-actions">
          <button type="button" class="queue-vote-btn ${hasVoted ? 'voted' : ''}" title="Голосовать">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            <span>${votes.length}</span>
          </button>
          <button type="button" class="pill-btn tiny accent queue-play-btn" title="Включить сейчас">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px;"><polygon points="6 4 20 12 6 20 6 4"/></svg>
          </button>
          <button type="button" class="pill-btn tiny queue-del-btn" title="Удалить">✕</button>
        </div>
      `;
      row.querySelector('.queue-vote-btn').onclick = () => {
        socket.emit('room:queue_vote', { itemId: item.id });
      };
      row.querySelector('.queue-play-btn').onclick = async () => {
        socket.emit('room:queue_remove', { itemId: item.id });
        await loadZ01ForMovieInRoom(m, true);
      };
      row.querySelector('.queue-del-btn').onclick = () => {
        socket.emit('room:queue_remove', { itemId: item.id });
      };
      listEl.appendChild(row);
    });
  }

  $('addQueueFromCatalogBtn')?.addEventListener('click', () => {
    switchView('explore');
    showToast('Выберите фильм в каталоге и нажмите «В очередь комнаты»');
  });

  // Skip Intro (+85s) & Auto-Next Episode / Queue Prompt
  let nextEpDismissedForVideo = '';

  function getNextPlayableCandidate() {
    const videos = state.z01?.videos || [];
    const curIdx = state.z01?.activeVideoIdx || 0;
    const isSeries = videos.length > 1 && ((state.z01?.seasons?.length > 0) || videos.some(v => v.episode > 0));
    if (isSeries && curIdx + 1 < videos.length) {
      const nextVid = videos[curIdx + 1];
      const epNum = nextVid.episode || (curIdx + 2);
      return { type: 'episode', index: curIdx + 1, label: `След. серия (${epNum})` };
    }
    const q = state.room?.queue || [];
    if (q.length > 0 && q[0].movie) {
      return { type: 'queue', item: q[0], label: `Далее: «${q[0].movie.title}»` };
    }
    return null;
  }

  async function triggerNextPlayable() {
    $('nextEpisodePrompt')?.classList.add('hidden');
    const cand = getNextPlayableCandidate();
    if (!cand) return;
    if (cand.type === 'episode') {
      selectZ01VideoItem(cand.index, true);
    } else if (cand.type === 'queue' && cand.item) {
      socket.emit('room:queue_remove', { itemId: cand.item.id });
      await loadZ01ForMovieInRoom(cand.item.movie, true);
    }
  }

  $('skipIntroBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    seekTvRelative(85);
    $('skipIntroBtn')?.classList.add('hidden');
  });

  $('nextEpPlayNowBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerNextPlayable();
  });
  $('playNextEpNowBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerNextPlayable();
  });

  $('nextEpCancelBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    nextEpDismissedForVideo = state.loadedStreamKey || 'dismissed';
    $('nextEpisodePrompt')?.classList.add('hidden');
  });
  $('cancelNextEpBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    nextEpDismissedForVideo = state.loadedStreamKey || 'dismissed';
    $('nextEpisodePrompt')?.classList.add('hidden');
  });

  mainVideo.addEventListener('timeupdate', () => {
    const cur = mainVideo.currentTime || 0;
    const dur = (mainVideo.duration && isFinite(mainVideo.duration)) ? mainVideo.duration : 0;

    // Auto-Next Episode / Queue countdown during the last 12 seconds
    const nextPrompt = $('nextEpisodePrompt');
    if (nextPrompt) {
      const rem = dur - cur;
      const cand = dur > 120 && rem > 0.5 && rem <= 12 ? getNextPlayableCandidate() : null;
      if (cand && nextEpDismissedForVideo !== (state.loadedStreamKey || 'dismissed')) {
        nextPrompt.classList.remove('hidden');
        if ($('nextEpCountdownText')) {
          $('nextEpCountdownText').textContent = `${cand.label} через ${Math.ceil(rem)}с...`;
        }
      } else {
        nextPrompt.classList.add('hidden');
      }
    }
  });

  mainVideo.addEventListener('ended', () => {
    const cand = getNextPlayableCandidate();
    if (cand && nextEpDismissedForVideo !== (state.loadedStreamKey || 'dismissed')) {
      triggerNextPlayable();
    }
  });

  // Ambient Cinema Glow
  let ambientEnabled = localStorage.getItem('oulo_ambient_glow') !== 'false';
  function updateAmbientUi() {
    const wrapper = $('playerWrapper');
    const btn = $('toggleAmbientBtn');
    if (wrapper) wrapper.classList.toggle('ambient-active', ambientEnabled);
    if (btn) btn.classList.toggle('active', ambientEnabled);
  }
  updateAmbientUi();

  $('toggleAmbientBtn')?.addEventListener('click', () => {
    ambientEnabled = !ambientEnabled;
    localStorage.setItem('oulo_ambient_glow', ambientEnabled ? 'true' : 'false');
    updateAmbientUi();
    showToast(ambientEnabled ? 'Фоновая подсветка включена' : 'Фоновая подсветка выключена');
  });

  setInterval(() => {
    if (!ambientEnabled || mainVideo.paused || mainVideo.ended || state.currentView !== 'room') return;
    const canvas = $('ambientGlowCanvas');
    if (!canvas) return;
    try {
      const ctx = canvas.getContext('2d');
      if (ctx && mainVideo.readyState >= 2) {
        ctx.drawImage(mainVideo, 0, 0, canvas.width, canvas.height);
      }
    } catch {}
  }, 260);

  // Picture-in-Picture (PiP)
  $('togglePipBtn')?.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (mainVideo.requestPictureInPicture) {
        await mainVideo.requestPictureInPicture();
      } else if (mainVideo.webkitSetPresentationMode) {
        mainVideo.webkitSetPresentationMode(mainVideo.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      } else {
        showToast('Режим «Картинка в картинке» не поддерживается браузером');
      }
    } catch {
      showToast('Запустите видео для включения «Картинки в картинке»');
    }
  });

  // Mobile Double-Tap Left/Right Edge to Seek (-10s / +10s)
  let lastPlayerTapTime = 0;
  let lastPlayerTapSide = '';
  $('playerWrapper')?.addEventListener('touchend', (e) => {
    if (e.target.closest('button, input, .tv-player-osd, .skip-intro-btn, .next-ep-prompt')) return;
    const touch = e.changedTouches?.[0];
    if (!touch) return;
    const rect = $('playerWrapper').getBoundingClientRect();
    const relX = (touch.clientX - rect.left) / Math.max(1, rect.width);
    const side = relX < 0.32 ? 'left' : (relX > 0.68 ? 'right' : '');
    if (!side) return;

    const now = Date.now();
    if (now - lastPlayerTapTime < 310 && lastPlayerTapSide === side) {
      e.preventDefault();
      const delta = side === 'left' ? -10 : 10;
      seekTvRelative(delta);
      const ind = document.createElement('div');
      ind.className = `double-tap-indicator ${side}`;
      ind.textContent = side === 'left' ? '⏪ -10 сек' : '+10 сек ⏩';
      $('playerWrapper').appendChild(ind);
      setTimeout(() => ind.remove(), 550);
      lastPlayerTapTime = 0;
    } else {
      lastPlayerTapTime = now;
      lastPlayerTapSide = side;
    }
  }, { passive: false });

  // Smart Buffering Wait Indicator
  let bufferingDebounceTimer = null;
  let isCurrentlyBuffering = false;
  const activeBufferingPeers = new Map();

  function renderBufferingBanner() {
    const banner = $('bufferingWaitBanner');
    const txt = $('bufferingWaitText');
    if (!banner || !txt) return;
    const names = Array.from(activeBufferingPeers.values());
    if (names.length === 0) {
      banner.classList.add('hidden');
    } else {
      txt.textContent = `Ждём подгрузку у ${names.join(', ')}...`;
      banner.classList.remove('hidden');
    }
  }

  mainVideo.addEventListener('waiting', () => {
    if (!state.room || mainVideo.paused) return;
    clearTimeout(bufferingDebounceTimer);
    bufferingDebounceTimer = setTimeout(() => {
      if (!mainVideo.paused && mainVideo.readyState < 3) {
        isCurrentlyBuffering = true;
        socket.emit('player:buffering', { buffering: true });
      }
    }, 1300);
  });

  const clearBufferingState = () => {
    clearTimeout(bufferingDebounceTimer);
    if (isCurrentlyBuffering) {
      isCurrentlyBuffering = false;
      if (state.room) socket.emit('player:buffering', { buffering: false });
    }
  };
  mainVideo.addEventListener('playing', clearBufferingState);
  mainVideo.addEventListener('canplay', clearBufferingState);
  mainVideo.addEventListener('pause', clearBufferingState);

  socket.on('player:buffering_state', ({ userId, user, buffering }) => {
    if (!userId || (state.user && userId === state.user.id)) return;
    if (buffering && user) {
      activeBufferingPeers.set(userId, user.displayName || 'зрителя');
    } else {
      activeBufferingPeers.delete(userId);
    }
    renderBufferingBanner();
  });

  // Fullscreen Voice Speaking Overlay
  const activeVoiceSpeakers = new Map();
  let localVoiceSpeaking = false;

  function renderVoiceSpeakersOverlay() {
    const box = $('voiceSpeakersOverlay');
    if (!box) return;
    if (activeVoiceSpeakers.size === 0) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = Array.from(activeVoiceSpeakers.values()).map(u => `
      <div class="voice-speaker-pill">
        <span class="voice-speaker-av">${avatarInnerHtml(u)}</span>
        <span>${esc(u.displayName || 'Участник')}</span>
        <span class="voice-speaker-wave"></span>
      </div>
    `).join('');
  }

  socket.on('voice:speaking', ({ userId, user, speaking }) => {
    if (!userId) return;
    if (speaking && user) {
      activeVoiceSpeakers.set(userId, user);
    } else {
      activeVoiceSpeakers.delete(userId);
    }
    renderVoiceSpeakersOverlay();
  });

  // Detect local microphone activity when voice chat is active
  let localAnalyser = null;
  let localAnalyserStream = null;
  setInterval(() => {
    if (!state.voiceActive || !state.localStream || !state.room) {
      if (localVoiceSpeaking) {
        localVoiceSpeaking = false;
        if (state.user) activeVoiceSpeakers.delete(state.user.id);
        renderVoiceSpeakersOverlay();
        socket.emit('voice:speaking', { speaking: false });
      }
      return;
    }
    try {
      if (localAnalyserStream !== state.localStream) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const src = ctx.createMediaStreamSource(state.localStream);
          localAnalyser = ctx.createAnalyser();
          localAnalyser.fftSize = 256;
          src.connect(localAnalyser);
          localAnalyserStream = state.localStream;
        }
      }
      if (localAnalyser) {
        const data = new Uint8Array(localAnalyser.frequencyBinCount);
        localAnalyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const nowSpeaking = avg > 16;
        if (nowSpeaking !== localVoiceSpeaking) {
          localVoiceSpeaking = nowSpeaking;
          if (state.user) {
            if (nowSpeaking) activeVoiceSpeakers.set(state.user.id, state.user);
            else activeVoiceSpeakers.delete(state.user.id);
            renderVoiceSpeakersOverlay();
          }
          socket.emit('voice:speaking', { speaking: nowSpeaking });
        }
      }
    } catch {}
  }, 240);

  // ================= INITIALIZATION =================
  async function boot() {
    try {
      const notice = sessionStorage.getItem('eviction_notice');
      if (notice) {
        sessionStorage.removeItem('eviction_notice');
        setTimeout(() => showToast(notice), 300);
      }
    } catch {}

    updateNotificationBellUi();
    loadCatalog(true);
    loadPublicRooms();
    await initAuth();
    updateNotificationBellUi();

    // Check URL or session for active room
    const params = new URLSearchParams(window.location.search);
    let roomCode = params.get('room');
    if (!roomCode) {
      try { roomCode = sessionStorage.getItem('active_room_code'); } catch {}
    }
    if (roomCode) {
      if (!state.user) {
        try { sessionStorage.setItem('active_room_code', roomCode); } catch {}
        openAuthModal();
        showToast('Для входа в комнату войдите или зарегистрируйтесь');
      } else {
        joinRoomByCode(roomCode);
      }
    }
  }

  boot();
})();
