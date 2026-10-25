(() => {
  'use strict';

  // ================= APPLICATION STATE =================
  const state = {
    token: localStorage.getItem('ravelampa_token') || '',
    user: null,
    bookmarks: [],
    history: [],
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
    lastSyncAt: 0,

    // WebRTC Voice Chat
    voiceActive: false,
    localStream: null,
    peers: new Map() // socketId -> RTCPeerConnection
  };

  const socket = io();

  // ================= HELPERS & API =================
  const $ = (id) => document.getElementById(id);

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const res = await fetch(path, { ...options, headers });
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

  function updateHeaderUser() {
    if (state.user) {
      $('headerUserAvatar').textContent = state.user.avatar || '🦊';
      $('headerUserAvatar').style.background = state.user.color || '#7c5cff';
      $('headerUserName').textContent = state.user.displayName;
    } else {
      $('headerUserAvatar').textContent = '👤';
      $('headerUserAvatar').style.background = '#7c5cff';
      $('headerUserName').textContent = 'Войти';
    }
  }

  async function initAuth() {
    if (!state.token) {
      updateHeaderUser();
      return;
    }
    try {
      const data = await api('/api/auth/me');
      state.user = data.user;
      state.bookmarks = data.bookmarks || [];
      state.history = data.history || [];
      updateHeaderUser();
      socket.emit('auth:identify', { token: state.token });
      loadFriends();
    } catch {
      state.token = '';
      localStorage.removeItem('ravelampa_token');
      updateHeaderUser();
    }
  }

  function openAuthModal() {
    const modal = $('authModal');
    modal.classList.remove('hidden');
    if (state.user) {
      $('authGuestView').classList.add('hidden');
      $('authProfileView').classList.remove('hidden');
      $('profileBigAvatar').textContent = state.user.avatar;
      $('profileBigAvatar').style.background = state.user.color || '#7c5cff';
      $('profileUsernameTag').textContent = `@${state.user.username}`;
      $('profileDisplayName').value = state.user.displayName;
      document.querySelectorAll('#profileAvatarPicker .av-pick').forEach(b => {
        b.classList.toggle('selected', b.dataset.av === state.user.avatar);
      });
    } else {
      $('authGuestView').classList.remove('hidden');
      $('authProfileView').classList.add('hidden');
    }
  }

  $('userMenuBtn').addEventListener('click', openAuthModal);

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
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('ravelampa_token', data.token);
      updateHeaderUser();
      socket.emit('auth:identify', { token: state.token });
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
    const avatar = document.querySelector('#profileAvatarPicker .av-pick.selected')?.dataset.av || state.user.avatar;
    try {
      const data = await api('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ displayName, avatar })
      });
      state.user = data.user;
      updateHeaderUser();
      $('authModal').classList.add('hidden');
      showToast('Профиль обновлён');
    } catch (err) {
      showToast(err.message);
    }
  });

  $('logoutBtn').addEventListener('click', () => {
    if (state.room) leaveRoom();
    state.token = '';
    state.user = null;
    state.bookmarks = [];
    state.history = [];
    localStorage.removeItem('ravelampa_token');
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
  $('globalSearchInput').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    $('clearSearchBtn').classList.toggle('hidden', !val);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = val;
      if (state.currentView !== 'explore') switchView('explore');
      loadCatalog(true);
    }, 380);
  });

  $('clearSearchBtn').addEventListener('click', () => {
    $('globalSearchInput').value = '';
    $('clearSearchBtn').classList.add('hidden');
    state.searchQuery = '';
    loadCatalog(true);
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
    const avatarsHtml = (r.participants || []).slice(0, 5).map(p => `<span title="${esc(p.displayName)}">${esc(p.avatar || '🦊')}</span>`).join('');
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
    socket.emit('room:join', { code: clean, token: state.token });
  }

  function leaveRoom() {
    stopVoiceChat();
    destroyPlayers();
    socket.emit('room:leave');
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

      // If room already has a selected balancer, prefer it
      const preferredKey = state.room?.media?.balancerKey;
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

      // Save to user watch history
      if (state.user && state.z01.movie) {
        api('/api/history', {
          method: 'POST',
          body: JSON.stringify({
            movie: state.z01.movie,
            balancer: newMedia.balancerName,
            season: newMedia.season,
            episode: newMedia.episode,
            voiceName: newMedia.voiceName
          })
        }).then(r => { if (r.history) state.history = r.history; }).catch(() => {});
      }

      if (broadcastToRoom && state.room) {
        socket.emit('room:set_media', { media: newMedia });
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
    if (!media || (!media.streamUrl && !media.youtubeId)) {
      setPlayerOverlay(true, false, 'Выберите фильм из каталога или источник Z01 ниже');
      return;
    }

    setPlayerOverlay(false, false, '');
    const video = $('mainVideo');
    video.controls = true;

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

    const onLoaded = () => {
      state.suppressSyncEmit = true;
      if (playback.currentTime && Math.abs(video.currentTime - playback.currentTime) > 1.5) {
        video.currentTime = playback.currentTime;
      }
      if (playback.playing) {
        video.play().catch(() => {
          // Autoplay with sound blocked by browser until user interaction; try muted or show prompt
          showToast('Нажмите Play на плеере для включения звука');
        });
      }
      setTimeout(() => { state.suppressSyncEmit = false; }, 450);
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
          // Automatic fallback to backend stream proxy if direct stream had a CORS/network error!
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

  // Bind HTML5 Video Events for Real-Time Room Synchronization
  const mainVideo = $('mainVideo');

  function emitPlayerSync(action) {
    if (!state.room || state.suppressSyncEmit) return;
    if (!state.room.media || state.room.media.streamType === 'youtube') return;
    const now = Date.now();
    if (action === 'timeupdate' && now - state.lastSyncAt < 4000) return;
    state.lastSyncAt = now;

    socket.emit('player:sync', {
      action,
      playing: !mainVideo.paused,
      currentTime: mainVideo.currentTime || 0,
      rate: mainVideo.playbackRate || 1
    });
  }

  mainVideo.addEventListener('play', () => emitPlayerSync('play'));
  mainVideo.addEventListener('pause', () => emitPlayerSync('pause'));
  mainVideo.addEventListener('seeked', () => emitPlayerSync('seek'));
  mainVideo.addEventListener('ratechange', () => emitPlayerSync('rate'));

  $('resyncPlayerBtn').addEventListener('click', () => {
    socket.emit('player:request_sync');
    showToast('Синхронизировано с комнатой');
  });

  function applyRemoteSync(data) {
    if (!state.room || !state.room.media || state.room.media.streamType === 'youtube') return;
    if (!mainVideo.src && !state.hls) return;

    state.suppressSyncEmit = true;
    const targetTime = data.currentTime || 0;
    const drift = Math.abs((mainVideo.currentTime || 0) - targetTime);

    if (drift > 1.8 || data.action === 'seek' || data.action === 'resync') {
      mainVideo.currentTime = targetTime;
      showSyncBadge(data.actor ? `${data.actor.avatar} ${data.actor.displayName} перемотал(а)` : 'Синхронизация...');
    }

    if (data.rate && mainVideo.playbackRate !== data.rate) {
      mainVideo.playbackRate = data.rate;
    }

    if (data.playing && mainVideo.paused) {
      mainVideo.play().catch(() => {});
      if (data.actor) showSyncBadge(`${data.actor.avatar} ${data.actor.displayName} нажал(а) Play`);
    } else if (!data.playing && !mainVideo.paused) {
      mainVideo.pause();
      if (data.actor) showSyncBadge(`${data.actor.avatar} ${data.actor.displayName} поставил(а) на паузу`);
    }

    setTimeout(() => { state.suppressSyncEmit = false; }, 400);
  }

  let syncBadgeTimer = null;
  function showSyncBadge(text) {
    const el = $('syncIndicator');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(syncBadgeTimer);
    syncBadgeTimer = setTimeout(() => el.classList.add('hidden'), 2000);
  }

  // ================= SOCKET.IO ROOM EVENTS =================
  socket.on('rooms:public_list', (list) => {
    renderPublicRooms(list || []);
  });

  socket.on('room:error', ({ error }) => {
    showToast(error || 'Ошибка комнаты');
  });

  socket.on('room:joined', async (room) => {
    state.room = room;
    switchView('room');

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
          // Stream is already resolved in the room! Play it immediately and load Z01 panel in background
          loadMediaIntoPlayer(room.media, room.playback);
          loadZ01ForMovieInRoom(room.media.movie, false);
        } else {
          // Newly created room: resolve first working Z01 balancer & stream automatically
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
  });

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
    applyRemoteSync(data);
  });

  socket.on('chat:message', (msg) => {
    appendChatMessage(msg);
  });

  socket.on('room:reaction', ({ emoji }) => {
    spawnFloatingEmoji(emoji);
  });

  socket.on('room:invite_received', ({ from, room }) => {
    showToast(
      `${from.avatar} ${from.displayName} зовёт смотреть «${room.mediaTitle}»!`,
      'Войти в комнату',
      () => joinRoomByCode(room.code),
      9000
    );
  });

  socket.on('friends:update', () => {
    if (state.user) loadFriends();
  });

  socket.on('toast', ({ text }) => {
    if (text) showToast(text);
  });

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
    showToast(nextPublic ? 'Комната теперь публичная' : 'Комната теперь приватная (только по коду/ссылке)');
  });

  function renderRoomParticipants(list) {
    $('roomUserCount').textContent = list.length;
    const container = $('roomParticipantsList');
    container.innerHTML = '';
    list.forEach(p => {
      const isHost = state.room && p.id === state.room.hostId;
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `
        <div class="user-row-left">
          <div class="avatar-circle" style="background:${esc(p.color || '#7c5cff')}">${esc(p.avatar || '🦊')}</div>
          <div>
            <div class="user-row-name">${esc(p.displayName)} ${isHost ? '👑' : ''}</div>
            <div class="user-row-sub">@${esc(p.username)} ${p.inVoice ? '· 🎙️ В голосе' : ''}</div>
          </div>
        </div>
      `;
      container.appendChild(row);
    });
  }

  function renderRoomMessages(messages) {
    const box = $('chatMessages');
    box.innerHTML = '';
    messages.forEach(m => appendChatMessage(m));
  }

  function appendChatMessage(msg) {
    const box = $('chatMessages');
    const el = document.createElement('div');
    if (msg.system) {
      el.className = 'chat-msg system';
      el.textContent = msg.text;
    } else {
      el.className = 'chat-msg';
      el.innerHTML = `
        <div class="chat-av" style="background:${esc(msg.user?.color || '#7c5cff')}">${esc(msg.user?.avatar || '🦊')}</div>
        <div class="chat-bubble">
          <div class="chat-author" style="color:${esc(msg.user?.color || '#9175ff')}">${esc(msg.user?.displayName || 'Гость')}</div>
          <div class="chat-text">${esc(msg.text)}</div>
        </div>
      `;
    }
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat:send', { text });
    input.value = '';
  });

  // Sidebar tabs (Chat / Participants)
  document.querySelectorAll('.side-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.side-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.rtab-content').forEach(c => c.classList.remove('active'));
      $(`rtab-${tab.dataset.rtab}`).classList.add('active');
    });
  });

  // Floating Reactions
  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('room:reaction', { emoji: btn.dataset.emoji });
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

  // ================= FRIENDS & INVITES =================
  async function loadFriends() {
    if (!state.user) {
      $('friendsList').innerHTML = '<div style="color:var(--text-muted);padding:20px 0;">Войдите в аккаунт, чтобы добавлять друзей и приглашать их в комнаты.</div>';
      return;
    }
    try {
      const data = await api('/api/friends');
      state.friends = data.friends || [];
      state.incomingRequests = data.incoming || [];
      state.outgoingRequests = data.outgoing || [];

      const reqBadge = $('friendsReqBadge');
      if (state.incomingRequests.length > 0) {
        reqBadge.textContent = state.incomingRequests.length;
        reqBadge.classList.remove('hidden');
      } else {
        reqBadge.classList.add('hidden');
      }

      renderFriendsView();
    } catch {}
  }

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
          <div class="user-row-left">
            <div class="avatar-circle" style="background:${esc(req.user.color)}">${esc(req.user.avatar)}</div>
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
      row.className = 'user-row';
      const roomStatus = f.currentRoom
        ? `🍿 Смотрит: ${f.currentRoom.mediaTitle}`
        : (f.online ? 'В сети' : 'Не в сети');

      row.innerHTML = `
        <div class="user-row-left">
          <span class="status-dot ${f.online ? 'online' : ''}"></span>
          <div class="avatar-circle" style="background:${esc(f.color)}">${esc(f.avatar)}</div>
          <div>
            <div class="user-row-name">${esc(f.displayName)}</div>
            <div class="user-row-sub">${esc(roomStatus)}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          ${f.currentRoom ? `<button class="pill-btn tiny accent" data-join-friend="${esc(f.currentRoom.code)}">Присоединиться</button>` : ''}
          ${state.room && f.online ? `<button class="pill-btn tiny" data-invite-friend="${esc(f.id)}">Позвать</button>` : ''}
        </div>
      `;
      const joinBtn = row.querySelector('[data-join-friend]');
      if (joinBtn) joinBtn.onclick = () => joinRoomByCode(f.currentRoom.code);
      const invBtn = row.querySelector('[data-invite-friend]');
      if (invBtn) invBtn.onclick = () => socket.emit('room:invite', { friendId: f.id });
      fList.appendChild(row);
    });
  }

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
          <div class="user-row-left">
            <div class="avatar-circle" style="background:${esc(u.color)}">${esc(u.avatar)}</div>
            <div>
              <div class="user-row-name">${esc(u.displayName)}</div>
              <div class="user-row-sub">@${esc(u.username)}</div>
            </div>
          </div>
          <button class="pill-btn tiny accent">+ Добавить</button>
        `;
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
          <div class="avatar-circle" style="background:${esc(f.color)}">${esc(f.avatar)}</div>
          <div class="user-row-name">${esc(f.displayName)}</div>
        </div>
        <button class="pill-btn tiny accent">Пригласить</button>
      `;
      row.querySelector('button').onclick = () => {
        socket.emit('room:invite', { friendId: f.id });
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
    await initAuth();
    loadCatalog(true);
    loadPublicRooms();

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
