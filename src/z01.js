const crypto = require('crypto');

const TMDB_KEY = '4ef0d7355d9ffb5151e987764708ce96';
const TMDB_MIRRORS = [
  'https://apitmdb.cub.red/3',
  'https://api.themoviedb.org/3'
];
const IMG_BASE = 'https://imagetmdb.com/t/p';

const Z01_MAIN = 'https://z01.online';
const Z01_SERVERS = [
  'https://z01.online',
  'http://s2.z01.online',
  'http://s3.z01.online',
  'http://z01.online'
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Simple in-memory caches
const catalogCache = new Map();
const z01Cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(map, key, ttl = CACHE_TTL) {
  const entry = map.get(key);
  if (entry && Date.now() - entry.time < ttl) return entry.data;
  return null;
}

function setCached(map, key, data) {
  if (map.size > 500) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
  map.set(key, { time: Date.now(), data });
  return data;
}

// Quality & Voice classification ported from https://z01.online/online.js
function shortQuality(text) {
  if (!text) return '';
  const s = String(text);
  const match = s.match(/(2160|1440|1080|720|576|480|360)\s*p?/i);
  if (match) {
    const val = parseInt(match[1], 10);
    if (val >= 2160) return '4K';
    if (val >= 1080) return 'FHD';
    if (val >= 720) return 'HD';
    return 'SD';
  }
  if (/4k|uhd/i.test(s)) return '4K';
  if (/fhd/i.test(s)) return 'FHD';
  if (/\bhd\b/i.test(s)) return 'HD';
  return '';
}

function splitSourceName(name) {
  let n = String(name || '');
  let badge = '';
  const match = n.match(/\s*[-~–]\s*(2160p?|1440p?|1080p?|720p?|480p?|4k|uhd|fhd|hd)\b[^,]*$/i);
  if (match) {
    badge = shortQuality(match[1]);
    if (badge) n = n.slice(0, match.index);
  }
  return { name: n.trim(), badge };
}

const VOICE_KINDS = [
  { key: 'dub', title: 'Дубляж', re: /дубляж|дублирован|\bdub\b|\bdubbing\b/i },
  { key: 'mvo', title: 'Многоголосый', re: /многоголос|\bmvo\b|\bpmvo\b|lostfilm|лостфильм|tvshows|dniprofilm|невафильм|newstudio|baibako|байбако|alexfilm|jaskier|coldfilm|hdrezka|rezkastudio|red head sound|sunshine|amedia|zakadry|закадры|linefilm|1win|kerob|profix|октопус/i },
  { key: 'dvo', title: 'Двухголосый', re: /двухголос|\bdvo\b|кубик в кубе|kubik|viruseproject|вирус|green ?tea|paradox/i },
  { key: 'avo', title: 'Авторский', re: /авторск|одноголос|\bavo\b|\bvo\b|яроцк|гаврилов|володарск|сербин|горчаков|михал[её]в|живов|пучков|гоблин|кураж|карповск/i },
  { key: 'orig', title: 'Оригинал', re: /оригинал|original|\beng\b|\bua\b|\bukr\b/i },
  { key: 'sub', title: 'Субтитры', re: /субтитр|sub(title)?s?\b/i }
];

function classifyVoice(title) {
  const s = String(title || '');
  for (const vk of VOICE_KINDS) {
    if (vk.re.test(s)) return { key: vk.key, groupTitle: vk.title };
  }
  return { key: 'other', groupTitle: 'Озвучка' };
}

function cleanVoiceLabel(title) {
  const s = String(title == null ? '' : title);
  const out = s
    .replace(/\s*,\s*(?:4k|uhd|2160p?)(?=\s*(?:[\],)]|$))/gi, '')
    .replace(/(\[|\()\s*(?:4k|uhd|2160p?)\s*,\s*/gi, '$1')
    .replace(/\s*[\[(]\s*(?:4k|uhd|2160p?)\s*[\])]/gi, '')
    .replace(/\s+(?:4k|uhd)\s*$/i, '')
    .trim()
    .replace(/\[/g, '(')
    .replace(/\]/g, ')');
  return out || s;
}

function isSeasonLabel(text) {
  const t = String(text || '').trim();
  return /^\d+\s*(-?[йя])?\s*(сезон|season)$/i.test(t) || /^(сезон|season)\s*\d+$/i.test(t);
}

function normName(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/g, ' ')
    .trim();
}

function nameParts(text) {
  return String(text || '')
    .split(/\s*[\/|]\s*/)
    .map(normName)
    .filter(Boolean);
}

function yearOf(val) {
  const m = String(val == null ? '' : val).match(/\d{4}/);
  const y = m ? parseInt(m[0], 10) : 0;
  return y > 1900 && y < 2200 ? y : 0;
}

function matchScore(elem, movie) {
  if (!elem || !movie) return 0;
  const mine = [];
  for (const f of ['title', 'name', 'original_title', 'original_name']) {
    for (const p of nameParts(movie[f])) {
      if (!mine.includes(p)) mine.push(p);
    }
  }
  const theirs = nameParts(elem.title || elem.text || '');
  let score = 0;
  for (const a of theirs) {
    for (const b of mine) {
      let hit = 0;
      if (a === b) hit = 60;
      else if (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a))) hit = 34;
      else if (a.length > 5 && b.length > 5 && (a.includes(b) || b.includes(a))) hit = 22;
      if (hit > score) score = hit;
    }
  }
  const myYear = yearOf(movie.release_date || movie.first_air_date || movie.year);
  const theirYear = yearOf(elem.year || elem.start_date);
  if (myYear && theirYear) {
    const diff = Math.abs(myYear - theirYear);
    if (diff === 0) score += 34;
    else if (diff === 1) score += 16;
    else score -= 30;
  }
  return score;
}

function rankSimilars(list, movie) {
  const ranked = (list || []).map((elem, index) => ({
    elem,
    index,
    score: matchScore(elem, movie)
  }));
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0] || null;
  const second = ranked[1] || null;
  const gap = best ? best.score - (second ? second.score : -100) : 0;
  return {
    list: ranked.map(r => ({ ...r.elem, matchScore: r.score })),
    best: best ? best.elem : null,
    likely: !!(best && best.score >= 45 && gap >= 10),
    sure: !!(best && best.score >= 70 && gap >= 25)
  };
}

// Normalize a TMDB card for our frontend + Z01 engine
function normalizeCard(item, forceType) {
  if (!item) return null;
  const isTv = forceType === 'tv' || item.media_type === 'tv' || (!!item.name && !item.title);
  const title = item.title || item.name || item.original_title || item.original_name || 'Без названия';
  const original_title = item.original_title || item.original_name || title;
  const release_date = item.release_date || item.first_air_date || '';
  const year = release_date ? release_date.slice(0, 4) : (item.year ? String(item.year) : '');
  const poster = item.poster_path
    ? (item.poster_path.startsWith('http') ? item.poster_path : `${IMG_BASE}/w500${item.poster_path}`)
    : '';
  const backdrop = item.backdrop_path
    ? (item.backdrop_path.startsWith('http') ? item.backdrop_path : `${IMG_BASE}/w1280${item.backdrop_path}`)
    : poster;

  return {
    id: item.id,
    tmdb_id: item.id,
    imdb_id: item.imdb_id || (item.external_ids && item.external_ids.imdb_id) || '',
    kinopoisk_id: item.kinopoisk_id || '',
    type: isTv ? 'tv' : 'movie',
    serial: isTv ? 1 : 0,
    title,
    name: isTv ? title : undefined,
    original_title,
    original_name: isTv ? original_title : undefined,
    original_language: item.original_language || 'en',
    overview: item.overview || '',
    release_date,
    first_air_date: isTv ? release_date : undefined,
    year,
    vote_average: item.vote_average ? Number(Number(item.vote_average).toFixed(1)) : 0,
    poster,
    backdrop,
    poster_path: item.poster_path || '',
    backdrop_path: item.backdrop_path || '',
    number_of_seasons: item.number_of_seasons || (isTv ? 1 : 0),
    runtime: item.runtime || (Array.isArray(item.episode_run_time) && item.episode_run_time[0]) || 0,
    genres: Array.isArray(item.genres) ? item.genres.map(g => g.name) : []
  };
}

async function fetchTmdb(endpoint, queryParams = {}) {
  const qs = new URLSearchParams({
    api_key: TMDB_KEY,
    language: 'ru-RU',
    ...queryParams
  }).toString();

  const cacheKey = `${endpoint}?${qs}`;
  const cached = getCached(catalogCache, cacheKey, 10 * 60 * 1000);
  if (cached) return cached;

  let lastErr;
  for (const base of TMDB_MIRRORS) {
    try {
      const res = await fetch(`${base}/${endpoint}?${qs}`, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(7000)
      });
      if (res.ok) {
        const json = await res.json();
        return setCached(catalogCache, cacheKey, json);
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Failed to fetch TMDB');
}

async function getCatalogFeed(category = 'trending', page = 1) {
  const p = String(page || 1);
  let data;
  let forceType = null;

  switch (category) {
    case 'popular_movies':
      data = await fetchTmdb('movie/popular', { page: p });
      forceType = 'movie';
      break;
    case 'popular_tv':
      data = await fetchTmdb('tv/popular', { page: p });
      forceType = 'tv';
      break;
    case 'top_movies':
      data = await fetchTmdb('movie/top_rated', { page: p });
      forceType = 'movie';
      break;
    case 'top_tv':
      data = await fetchTmdb('tv/top_rated', { page: p });
      forceType = 'tv';
      break;
    case 'anime':
      data = await fetchTmdb('discover/tv', {
        page: p,
        with_genres: '16',
        with_original_language: 'ja',
        sort_by: 'popularity.desc'
      });
      forceType = 'tv';
      break;
    case 'cartoons':
      data = await fetchTmdb('discover/movie', {
        page: p,
        with_genres: '16',
        sort_by: 'popularity.desc'
      });
      forceType = 'movie';
      break;
    case 'trending':
    default:
      data = await fetchTmdb('trending/all/week', { page: p });
      break;
  }

  const results = (data.results || [])
    .filter(x => x.media_type !== 'person' && (x.poster_path || x.backdrop_path))
    .map(x => normalizeCard(x, forceType));

  return {
    page: data.page || 1,
    total_pages: data.total_pages || 1,
    results
  };
}

async function searchCatalog(query, page = 1) {
  if (!query || !String(query).trim()) return { page: 1, total_pages: 1, results: [] };
  const data = await fetchTmdb('search/multi', {
    query: String(query).trim(),
    page: String(page || 1),
    include_adult: 'false'
  });
  const results = (data.results || [])
    .filter(x => (x.media_type === 'movie' || x.media_type === 'tv') && (x.poster_path || x.backdrop_path || x.title || x.name))
    .map(x => normalizeCard(x));
  return {
    page: data.page || 1,
    total_pages: data.total_pages || 1,
    results
  };
}

async function resolveExternalIds(movie) {
  const id = movie.tmdb_id || movie.id;
  const serial = movie.serial || (movie.type === 'tv' ? 1 : 0);
  const cacheKey = `ext_${serial}_${id}`;
  const cached = getCached(z01Cache, cacheKey, 60 * 60 * 1000);
  if (cached) return cached;

  let imdb_id = movie.imdb_id || '';
  let kinopoisk_id = movie.kinopoisk_id || '';

  // 1. Try TMDB external_ids if imdb_id is missing
  if (!imdb_id && id) {
    try {
      const tmdbExt = await fetchTmdb(`${serial ? 'tv' : 'movie'}/${id}/external_ids`);
      if (tmdbExt && tmdbExt.imdb_id) imdb_id = tmdbExt.imdb_id;
    } catch {}
  }

  // 2. Query Z01 externalids servers (s2.z01.online and z01.online)
  const uid = 'rave' + crypto.randomBytes(3).toString('hex');
  for (const srv of ['http://s2.z01.online', 'https://z01.online', 'http://s3.z01.online']) {
    if (imdb_id && kinopoisk_id && kinopoisk_id !== '0') break;
    try {
      const q = new URLSearchParams({
        id: String(id || ''),
        serial: String(serial ? 1 : 0),
        uid
      });
      if (imdb_id) q.set('imdb_id', imdb_id);
      if (kinopoisk_id) q.set('kinopoisk_id', kinopoisk_id);
      const r = await fetch(`${srv}/externalids?${q.toString()}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(3500)
      });
      if (r.ok) {
        const j = await r.json();
        if (j.imdb_id && !imdb_id) imdb_id = j.imdb_id;
        if (j.kinopoisk_id && String(j.kinopoisk_id) !== '0' && !kinopoisk_id) {
          kinopoisk_id = String(j.kinopoisk_id);
        }
      }
    } catch {}
  }

  return setCached(z01Cache, cacheKey, { imdb_id, kinopoisk_id });
}

async function getCatalogDetails(id, type = 'movie') {
  const isTv = type === 'tv' || type === '1' || type === 'serial';
  const endpoint = isTv ? `tv/${id}` : `movie/${id}`;
  const raw = await fetchTmdb(endpoint, { append_to_response: 'external_ids' });
  const card = normalizeCard(raw, isTv ? 'tv' : 'movie');
  const ext = await resolveExternalIds(card);
  if (ext.imdb_id) card.imdb_id = ext.imdb_id;
  if (ext.kinopoisk_id) card.kinopoisk_id = ext.kinopoisk_id;
  return card;
}

function buildZ01Params(movie, uid) {
  const isSerial = movie.serial === 1 || movie.type === 'tv' || !!movie.name;
  const title = movie.title || movie.name || '';
  const original_title = movie.original_title || movie.original_name || title;
  const year = String(movie.year || movie.release_date || movie.first_air_date || '0000').slice(0, 4);

  const q = new URLSearchParams();
  q.set('id', String(movie.tmdb_id || movie.id || ''));
  if (movie.imdb_id) q.set('imdb_id', String(movie.imdb_id));
  if (movie.kinopoisk_id && String(movie.kinopoisk_id) !== '0') {
    q.set('kinopoisk_id', String(movie.kinopoisk_id));
  }
  q.set('tmdb_id', String(movie.tmdb_id || movie.id || ''));
  q.set('title', title);
  q.set('original_title', original_title);
  q.set('serial', isSerial ? '1' : '0');
  q.set('original_language', movie.original_language || 'en');
  q.set('year', year);
  q.set('source', 'tmdb');
  q.set('clarification', movie.clarification ? '1' : '0');
  q.set('similar', movie.similar ? 'true' : 'false');
  q.set('rchtype', 'web');
  q.set('uid', uid);
  return q;
}

function appendAccountParams(rawUrl, uid) {
  let u = String(rawUrl || '');
  if (!u) return u;
  if (u.startsWith('/')) u = `${Z01_MAIN}${u}`;
  if (!u.includes('uid=')) {
    u += (u.includes('?') ? '&' : '?') + `uid=${encodeURIComponent(uid)}`;
  }
  return u;
}

// Step 1: Discover active Z01 balancers for a movie/series
async function getZ01Sources(movie) {
  const ext = await resolveExternalIds(movie);
  const enrichedMovie = {
    ...movie,
    imdb_id: movie.imdb_id || ext.imdb_id || '',
    kinopoisk_id: movie.kinopoisk_id || ext.kinopoisk_id || ''
  };

  const cacheKey = `sources_${enrichedMovie.serial || 0}_${enrichedMovie.id}_${enrichedMovie.clarification || 0}_${enrichedMovie.title}`;
  const cached = getCached(z01Cache, cacheKey, 4 * 60 * 1000);
  if (cached) return cached;

  const uid = 'rave' + crypto.randomBytes(4).toString('hex');
  const params = buildZ01Params(enrichedMovie, uid);

  const eventsUrl = `${Z01_MAIN}/lite/events?life=true&${params.toString()}`;
  const evRes = await fetch(eventsUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(12000)
  });
  const evJson = await evRes.json();

  let onlineList = [];

  if (evJson && evJson.life && evJson.memkey) {
    const memkey = evJson.memkey;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(r => setTimeout(r, attempt === 0 ? 900 : 1000));
      try {
        const lifeUrl = `${Z01_MAIN}/lifeevents?memkey=${encodeURIComponent(memkey)}&${params.toString()}`;
        const lifeRes = await fetch(lifeUrl, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(5000)
        });
        const lifeJson = await lifeRes.json();
        if (Array.isArray(lifeJson.online)) {
          onlineList = lifeJson.online;
        }
        const shownCount = onlineList.filter(x => x.show).length;
        if (lifeJson.ready || (shownCount >= 4 && attempt >= 1) || (shownCount >= 1 && attempt >= 3)) {
          break;
        }
      } catch {}
    }
  } else if (Array.isArray(evJson)) {
    onlineList = evJson;
  } else if (evJson && Array.isArray(evJson.online)) {
    onlineList = evJson.online;
  }

  const isSerial = enrichedMovie.serial === 1 || enrichedMovie.type === 'tv' || !!enrichedMovie.name;
  const sources = [];
  const seenKeys = new Set();

  for (const item of onlineList) {
    const key = String(item.balanser || (item.name || '').split(' ')[0] || '').toLowerCase();
    if (!key || seenKeys.has(key)) continue;
    // Skip movie-only ultra sources on series (same as Z01UI.isMovieOnlySource)
    if (isSerial && (key === 'xvideocdnultra' || key === 'xvideocdn60fps')) continue;
    seenKeys.add(key);

    const parts = splitSourceName(item.name || key);
    sources.push({
      key,
      name: parts.name || item.name || key,
      fullName: item.name || key,
      badge: parts.badge || '',
      url: item.url,
      show: item.show !== undefined ? !!item.show : true
    });
  }

  // Sort: shown first, then higher quality badge
  const qRank = { '4K': 4, 'FHD': 3, 'HD': 2, 'SD': 1, '': 0 };
  sources.sort((a, b) => {
    if (a.show !== b.show) return a.show ? -1 : 1;
    return (qRank[b.badge] || 0) - (qRank[a.badge] || 0);
  });

  const result = {
    movie: enrichedMovie,
    uid,
    sources
  };
  return setCached(z01Cache, cacheKey, result);
}

// Parse HTML returned by Lampac/Z01 balancers (exact port of parseJsonDate from online.js)
function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseZ01HtmlElements(htmlStr, classToken, movie) {
  const results = [];
  if (!htmlStr || typeof htmlStr !== 'string') return results;

  // Match <div ... class="...classToken..." ...> ... </div>
  // Note: videos__button has no nested divs; videos__item may have inner divs for title
  const tagRegex = new RegExp(`<div\\b([^>]*\\bclass=["'][^"']*\\b${classToken}\\b[^"']*["'][^>]*)>([\\s\\S]*?)<\\/div>(?:\\s*<\\/div>)*`, 'gi');
  let match;

  // Wait: because videos__item can contain nested <div>s (like <div class="videos__item-title">1 сезон</div>),
  // let's scan opening <div ...> tags that have `classToken` and `data-json`, and extract text up to the next `videos__item` or `videos__button`!
  const openTagRegex = new RegExp(`<div\\b([^>]*\\bclass=["'][^"']*\\b${classToken}\\b[^"']*["'][^>]*)>`, 'gi');
  const matches = [];
  while ((match = openTagRegex.exec(htmlStr)) !== null) {
    matches.push({
      attrStr: match[1],
      startIndex: match.index,
      contentStart: match.index + match[0].length
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].startIndex : htmlStr.length;
    const rawSlice = htmlStr.slice(cur.contentStart, nextStart);

    // Extract data-json='...' or data-json="..."
    const djSingle = cur.attrStr.match(/\bdata-json='([^']*)'/i);
    const djDouble = !djSingle && cur.attrStr.match(/\bdata-json="([^"]*)"/i);
    const rawJson = djSingle ? djSingle[1] : (djDouble ? djDouble[1] : '');
    if (!rawJson) continue;

    let data;
    try {
      data = JSON.parse(decodeHtmlEntities(rawJson));
    } catch {
      continue;
    }

    const sMatch = cur.attrStr.match(/\bs=["']?(\d+)["']?/i);
    const eMatch = cur.attrStr.match(/\be=["']?(\d+)["']?/i);
    const classMatch = cur.attrStr.match(/\bclass=["']([^"']*)["']/i);
    const classStr = classMatch ? classMatch[1] : '';
    const isActive = /\bactive\b/.test(classStr);

    // Extract inner text before closing or next element
    // Stop at first </div></div> or strip tags
    let innerHtml = rawSlice.split(/<div\b[^>]*\bclass=["'][^"']*\bvideos__/i)[0];
    let text = decodeHtmlEntities(innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

    const isSerial = movie && (movie.serial === 1 || movie.type === 'tv' || !!movie.name);
    if (!isSerial && movie) {
      if (/\d+p/i.test(text)) {
        if (!data.quality && data.url) {
          data.quality = { [text]: data.url };
        }
        text = movie.title || movie.name || text;
      }
      if (text === 'По умолчанию') {
        text = movie.title || movie.name || text;
      }
    }

    if (eMatch) data.episode = parseInt(eMatch[1], 10);
    if (sMatch) data.season = parseInt(sMatch[1], 10);
    if (text) data.text = text;
    data.active = isActive;

    results.push(data);
  }

  return results;
}

// Step 2: Query a specific balancer URL (handles seasons, voices, similars, and episodes)
async function queryZ01Balancer({ url, movie, uid, depth = 0, prevSeasons = [], prevVoices = [] }) {
  if (!url || depth > 4) {
    return { videos: [], seasons: prevSeasons, voices: prevVoices, similars: [] };
  }

  const reqUid = uid || ('rave' + crypto.randomBytes(4).toString('hex'));
  let fullUrl = url;

  // If this is a base balancer URL (e.g. https://z01.online/lite/veoveo), attach movie search params
  if (!fullUrl.includes('id=') && !fullUrl.includes('postid=') && !fullUrl.includes('movieid=') && !fullUrl.includes('kinopoisk_id=') && movie) {
    const ext = await resolveExternalIds(movie);
    const enriched = { ...movie, imdb_id: movie.imdb_id || ext.imdb_id, kinopoisk_id: movie.kinopoisk_id || ext.kinopoisk_id };
    const params = buildZ01Params(enriched, reqUid);
    fullUrl = `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${params.toString()}`;
  } else {
    fullUrl = appendAccountParams(fullUrl, reqUid);
  }

  const res = await fetch(fullUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000)
  });
  const str = await res.text();

  // Check if response is JSON (e.g., error or RCH)
  try {
    const maybeJson = JSON.parse(str);
    if (maybeJson && (maybeJson.rch || maybeJson.accsdb || maybeJson.error)) {
      return {
        error: maybeJson.msg || (maybeJson.rch ? 'Источник требует прямое клиентское подключение (попробуйте другой источник)' : 'Источник недоступен'),
        rch: !!maybeJson.rch,
        videos: [],
        seasons: prevSeasons,
        voices: prevVoices,
        similars: []
      };
    }
  } catch {}

  const items = parseZ01HtmlElements(str, 'videos__item', movie);
  let buttons = parseZ01HtmlElements(str, 'videos__button', movie);

  let seasons = prevSeasons;
  let voices = prevVoices;

  const seasonButtons = buttons.filter(b => isSeasonLabel(b.text));
  if (seasonButtons.length > 0) {
    seasons = seasonButtons.map((b, idx) => ({
      index: idx,
      title: b.text,
      url: b.url,
      active: !!b.active
    }));
    buttons = buttons.filter(b => !isSeasonLabel(b.text));
  }

  if (buttons.length > 0) {
    voices = buttons.map((b, idx) => {
      const vInfo = classifyVoice(b.text);
      return {
        index: idx,
        title: cleanVoiceLabel(b.text),
        rawTitle: b.text,
        kind: vInfo.key,
        groupTitle: vInfo.groupTitle,
        url: b.url,
        active: !!b.active
      };
    });
  }

  // Exact port of z01_online.js parse() branching:
  if (items.length === 1 && items[0].method === 'link' && !items[0].similar) {
    if (seasons.length < 2) {
      seasons = items.map((s, idx) => ({
        index: idx,
        title: s.text,
        url: s.url,
        active: true
      }));
    }
    return queryZ01Balancer({
      url: items[0].url,
      movie,
      uid: reqUid,
      depth: depth + 1,
      prevSeasons: seasons,
      prevVoices: voices
    });
  }

  const videos = items.filter(v => v.method === 'play' || v.method === 'call');
  const similar = items.filter(v => v.similar);

  if (videos.length > 0) {
    const activeVoice = voices.find(v => v.active) || voices[0];
    const formattedVideos = videos.map((v, idx) => {
      let qualities = {};
      let primaryQuality = '';
      if (v.quality && typeof v.quality === 'object') {
        qualities = v.quality;
        primaryQuality = Object.keys(v.quality)[0] || '';
      } else if (v.qualitys && typeof v.qualitys === 'object') {
        qualities = v.qualitys;
        primaryQuality = Object.keys(v.qualitys)[0] || '';
      } else if (typeof v.quality === 'string') {
        primaryQuality = v.quality;
      }

      // Clean " or " in quality URLs
      const cleanedQualities = {};
      for (const [qk, qv] of Object.entries(qualities)) {
        if (typeof qv === 'string') {
          cleanedQualities[qk] = qv.split(' or ')[0].trim();
        }
      }

      const rawUrl = typeof v.url === 'string' ? v.url.split(' or ')[0].trim() : '';
      const voiceName = v.voice_name || v.translate || (activeVoice ? activeVoice.title : '') || v.text || '';

      return {
        index: idx,
        title: v.title || v.text || (v.episode ? `${v.episode} серия` : (movie && (movie.title || movie.name)) || 'Видео'),
        text: v.text || '',
        season: v.season || 0,
        episode: v.episode || (movie && (movie.serial || movie.type === 'tv') ? idx + 1 : 0),
        voice_name: cleanVoiceLabel(voiceName),
        method: v.method,
        url: rawUrl,
        qualities: cleanedQualities,
        quality: shortQuality(primaryQuality) || shortQuality(v.translate) || shortQuality(v.title) || primaryQuality,
        headers: v.headers || null,
        subtitles: Array.isArray(v.subtitles) ? v.subtitles : []
      };
    });

    return {
      videos: formattedVideos,
      seasons,
      voices,
      similars: []
    };
  }

  if (items.length > 0) {
    if (similar.length > 0) {
      const ranked = rankSimilars(similar, movie);
      // Automatically open the best matching similar item if we haven't recursed deeply yet
      if (ranked.best && ranked.best.url && depth < 2) {
        const subResult = await queryZ01Balancer({
          url: ranked.best.url,
          movie,
          uid: reqUid,
          depth: depth + 1,
          prevSeasons: seasons,
          prevVoices: voices
        });
        subResult.similars = ranked.list;
        return subResult;
      }
      return {
        videos: [],
        seasons,
        voices,
        similars: ranked.list
      };
    } else {
      // Items are season links! Save them as seasons and follow the first season
      seasons = items.map((s, idx) => ({
        index: idx,
        title: s.text || `${idx + 1} сезон`,
        url: s.url,
        active: idx === 0
      }));
      if (seasons[0] && seasons[0].url) {
        return queryZ01Balancer({
          url: seasons[0].url,
          movie,
          uid: reqUid,
          depth: depth + 1,
          prevSeasons: seasons,
          prevVoices: voices
        });
      }
    }
  }

  return {
    videos: [],
    seasons,
    voices,
    similars: []
  };
}

// Step 3: Resolve a video item (if method === 'call', fetch its JSON to get the actual stream URL)
async function resolveZ01Stream({ url, method, headers, qualities, subtitles, uid }) {
  const reqUid = uid || ('rave' + crypto.randomBytes(4).toString('hex'));
  let finalUrl = typeof url === 'string' ? url.split(' or ')[0].trim() : '';
  let finalHeaders = headers || null;
  let finalQualities = qualities || {};
  let finalSubtitles = Array.isArray(subtitles) ? subtitles : [];

  if (method === 'call' && finalUrl) {
    const callUrl = appendAccountParams(finalUrl, reqUid);
    const res = await fetch(callUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000)
    });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json.rch) {
        throw new Error('Этот балансер требует RCH, выберите другой источник');
      }
      if (json.url) {
        finalUrl = String(json.url).split(' or ')[0].trim();
      }
      if (json.headers) finalHeaders = json.headers;
      if (json.quality && typeof json.quality === 'object') {
        finalQualities = {};
        for (const [qk, qv] of Object.entries(json.quality)) {
          if (typeof qv === 'string') {
            finalQualities[qk] = qv.split(' or ')[0].trim();
          }
        }
      }
      if (Array.isArray(json.subtitles)) finalSubtitles = json.subtitles;
    } catch (e) {
      // Sometimes a `method: call` endpoint redirects directly to an .m3u8 manifest!
      if (text.includes('#EXTM3U')) {
        finalUrl = res.url || callUrl;
      } else if (e.message && e.message.includes('RCH')) {
        throw e;
      }
    }
  }

  // Pick highest quality by default if qualities map is provided
  if (Object.keys(finalQualities).length > 0) {
    const qOrder = ['2160p', '1440p', '1080p', '1080p Ultra', '720p', '480p', '360p'];
    for (const pref of qOrder) {
      if (finalQualities[pref]) {
        finalUrl = finalQualities[pref];
        break;
      }
    }
  }

  const isHls = /\.m3u8(\?|$)/i.test(finalUrl) || finalUrl.includes('manifest.m3u8');
  return {
    url: finalUrl,
    streamType: isHls ? 'hls' : 'mp4',
    headers: finalHeaders,
    qualities: finalQualities,
    subtitles: finalSubtitles
  };
}

module.exports = {
  getCatalogFeed,
  searchCatalog,
  getCatalogDetails,
  getZ01Sources,
  queryZ01Balancer,
  resolveZ01Stream
};
