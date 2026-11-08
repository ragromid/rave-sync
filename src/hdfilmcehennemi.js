/**
 * HDFilmCehennemi Turkish Movie & TV Series Scraper / Stream Resolver
 * Designed for RaveLampa / LostShare balancer ecosystem
 * 
 * Handles:
 *  - Content search by title or IMDb ID
 *  - Movie & TV Series season/episode navigation
 *  - Player iframe extraction (CloseLoad / Rapidrame)
 *  - Obfuscated video stream decoding (P.A.C.K.E.R. + ROT13 + Base64 + character unmix)
 *  - Multi-track Turkish dubbing (Dublaj), Subtitles (Altyazı), and Original audio
 *  - Direct or proxy routing (via HDFC_PROXY / TURKISH_PROXY env var)
 */

const http = require('http');
const https = require('https');
const tls = require('tls');
const { URL } = require('url');

const BASE_URL = 'https://www.hdfilmcehennemi.nl';
const EMBED_BASE = 'https://hdfilmcehennemi.mobi';
const FALLBACK_MIRRORS = [
  'https://www.hdfilmcehennemi.nl',
  'https://www.hdfilmcehennemi.ws',
  'https://www.hdfilmcehennemi.de'
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

// Caches
const searchCache = new Map();
const detailsCache = new Map();

function getCached(map, key, ttl = 5 * 60 * 1000) {
  const item = map.get(key);
  if (item && Date.now() - item.time < ttl) return item.data;
  return null;
}

function setCached(map, key, data) {
  if (map.size > 300) {
    const first = map.keys().next().value;
    map.delete(first);
  }
  map.set(key, { time: Date.now(), data });
  return data;
}

/**
 * Fetch URL through an HTTP CONNECT proxy (for HTTPS)
 */
function fetchViaProxy(targetUrl, proxyUrl, headers = {}, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    try {
      const pUrl = new URL(proxyUrl);
      const tUrl = new URL(targetUrl);
      const targetPort = tUrl.port || (tUrl.protocol === 'https:' ? 443 : 80);

      const connectReq = http.request({
        host: pUrl.hostname,
        port: parseInt(pUrl.port, 10) || 8080,
        method: 'CONNECT',
        path: `${tUrl.hostname}:${targetPort}`,
        headers: {
          'Host': `${tUrl.hostname}:${targetPort}`,
          ...(pUrl.username ? {
            'Proxy-Authorization': 'Basic ' + Buffer.from(`${pUrl.username}:${pUrl.password}`).toString('base64')
          } : {})
        },
        timeout: timeoutMs
      });

      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          return reject(new Error(`Proxy CONNECT failed with HTTP ${res.statusCode}`));
        }

        const tlsSocket = tls.connect({
          host: tUrl.hostname,
          servername: tUrl.hostname,
          socket
        }, () => {
          let reqData = `GET ${tUrl.pathname}${tUrl.search} HTTP/1.1\r\n`;
          reqData += `Host: ${tUrl.hostname}\r\n`;
          for (const [k, v] of Object.entries(headers)) {
            reqData += `${k}: ${v}\r\n`;
          }
          reqData += `Connection: close\r\n\r\n`;
          tlsSocket.write(reqData);
        });

        let rawResponse = '';
        tlsSocket.on('data', chunk => {
          rawResponse += chunk.toString('utf8');
        });

        tlsSocket.on('end', () => {
          const headerEnd = rawResponse.indexOf('\r\n\r\n');
          if (headerEnd === -1) {
            return reject(new Error('Malformed HTTP response through proxy'));
          }
          const headerLines = rawResponse.slice(0, headerEnd).split('\r\n');
          const statusMatch = headerLines[0].match(/HTTP\/\d\.\d\s+(\d+)/);
          const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 200;
          const body = rawResponse.slice(headerEnd + 4);
          resolve({ status: statusCode, body, raw: rawResponse });
        });

        tlsSocket.on('error', err => reject(err));
      });

      connectReq.on('timeout', () => {
        connectReq.destroy();
        reject(new Error(`Proxy request timeout after ${timeoutMs}ms`));
      });

      connectReq.on('error', err => reject(err));
      connectReq.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Robust fetch with Cloudflare Turnstile & Proxy handling
 */
async function fetchPage(url, extraHeaders = {}, timeoutMs = 12000) {
  const proxyUrl = process.env.HDFC_PROXY || process.env.TURKISH_PROXY || '';
  const headers = { ...DEFAULT_HEADERS, ...extraHeaders };

  if (proxyUrl) {
    try {
      const res = await fetchViaProxy(url, proxyUrl, headers, timeoutMs);
      if (res.status === 403 && (res.body.includes('challenge-platform') || res.body.includes('Just a moment'))) {
        throw new Error('Cloudflare Turnstile challenge blocked the proxy request');
      }
      return { status: res.status, text: res.body };
    } catch (e) {
      // Fallback to direct if proxy fails
      console.warn(`[HDFilmCehennemi] Proxy request failed (${e.message}), trying direct connection...`);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers,
      signal: controller.signal
    });
    const text = await res.text();
    clearTimeout(timer);

    if (res.status === 403 || text.includes('challenge-platform') || text.includes('Just a moment')) {
      throw new Error('HDFilmCehennemi заблокирован Cloudflare Turnstile (HTTP 403). Прямой доступ из дата-центров вне Турции ограничен. Требуется турецкий прокси (HDFC_PROXY).');
    }

    return { status: res.status, text };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * P.A.C.K.E.R. JavaScript decoder
 */
function unpackJS(p, a, c, k) {
  const words = k.split('|');
  function decode(word) {
    let n = 0;
    for (const char of word) {
      if (/\d/.test(char)) n = n * a + parseInt(char, 10);
      else if (/[a-z]/.test(char)) n = n * a + char.charCodeAt(0) - 'a'.charCodeAt(0) + 10;
      else if (/[A-Z]/.test(char)) n = n * a + char.charCodeAt(0) - 'A'.charCodeAt(0) + 36;
    }
    return n < words.length && words[n] ? words[n] : word;
  }
  return p.replace(/\b\w+\b/g, decode);
}

/**
 * ROT13 cipher decoder
 */
function rot13(str) {
  return str.replace(/[a-zA-Z]/g, c =>
    String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26)
  );
}

/**
 * Character unmix algorithm with magic seed
 */
function characterUnmix(value) {
  let unmix = '';
  for (let i = 0; i < value.length; i++) {
    let charCode = value.charCodeAt(i);
    charCode = (charCode - (399756995 % (i + 5)) + 256) % 256;
    unmix += String.fromCharCode(charCode);
  }
  return unmix;
}

function isValidVideoUrl(url) {
  return url &&
    typeof url === 'string' &&
    url.startsWith('https://') &&
    (url.includes('.m3u8') || url.includes('/hls/') || url.includes('.mp4'));
}

/**
 * Decodes the obfuscated video stream URL
 */
function decodeVideoUrl(parts) {
  const value = parts.join('');
  const reversed = value.split('').reverse().join('');

  // Variant 3: base64 -> reverse -> ROT13 -> unmix (Most recent)
  try {
    let res = Buffer.from(value, 'base64').toString('latin1');
    res = res.split('').reverse().join('');
    res = rot13(res);
    res = characterUnmix(res);
    if (isValidVideoUrl(res)) return res;
  } catch {}

  // Variant 1: ROT13 -> base64 -> unmix
  try {
    let res = rot13(reversed);
    res = Buffer.from(res, 'base64').toString('latin1');
    res = characterUnmix(res);
    if (isValidVideoUrl(res)) return res;
  } catch {}

  // Variant 2: base64 -> ROT13 -> unmix
  try {
    let res = Buffer.from(reversed, 'base64').toString('latin1');
    res = rot13(res);
    res = characterUnmix(res);
    if (isValidVideoUrl(res)) return res;
  } catch {}

  return null;
}

/**
 * Search HDFilmCehennemi by title or IMDb ID
 */
async function search(query, targetYear = null) {
  if (!query) return [];
  const cacheKey = `search:${query.toLowerCase().trim()}:${targetYear || ''}`;
  const cached = getCached(searchCache, cacheKey);
  if (cached) return cached;

  const searchUrl = `${BASE_URL}/search/?q=${encodeURIComponent(query)}`;
  const { text } = await fetchPage(searchUrl, {
    'X-Requested-With': 'fetch',
    'Accept': 'application/json'
  });

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Некорректный ответ поиска от HDFilmCehennemi');
  }

  const results = [];
  if (data && Array.isArray(data.results)) {
    for (const html of data.results) {
      const linkMatch = html.match(/href=["'](https?:\/\/[^"']*hdfilmcehennemi[^"']*)["']/i);
      const titleMatch = html.match(/<h4[^>]*class=["'][^"']*title[^"']*["'][^>]*>(.*?)<\/h4>/i) ||
                         html.match(/alt=["']([^"']+)["']/i);
      const yearMatch = html.match(/class=["'][^"']*year[^"']*["'][^>]*>(\d{4})</i);
      const typeMatch = html.match(/class=["'][^"']*type[^"']*["'][^>]*>([^<]+)</i);

      if (linkMatch) {
        const itemUrl = linkMatch[1];
        const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
        const itemYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
        const rawType = typeMatch ? typeMatch[1].trim().toLowerCase() : '';
        const isSeries = rawType === 'dizi' || itemUrl.includes('/dizi/') || itemUrl.includes('-sezon-');

        results.push({
          url: itemUrl,
          title: rawTitle || query,
          year: itemYear,
          isSeries,
          slug: itemUrl.replace(BASE_URL, '').replace(/^\/|\/$/g, '')
        });
      }
    }
  }

  // Filter or prioritize by year if specified
  if (targetYear && results.length > 1) {
    results.sort((a, b) => {
      const aDiff = a.year ? Math.abs(a.year - targetYear) : 99;
      const bDiff = b.year ? Math.abs(b.year - targetYear) : 99;
      return aDiff - bDiff;
    });
  }

  return setCached(searchCache, cacheKey, results);
}

/**
 * Scrape player iframe and decode video/subtitle stream data
 */
async function scrapeIframe(iframeSrc, parentUrl = BASE_URL) {
  const { text: html } = await fetchPage(iframeSrc, {
    'Referer': parentUrl
  });

  const result = {
    videoUrl: null,
    subtitles: [],
    audioTracks: []
  };

  // 1. Extract subtitles from <track> tags
  const trackRegex = /<track\b([^>]+)>/gi;
  let trackMatch;
  while ((trackMatch = trackRegex.exec(html)) !== null) {
    const trackAttrs = trackMatch[1];
    const srcMatch = trackAttrs.match(/src=["']([^"']+)["']/i);
    const langMatch = trackAttrs.match(/srclang=["']([^"']+)["']/i);
    const labelMatch = trackAttrs.match(/label=["']([^"']+)["']/i);

    if (srcMatch) {
      let subUrl = srcMatch[1];
      if (!subUrl.startsWith('http')) {
        subUrl = `${EMBED_BASE}${subUrl.startsWith('/') ? '' : '/'}${subUrl}`;
      }
      result.subtitles.push({
        lang: langMatch ? langMatch[1] : 'tr',
        label: labelMatch ? labelMatch[1] : 'Türkçe',
        url: subUrl
      });
    }
  }

  // 2. Decode packed JavaScript
  const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.+)',(\d+),(\d+),'([^']+)'/s);
  if (packedMatch) {
    const unpacked = unpackJS(
      packedMatch[1],
      parseInt(packedMatch[2], 10),
      parseInt(packedMatch[3], 10),
      packedMatch[4]
    );

    const partsMatch = unpacked.match(/dc_\w+\(\[([^\]]+)\]\)/);
    if (partsMatch) {
      const parts = partsMatch[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ''));
      result.videoUrl = decodeVideoUrl(parts);
    }
  }

  // 3. Fallback to JSON-LD schema
  if (!result.videoUrl) {
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const jsonLd = JSON.parse(jsonLdMatch[1]);
        if (jsonLd.contentUrl && isValidVideoUrl(jsonLd.contentUrl)) {
          result.videoUrl = jsonLd.contentUrl;
        }
      } catch {}
    }
  }

  // Identify embed origin for Referer header
  let embedOrigin = EMBED_BASE;
  try {
    const parsed = new URL(iframeSrc);
    embedOrigin = parsed.origin;
  } catch {}
  result.embedOrigin = embedOrigin;

  return result;
}

/**
 * Get detailed information, available seasons/episodes, and stream
 */
async function getDetails(pageUrl) {
  const cached = getCached(detailsCache, pageUrl);
  if (cached) return cached;

  const { text: html } = await fetchPage(pageUrl);

  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/–.*$|-.*$/g, '').trim() : 'Фильм';

  // Find player iframe
  const iframeMatch = html.match(/<iframe\b[^>]*\b(?:src|data-src)=["']([^"']+)["'][^>]*>/i);
  const iframeSrc = iframeMatch ? iframeMatch[1] : null;

  // Extract alternative sources / dubs
  const altSources = [];
  const altRegex = /<a\b[^>]*class=["'][^"']*alternative-link[^"']*["'][^>]*data-video=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let altMatch;
  while ((altMatch = altRegex.exec(html)) !== null) {
    altSources.push({
      videoId: altMatch[1],
      name: altMatch[2].replace(/<[^>]+>/g, '').trim()
    });
  }

  // Check if series by looking for episodes
  const episodes = [];
  const epRegex = /href=["'](https?:\/\/[^"']*-sezon-(\d+)-bolum[^"']*)["']/gi;
  let epMatch;
  while ((epMatch = epRegex.exec(html)) !== null) {
    const epUrl = epMatch[1];
    const sMatch = epUrl.match(/(\d+)-sezon-(\d+)-bolum/i);
    if (sMatch) {
      episodes.push({
        url: epUrl,
        season: parseInt(sMatch[1], 10),
        episode: parseInt(sMatch[2], 10)
      });
    }
  }

  const isSeries = episodes.length > 0;
  const seasonsMap = new Map();

  if (isSeries) {
    for (const ep of episodes) {
      if (!seasonsMap.has(ep.season)) {
        seasonsMap.set(ep.season, []);
      }
      seasonsMap.get(ep.season).push(ep);
    }
  }

  // Format seasons list
  const seasons = Array.from(seasonsMap.entries()).map(([seasonNum, eps]) => {
    eps.sort((a, b) => a.episode - b.episode);
    return {
      season: seasonNum,
      title: `${seasonNum}. Sezon (${eps.length} Bölüm)`,
      episodes: eps.map(e => ({
        season: e.season,
        episode: e.episode,
        title: `${e.episode}. Bölüm`,
        url: e.url
      }))
    };
  });
  seasons.sort((a, b) => a.season - b.season);

  // Translators / Voice options in Turkish
  const translators = [
    { id: 'tr_dub', title: 'Türkçe Dublaj (Дубляж)' },
    { id: 'tr_sub', title: 'Türkçe Altyazılı (Субтитры)' },
    { id: 'orig', title: 'Orijinal (Оригинал)' }
  ];

  let streamData = null;
  if (iframeSrc) {
    try {
      streamData = await scrapeIframe(iframeSrc, pageUrl);
    } catch (e) {
      console.warn(`[HDFilmCehennemi] Primary iframe failed: ${e.message}`);
    }
  }

  const result = {
    url: pageUrl,
    title,
    isSeries,
    iframeSrc,
    seasons,
    translators,
    altSources,
    stream: streamData
  };

  return setCached(detailsCache, pageUrl, result);
}

/**
 * Resolve video stream URL with proxy headers
 */
async function getStream({ pageUrl, season = null, episode = null, voice = 'tr_dub' }) {
  let targetUrl = pageUrl;

  // If specific episode requested for series
  if (season != null && episode != null) {
    const details = await getDetails(pageUrl);
    const targetSeason = details.seasons.find(s => s.season === parseInt(season, 10));
    const targetEp = targetSeason?.episodes.find(e => e.episode === parseInt(episode, 10));
    if (targetEp?.url) {
      targetUrl = targetEp.url;
    }
  }

  const details = await getDetails(targetUrl);
  if (!details.stream || !details.stream.videoUrl) {
    throw new Error('Видеопоток HDFilmCehennemi не найден на странице или заблокирован');
  }

  const embedOrigin = details.stream.embedOrigin || EMBED_BASE;
  const directUrl = details.stream.videoUrl;

  return {
    streamUrl: `/api/stream-proxy?url=${encodeURIComponent(directUrl)}&ref=${encodeURIComponent(embedOrigin + '/')}`,
    directUrl,
    streamType: 'hls',
    headers: {
      'Referer': `${embedOrigin}/`,
      'User-Agent': UA
    },
    subtitles: details.stream.subtitles || []
  };
}

module.exports = {
  search,
  getDetails,
  getStream,
  scrapeIframe,
  unpackJS,
  decodeVideoUrl
};
