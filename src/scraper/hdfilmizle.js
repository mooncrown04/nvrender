const { load } = require('cheerio');

const BASE_URL = process.env.HDFILMIZLE_BASE_URL || 'https://www.hdfilmizle.to';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const MAX_CATALOG_ITEMS = Number(process.env.MAX_CATALOG_ITEMS || 80);

const COMMON_HEADERS = {
  'user-agent':
    process.env.HTTP_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  referer: BASE_URL,
};

function normalizeUrl(value) {
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value.replace(/^\//, '')}`;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function encodeB64Url(input) {
  return Buffer.from(String(input), 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeB64Url(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function withTimeout(promise, timeoutMs, timeoutMessage = 'İstek zaman aşımına uğradı') {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

async function fetchHtml(url) {
  const response = await withTimeout(
    fetch(url, {
      headers: COMMON_HEADERS,
      redirect: 'follow',
    }),
    REQUEST_TIMEOUT_MS,
    `İstek zaman aşımı: ${url}`
  );

  if (!response.ok) {
    throw new Error(`Kaynak alınamadı (${response.status}): ${url}`);
  }

  return response.text();
}

function textOrNull($, selector, context = null) {
  const node = context ? context.find(selector).first() : $(selector).first();
  const value = node.text().replace(/\s+/g, ' ').trim();
  return value || null;
}

function attrOrNull($, selector, attr, context = null) {
  const node = context ? context.find(selector).first() : $(selector).first();
  const value = node.attr(attr);
  return value ? value.trim() : null;
}

function parseYearFromText(text) {
  if (!text) return null;
  const match = String(text).match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function getJsonLd($) {
  const data = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text()?.trim();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) data.push(...parsed);
      else data.push(parsed);
    } catch {
      // geçersiz JSON-LD kayıtlarını yok say
    }
  });

  return data;
}

function pickImage(item, $card = null, $ = null) {
  if (Array.isArray(item?.image) && item.image[0]) return normalizeUrl(item.image[0]);
  if (item?.image) return normalizeUrl(item.image);
  if (item?.thumbnailUrl) return normalizeUrl(item.thumbnailUrl);
  if ($ && $card) {
    const src =
      attrOrNull($, 'img', 'data-src', $card) ||
      attrOrNull($, 'img', 'src', $card) ||
      attrOrNull($, 'img', 'data-lazy-src', $card);
    return normalizeUrl(src);
  }
  return null;
}

function buildMetaId(type, sourceUrl, title) {
  const encodedSource = encodeB64Url(sourceUrl);
  return `hdfilmizle:${type}:${slugify(title) || 'icerik'}:${encodedSource}`;
}

function parseMetaId(metaId) {
  const parts = String(metaId || '').split(':');
  if (parts.length < 4 || parts[0] !== 'hdfilmizle') return null;

  const type = parts[1];
  const encodedSource = parts.slice(3).join(':');

  try {
    const sourceUrl = decodeB64Url(encodedSource);
    if (!/^https?:\/\//i.test(sourceUrl)) return null;
    return { type, sourceUrl };
  } catch {
    return null;
  }
}

function detectContentType(input = '') {
  const s = String(input).toLowerCase();
  if (s.includes('/dizi') || s.includes('episode') || s.includes('season')) return 'series';
  if (s.includes('/seri') || s.includes('tvseries')) return 'series';
  if (s.includes('/film') || s.includes('/movie')) return 'movie';
  return null;
}

function catalogUrlForType(type, search = '') {
  if (search) {
    return [`${BASE_URL}/?s=${encodeURIComponent(search)}`];
  }

  if (type === 'series') {
    return [`${BASE_URL}/dizi`, `${BASE_URL}/diziler`];
  }

  return [BASE_URL, `${BASE_URL}/film`, `${BASE_URL}/filmler`];
}

async function fetchFirstWorkingHtml(urls) {
  const errors = [];
  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      if (html && html.length > 0) return html;
    } catch (error) {
      errors.push(`${url} -> ${error.message}`);
    }
  }

  throw new Error(`Uygun katalog kaynağı bulunamadı: ${errors.join(' | ')}`);
}

function extractCardsFromPage(html, fallbackType = 'movie') {
  const $ = load(html);
  const cards = [];
  const seen = new Set();

  const addCard = (entry) => {
    if (!entry?.sourceUrl) return;
    if (seen.has(entry.sourceUrl)) return;
    seen.add(entry.sourceUrl);
    cards.push(entry);
  };

  const jsonLdItems = getJsonLd($);
  jsonLdItems.forEach((item) => {
    const url = normalizeUrl(item.url);
    if (!url) return;
    const title = item.name?.trim();
    if (!title) return;
    const detectedType =
      item['@type'] === 'TVSeries' || item['@type'] === 'Episode'
        ? 'series'
        : detectContentType(url);
    const type = detectedType || fallbackType;

    addCard({
      id: buildMetaId(type, url, title),
      type,
      sourceUrl: url,
      name: title,
      poster: pickImage(item),
      background: pickImage(item),
      description: item.description || null,
      year: parseYearFromText(item.datePublished),
      releaseInfo: parseYearFromText(item.datePublished)?.toString() || null,
      imdbRating: item.aggregateRating?.ratingValue
        ? String(item.aggregateRating.ratingValue)
        : null,
      genres: Array.isArray(item.genre)
        ? item.genre.map((g) => String(g).trim()).filter(Boolean)
        : typeof item.genre === 'string'
          ? [item.genre.trim()].filter(Boolean)
          : [],
    });
  });

  const cardSelectors = [
    '.item',
    '.items .item',
    '.movies .item',
    '.result-item',
    '.search-page .result-item',
    '.movie-card',
    '.movie-item',
    '.film-item',
    '.dizi-item',
    '.post',
    '.post-item',
    '.list-item',
    'article',
  ];

  $(cardSelectors.join(',')).each((_, element) => {
    const $el = $(element);
    const href =
      attrOrNull($, 'a', 'href', $el) ||
      attrOrNull($, 'a', 'data-href', $el) ||
      attrOrNull($, '.title a', 'href', $el) ||
      attrOrNull($, '.poster a', 'href', $el);

    const sourceUrl = normalizeUrl(href);
    if (!sourceUrl) return;

    const name =
      attrOrNull($, 'a[title]', 'title', $el) ||
      textOrNull($, '.title', $el) ||
      textOrNull($, 'h2', $el) ||
      textOrNull($, 'h3', $el) ||
      textOrNull($, '.data h3', $el) ||
      textOrNull($, 'a', $el);

    if (!name) return;

    const type = detectContentType(sourceUrl) || fallbackType;
    const year =
      parseYearFromText(textOrNull($, '.year', $el)) ||
      parseYearFromText(textOrNull($, '.date', $el)) ||
      parseYearFromText($el.text());

    addCard({
      id: buildMetaId(type, sourceUrl, name),
      type,
      sourceUrl,
      name,
      poster: pickImage(null, $el, $),
      background: pickImage(null, $el, $),
      description: textOrNull($, '.excerpt', $el) || textOrNull($, '.description', $el) || null,
      year,
      releaseInfo: year ? String(year) : null,
      imdbRating: null,
      genres: [],
    });
  });

  return cards;
}

function extractVideoLinks(html) {
  const $ = load(html);
  const links = [];
  const seen = new Set();

  const pushLink = (url, title = 'Kaynak') => {
    const cleanUrl = normalizeUrl(url);
    if (!cleanUrl || seen.has(cleanUrl)) return;
    seen.add(cleanUrl);
    links.push({ title, url: cleanUrl });
  };

  $('iframe').each((_, el) => {
    pushLink($(el).attr('src'), 'Iframe');
  });

  $('video source').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const label = $(el).attr('label') || $(el).attr('res') || 'Direct Video';
    pushLink(src, label);
  });

  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href) return;

    const looksLikeVideo = /m3u8|mp4|stream|player|izle|watch|embed/i.test(href);
    if (looksLikeVideo) pushLink(href, text || 'Bağlantı');
  });

  const scriptText = $('script')
    .map((_, el) => $(el).html() || '')
    .get()
    .join('\n');

  const urlMatches = scriptText.match(/https?:\/\/[^"'\s]+(?:m3u8|mp4|embed[^"'\s]*)/gi) || [];
  urlMatches.forEach((url) => pushLink(url, 'Script Kaynağı'));

  return links;
}

function parseMetaFromDetailHtml(type, sourceUrl, html) {
  const $ = load(html);
  const jsonLd = getJsonLd($);
  const preferredLd = jsonLd.find((x) => x.name && (x.description || x.aggregateRating)) || null;

  const name =
    preferredLd?.name ||
    textOrNull($, 'h1') ||
    textOrNull($, '.title') ||
    textOrNull($, 'title') ||
    'İçerik';

  const year =
    parseYearFromText(preferredLd?.datePublished) ||
    parseYearFromText(textOrNull($, '.year')) ||
    parseYearFromText($.text()) ||
    null;

  const description =
    preferredLd?.description ||
    textOrNull($, '.summary') ||
    textOrNull($, '.description') ||
    'Açıklama bulunamadı.';

  return {
    id: buildMetaId(type, sourceUrl, name),
    type,
    sourceUrl,
    name,
    poster: pickImage(preferredLd) || normalizeUrl(attrOrNull($, 'meta[property="og:image"]', 'content')),
    background:
      pickImage(preferredLd) || normalizeUrl(attrOrNull($, 'meta[property="og:image"]', 'content')),
    description,
    releaseInfo: year ? String(year) : null,
    imdbRating: preferredLd?.aggregateRating?.ratingValue
      ? String(preferredLd.aggregateRating.ratingValue)
      : null,
    genres: Array.isArray(preferredLd?.genre)
      ? preferredLd.genre.map((g) => String(g).trim()).filter(Boolean)
      : typeof preferredLd?.genre === 'string'
        ? [preferredLd.genre.trim()].filter(Boolean)
        : [],
  };
}

function toStremioMeta(card) {
  return {
    id: card.id,
    type: card.type,
    name: card.name,
    poster: card.poster,
    background: card.background,
    description: card.description,
    releaseInfo: card.releaseInfo,
    imdbRating: card.imdbRating,
    genres: card.genres,
    behaviorHints: {
      defaultVideoId: card.sourceUrl,
      hasScheduledVideos: false,
    },
  };
}

async function getCatalog(type, search = '') {
  const html = await fetchFirstWorkingHtml(catalogUrlForType(type, search));
  const cards = extractCardsFromPage(html, type)
    .filter((item) => item.type === type)
    .filter((item) => {
      if (!search) return true;
      return item.name.toLowerCase().includes(search.toLowerCase());
    })
    .slice(0, MAX_CATALOG_ITEMS);

  return cards.map(toStremioMeta);
}

async function getMeta(type, id) {
  const parsed = parseMetaId(id);
  if (!parsed || parsed.type !== type) return null;

  const detailHtml = await fetchHtml(parsed.sourceUrl);
  const card = parseMetaFromDetailHtml(type, parsed.sourceUrl, detailHtml);
  return toStremioMeta(card);
}

async function getStreams(type, id) {
  const parsed = parseMetaId(id);
  if (!parsed || parsed.type !== type) return [];

  const detailHtml = await fetchHtml(parsed.sourceUrl);
  const links = extractVideoLinks(detailHtml);

  return links.map((link) => ({
    title: `HDfilmizle • ${link.title}`,
    url: link.url,
    behaviorHints: {
      notWebReady: false,
    },
  }));
}

module.exports = {
  BASE_URL,
  getCatalog,
  getMeta,
  getStreams,
};
