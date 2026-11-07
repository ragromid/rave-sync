/**
 * HDRezka Scraper & Streaming Engine for RaveLampa
 * Supports automatic Anubis Proof-of-Work solver, Cookie persistence,
 * search, translator/voice selection, TV series season/episode mapping,
 * stream decoding (#h cipher) and subtitle extraction.
 */

const crypto = require('crypto');

const DEFAULT_MIRROR = 'https://hdrezka.me';
const FALLBACK_MIRRORS = [
  'https://hdrezka.me',
  'https://rezka.ag',
  'https://hdrezka.ag',
  'https://hdrezka.ac'
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  setFromHeader(header) {
    if (!header) return;
    const items = Array.isArray(header) ? header : [header];
    for (const item of items) {
      if (!item) continue;
      const first = item.split(';')[0];
      const eqIdx = first.indexOf('=');
      if (eqIdx !== -1) {
        const key = first.slice(0, eqIdx).trim();
        const val = first.slice(eqIdx + 1).trim();
        if (val) {
          this.cookies.set(key, val);
        } else if (!this.cookies.has(key)) {
          this.cookies.set(key, '');
        }
      }
    }
  }
  toString() {
    return Array.from(this.cookies.entries())
      .filter(([_, v]) => Boolean(v))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

// In-memory cookie jar and caches
const jar = new CookieJar();
const searchCache = new Map();
const detailsCache = new Map();
const episodesCache = new Map();
const idToUrlMap = new Map();
const visitedPages = new Set();

function getCached(map, key, ttl = 5 * 60 * 1000) {
  const item = map.get(key);
  if (item && Date.now() - item.time < ttl) return item.data;
  return null;
}

function setCached(map, key, data) {
  if (map.size > 400) {
    const first = map.keys().next().value;
    map.delete(first);
  }
  map.set(key, { time: Date.now(), data });
  return data;
}

/**
 * Solves Anubis Proof-of-Work challenge in Node.js
 */
async function solveAnubis(domain, html) {
  const match = html.match(/<script id="anubis_challenge"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return false;

  let challengeData;
  try {
    challengeData = JSON.parse(match[1].trim());
  } catch {
    return false;
  }

  const { challenge, rules } = challengeData;
  if (!challenge || !rules) return false;
  const { randomData, id } = challenge;
  const difficulty = rules.difficulty || 2;

  const p = Math.floor(difficulty / 2);
  const u = difficulty % 2 !== 0;

  let nonce = 0;
  let hashStr = '';
  const t0 = Date.now();
  while (true) {
    const input = randomData + nonce;
    const buf = crypto.createHash('sha256').update(input).digest();
    let ok = true;
    for (let s = 0; s < p; s++) {
      if (buf[s] !== 0) { ok = false; break; }
    }
    if (ok && u && (buf[p] >> 4) !== 0) ok = false;
    if (ok) {
      hashStr = buf.toString('hex');
      break;
    }
    nonce++;
  }
  const elapsed = Date.now() - t0;

  const passUrl = `${domain}/.within.website/x/cmd/anubis/api/pass-challenge?id=${encodeURIComponent(id)}&response=${encodeURIComponent(hashStr)}&nonce=${encodeURIComponent(nonce)}&redir=%2F&elapsedTime=${elapsed}`;

  const passRes = await fetch(passUrl, {
    headers: {
      'User-Agent': UA,
      'Cookie': jar.toString(),
      'Referer': `${domain}/`
    },
    redirect: 'manual'
  });

  const setCookies = passRes.headers.getSetCookie ? passRes.headers.getSetCookie() : [passRes.headers.get('set-cookie')];
  jar.setFromHeader(setCookies);
  return true;
}

/**
 * Standard fetch with automatic Anubis resolution and cookie retention
 */
async function rezkaFetch(url, options = {}) {
  const domain = new URL(url).origin;
  const headers = {
    'User-Agent': UA,
    'Referer': `${domain}/`,
    ...(options.headers || {})
  };
  const cookieStr = jar.toString();
  if (cookieStr) headers['Cookie'] = cookieStr;

  let res = await fetch(url, { ...options, headers });
  jar.setFromHeader(res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]);

  // Check if we hit an Anubis challenge
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const text = await res.text();
    if (text.includes('anubis_challenge') || text.includes('Проверяем, что вы не бот')) {
      const solved = await solveAnubis(domain, text);
      if (solved) {
        // Re-execute request with new session cookies
        const newHeaders = {
          ...headers,
          'Cookie': jar.toString()
        };
        res = await fetch(url, { ...options, headers: newHeaders });
        jar.setFromHeader(res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]);
        return res;
      }
    }
    // Return mock response object with the text already consumed
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      text: async () => text,
      json: async () => JSON.parse(text)
    };
  }

  return res;
}

/**
 * Decodes HDRezka stream URL string (#h obfuscation)
 */
function decodeHDRezkaUrl(encoded) {
  if (!encoded || typeof encoded !== 'string') return '';
  if (!encoded.startsWith('#h')) return encoded;

  let data = encoded.slice(2);
  const trashList = [
    '@', '#', '!', '^', '$',
    'IyMjI14hISMjIUBA',
    'QEBAQEAhIyMhXl5e',
    'JCQhIUAkJEBeIUAjJCRA',
    'JCQjISFAIyFAIyM=',
    'Xl5eIUAjIyEhIyM='
  ];

  const parts = data.split('//_//');
  const cleanParts = parts.filter(p => !trashList.includes(p));
  data = cleanParts.join('');

  data = data.replace(/-/g, '+').replace(/_/g, '/');
  while (data.length % 4 !== 0) {
    data += '=';
  }

  try {
    return Buffer.from(data, 'base64').toString('utf8');
  } catch (e) {
    return encoded;
  }
}

/**
 * Parses decoded HDRezka stream string into { "1080p": "url", "720p": "url", ... }
 */
function parseStreamQualities(rawStreams) {
  const qualities = {};
  if (!rawStreams) return qualities;
  const decoded = decodeHDRezkaUrl(rawStreams);
  const parts = decoded.split(',');
  for (const part of parts) {
    const match = part.trim().match(/^\[([^\]]+)\](.*)$/);
    if (match) {
      const q = match[1].replace(/<[^>]+>/g, '').trim();
      const urls = match[2].trim().split(' or ');
      qualities[q] = urls[urls.length - 1]; // Highest reliability mirror
    } else if (part.trim().startsWith('http')) {
      qualities['auto'] = part.trim();
    }
  }
  return qualities;
}

/**
 * Parses HDRezka subtitles string
 */
function parseSubtitles(subStr) {
  const subs = [];
  if (!subStr) return subs;
  const parts = subStr.split(',');
  for (const part of parts) {
    const match = part.trim().match(/^\[([^\]]+)\](.*)$/);
    if (match) {
      subs.push({
        label: match[1].trim(),
        url: match[2].trim()
      });
    }
  }
  return subs;
}

const TMDB_MIRRORS = ['https://apitmdb.cub.red/3', 'https://api.themoviedb.org/3'];
const TMDB_KEY = '4ef0d7355d9ffb5151e987764708ce96';

async function getAlternativeTitles(query) {
  for (const base of TMDB_MIRRORS) {
    try {
      const u = `${base}/search/multi?api_key=${TMDB_KEY}&language=ru-RU&query=${encodeURIComponent(query)}&page=1`;
      const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
      const json = await res.json();
      if (Array.isArray(json.results) && json.results.length > 0) {
        const top = json.results[0];
        const titles = [
          top.title || top.name,
          top.original_title || top.original_name
        ].filter(Boolean);
        return [...new Set(titles)];
      }
    } catch {}
  }
  return [];
}

function parseSearchPageHtml(html) {
  const results = [];
  const itemRegex = /<div class="b-content__inline_item"[^>]*data-id="(\d+)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let m;
  while ((m = itemRegex.exec(html)) !== null) {
    const id = m[1];
    const body = m[2];

    const linkMatch = body.match(/<div class="b-content__inline_item-link">\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
    if (!linkMatch) continue;

    const url = linkMatch[1];
    const title = linkMatch[2].trim();

    const posterMatch = body.match(/<img[^>]*src="([^"]+)"/i);
    const poster = posterMatch ? posterMatch[1] : '';

    let year = null;
    let origTitle = '';
    const miscMatch = body.match(/<div class="misc">([^<]+)<\/div>/i) || body.match(/<div>([^<]+)<\/div>/i);
    if (miscMatch) {
      const extra = miscMatch[1].trim();
      const yrMatch = extra.match(/\b(19\d{2}|20\d{2})\b/);
      if (yrMatch) year = parseInt(yrMatch[1], 10);
      const parts = extra.split(',').map(s => s.trim());
      if (parts.length > 0 && !/^\d{4}/.test(parts[0])) {
        origTitle = parts[0];
      }
    }

    const ratingMatch = body.match(/<span class="rating">[\s\S]*?<i>([^<]+)<\/i>/i);
    const rating = ratingMatch ? ratingMatch[1].trim() : null;

    let type = 'movie';
    if (url.includes('/series/')) type = 'series';
    else if (url.includes('/cartoons/')) type = 'cartoon';
    else if (url.includes('/animation/')) type = 'anime';

    results.push({ id, title, origTitle, year, type, rating, poster, url });
  }
  return results;
}

function parseAjaxSearchHtml(html) {
  const items = [];
  const regex = /<li[^>]*>\s*<a href="([^"]+)">\s*<span class="enty">([^<]+)<\/span>\s*([^<]*?)(?:<span class="rating">[\s\S]*?<i>([^<]+)<\/i>)?\s*<\/a>\s*<\/li>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const itemUrl = m[1];
    const title = m[2].trim();
    const extra = m[3].replace(/[()]/g, '').trim();
    const rating = m[4] ? m[4].trim() : null;

    const idMatch = itemUrl.match(/\/(\d+)-[^/]+\.html/);
    const id = idMatch ? idMatch[1] : null;

    let year = null;
    let origTitle = '';
    let type = itemUrl.includes('/series/') ? 'series' : (itemUrl.includes('/cartoons/') ? 'cartoon' : (itemUrl.includes('/animation/') ? 'anime' : 'movie'));

    if (extra) {
      const parts = extra.split(',').map(s => s.trim());
      const yrMatch = extra.match(/\b(19\d{2}|20\d{2})\b/);
      if (yrMatch) year = parseInt(yrMatch[1], 10);
      if (parts.length > 0 && !/^\d{4}/.test(parts[0])) {
        origTitle = parts[0];
      }
    }

    if (id) {
      items.push({
        id,
        title,
        origTitle,
        year,
        type,
        rating,
        poster: '',
        url: itemUrl
      });
    }
  }
  return items;
}

async function searchOnce(q, domain = DEFAULT_MIRROR) {
  const items = [];
  const seenIds = new Set();

  // 1. Full search page (rich results, full catalog)
  try {
    const pageUrl = `${domain}/search/?do=search&subaction=search&q=${encodeURIComponent(q)}`;
    const pageRes = await rezkaFetch(pageUrl);
    const pageHtml = await pageRes.text();
    const pageItems = parseSearchPageHtml(pageHtml);
    for (const item of pageItems) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        idToUrlMap.set(String(item.id), item.url);
        items.push(item);
      }
    }
  } catch {}

  // 2. Ajax quick search
  try {
    const ajaxUrl = `${domain}/engine/ajax/search.php?q=${encodeURIComponent(q)}`;
    const ajaxRes = await rezkaFetch(ajaxUrl, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const ajaxHtml = await ajaxRes.text();
    const ajaxItems = parseAjaxSearchHtml(ajaxHtml);
    for (const item of ajaxItems) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        idToUrlMap.set(String(item.id), item.url);
        items.push(item);
      }
    }
  } catch {}

  return items;
}

/**
 * Search movies & series on HDRezka (hybrid full search + ajax + TMDB language fallback)
 */
async function search(query, domain = DEFAULT_MIRROR) {
  const q = String(query || '').trim();
  if (!q) return [];

  const cacheKey = `${domain}:search:${q.toLowerCase()}`;
  const cached = getCached(searchCache, cacheKey);
  if (cached) return cached;

  let items = await searchOnce(q, domain);

  // If very few or no results, try TMDB language bridging (Russian <-> English title)
  if (items.length < 2) {
    const altTitles = await getAlternativeTitles(q);
    for (const alt of altTitles) {
      if (alt.toLowerCase() === q.toLowerCase()) continue;
      const altItems = await searchOnce(alt, domain);
      for (const it of altItems) {
        if (!items.some(x => x.id === it.id)) {
          items.push(it);
        }
      }
      if (items.length >= 4) break;
    }
  }

  setCached(searchCache, cacheKey, items);
  return items;
}

/**
 * Get full details for a movie or TV series on HDRezka
 */
async function getDetails(idOrUrl, domain = DEFAULT_MIRROR) {
  let targetUrl = idOrUrl;
  if (!/^https?:\/\//i.test(targetUrl)) {
    if (idToUrlMap.has(String(idOrUrl))) {
      targetUrl = idToUrlMap.get(String(idOrUrl));
    } else {
      targetUrl = `${domain}/films/fiction/${idOrUrl}.html`; // fallback format
    }
  }

  const cacheKey = `details:${targetUrl}`;
  const cached = getCached(detailsCache, cacheKey);
  if (cached) return cached;

  const res = await rezkaFetch(targetUrl);
  const html = await res.text();

  // Extract ID
  const idMatch = targetUrl.match(/\/(\d+)-/) || html.match(/sof\.tv\.initCDN(?:Movies|Series)Events\((\d+)/);
  const id = idMatch ? idMatch[1] : null;
  if (!id) throw new Error('Не удалось определить ID медиа на HDRezka');

  idToUrlMap.set(String(id), targetUrl);
  visitedPages.add(targetUrl);

  // Title & Poster
  const titleMatch = html.match(/<h1[^>]*itemprop="name"[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/смотреть онлайн.*/i, '').trim() : '';

  const origTitleMatch = html.match(/<div class="b-post__origtitle"[^>]*>([^<]+)<\/div>/i);
  const origTitle = origTitleMatch ? origTitleMatch[1].trim() : '';

  const posterMatch = html.match(/<div class="b-sidecover"[^>]*>\s*<a[^>]*href="([^"]+)"/i) || html.match(/itemprop="image"\s+src="([^"]+)"/i);
  const poster = posterMatch ? posterMatch[1] : '';

  // Check if it's a series or movie
  const isSeries = Boolean(html.match(/sof\.tv\.initCDNSeriesEvents\(/i) || html.match(/id="simple-episodes-tabs"/i));

  // Extract Translators / Voice Studios
  const translators = [];
  const translRegex = /<li[^>]*data-translator_id="(\d+)"[^>]*title="([^"]+)"[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/li>/gi;
  let trm;
  while ((trm = translRegex.exec(html)) !== null) {
    const trId = trm[1];
    const trTitle = trm[2].trim();
    const trClass = trm[3] || '';
    const isDefault = trClass.includes('active');
    translators.push({
      id: trId,
      name: trTitle,
      isDefault
    });
  }

  // If no multiple translators list, check default single translator from init
  if (!translators.length) {
    const singleMatch = html.match(/sof\.tv\.initCDN(?:Movies|Series)Events\(\d+,\s*(\d+)/);
    if (singleMatch) {
      translators.push({
        id: singleMatch[1],
        name: 'Оригинал / Дубляж',
        isDefault: true
      });
    }
  }

  // Default translator
  const defaultTranslator = translators.find(t => t.isDefault) || translators[0] || { id: '0', name: 'Стандартная' };

  let seasons = [];
  let episodes = [];

  if (isSeries) {
    const epData = await getEpisodes(id, defaultTranslator.id, targetUrl, domain);
    seasons = epData.seasons || [];
    episodes = epData.episodes || [];
  }

  const details = {
    id,
    title,
    origTitle,
    poster,
    isSeries,
    url: targetUrl,
    translators,
    defaultTranslatorId: defaultTranslator.id,
    seasons,
    episodes
  };

  setCached(detailsCache, cacheKey, details);
  return details;
}

/**
 * Get seasons and episodes list for TV series for a given translator
 */
async function getEpisodes(id, translatorId, refererUrl = `${DEFAULT_MIRROR}/`, domain = DEFAULT_MIRROR) {
  const cacheKey = `episodes:${id}:${translatorId}`;
  const cached = getCached(episodesCache, cacheKey);
  if (cached) return cached;

  const url = `${domain}/ajax/get_cdn_series/?t=${Date.now()}`;
  const res = await rezkaFetch(url, {
    method: 'POST',
    headers: {
      'Referer': refererUrl,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: `id=${encodeURIComponent(id)}&translator_id=${encodeURIComponent(translatorId)}&action=get_episodes`
  });

  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    return { seasons: [], episodes: [] };
  }

  const seasonsList = [...(data.seasons || '').matchAll(/data-tab_id="(\d+)"[^>]*>([^<]+)/g)].map(m => ({
    id: m[1],
    name: m[2].trim()
  }));

  const episodesList = [...(data.episodes || '').matchAll(/data-season_id="(\d+)"\s+data-episode_id="(\d+)"[^>]*>([^<]+)/g)].map(m => ({
    season: m[1],
    episode: m[2],
    name: m[3].trim()
  }));

  const result = { seasons: seasonsList, episodes: episodesList };
  setCached(episodesCache, cacheKey, result);
  return result;
}

/**
 * Resolves direct playable stream links for a movie or specific episode of TV series
 */
async function getStream({ id, translatorId, season = null, episode = null, isMovie = false, refererUrl = null, domain = DEFAULT_MIRROR }) {
  if (!id) throw new Error('Missing ID for stream resolution');
  const tId = translatorId || '0';
  let ref = refererUrl || idToUrlMap.get(String(id));

  if (!ref || !ref.includes('://')) {
    try {
      const d = await getDetails(id, domain);
      if (d && d.url) ref = d.url;
    } catch {
      ref = `${domain}/films/fiction/${id}.html`;
    }
  }

  // Ensure page has been visited in current session so HDRezka sets proper session cookies
  if (ref && /^https?:\/\//i.test(ref) && !visitedPages.has(ref)) {
    try {
      await rezkaFetch(ref);
      visitedPages.add(ref);
    } catch {}
  }

  let body = '';
  if (isMovie || (!season && !episode)) {
    body = `id=${encodeURIComponent(id)}&translator_id=${encodeURIComponent(tId)}&action=get_movie`;
  } else {
    body = `id=${encodeURIComponent(id)}&translator_id=${encodeURIComponent(tId)}&season=${encodeURIComponent(season || 1)}&episode=${encodeURIComponent(episode || 1)}&action=get_stream`;
  }

  const url = `${domain}/ajax/get_cdn_series/?t=${Date.now()}`;
  let res = await rezkaFetch(url, {
    method: 'POST',
    headers: {
      'Referer': ref,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body
  });

  let json = await res.json().catch(() => ({}));
  if (!json.success && json.message && json.message.includes('сессии')) {
    // If session expired, refresh target page and retry once
    try {
      await rezkaFetch(ref);
      visitedPages.add(ref);
      res = await rezkaFetch(url, {
        method: 'POST',
        headers: {
          'Referer': ref,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body
      });
      json = await res.json().catch(() => ({}));
    } catch {}
  }

  if (!json.success) {
    throw new Error(json.message || 'Не удалось получить видеопоток от HDRezka');
  }

  const rawUrl = json.url || '';
  const qualities = parseStreamQualities(rawUrl);
  const subtitles = parseSubtitles(json.subtitle || '');

  // Strictly omit 1080p Ultra as requested by user (only 1080p or lower)
  delete qualities['1080p Ultra'];

  // Recommended URL: prefer 1080p -> 720p -> 480p -> 360p
  const order = ['1080p', '720p', '480p', '360p', 'auto'];
  let primaryUrl = '';
  let primaryQuality = 'HD';
  for (const q of order) {
    if (qualities[q]) {
      primaryUrl = qualities[q];
      primaryQuality = q;
      break;
    }
  }
  if (!primaryUrl) {
    primaryUrl = Object.values(qualities)[0] || '';
    primaryQuality = Object.keys(qualities)[0] || 'HD';
  }

  return {
    success: true,
    primaryUrl,
    primaryQuality,
    qualities,
    subtitles,
    qualityLabel: json.quality || primaryQuality,
    headers: {
      'Referer': `${domain}/`,
      'User-Agent': UA
    }
  };
}

module.exports = {
  search,
  getDetails,
  getEpisodes,
  getStream,
  decodeHDRezkaUrl,
  parseStreamQualities,
  DEFAULT_MIRROR
};
