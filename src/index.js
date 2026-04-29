import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

const PLAYER_HEADERS = {
    'User-Agent': 'googleusercontent',
    'Referer': 'https://twitter.com/',
    'Accept-Encoding': 'identity'
};

// 🔥 CACHE (IMDb → internal ID)
const idCache = new Map();

// ================= MANIFEST =================
const manifest = {
    id: "com.mooncrown.rectv.fullbridge",
    version: "13.0.0",
    name: "RECTV Full Bridge",
    description: "Full IMDb/TMDB Compatible Addon",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "channel"],
    idPrefixes: ["tt", "tmdb:", "rectv_", "CH_"],
    catalogs: [
        { id: "rc_live", type: "channel", name: "Canlı TV" },
        { id: "rc_movie", type: "movie", name: "Filmler", extra: [{ name: "search" }] },
        { id: "rc_series", type: "series", name: "Diziler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

// ================= TOKEN =================
async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const json = await res.json();
        return json.accessToken;
    } catch {
        return null;
    }
}

// ================= ID PARSE =================
function parseId(id) {
    const parts = id.split(':');
    const main = parts[0];

    let type = "movie";
    if (main.startsWith("CH_")) type = "channel";
    if (parts.length > 1) type = "series";

    return {
        raw: id,
        main,
        season: parts[1],
        episode: parts[2],
        isExternal: main.startsWith("tt") || main.startsWith("tmdb:")
    };
}

// ================= SEARCH MAPPING =================
async function mapExternalToInternal(parsed, token) {
    if (!parsed.isExternal) return parsed.main;

    if (idCache.has(parsed.main)) return idCache.get(parsed.main);

    try {
        const headers = { ...HEADERS, Authorization: `Bearer ${token}` };

        // 🔥 SEARCH ile eşle
        const searchTerm = parsed.main.replace("tt", "");
        const res = await fetch(`${BASE_URL}/api/search/${searchTerm}/${SW_KEY}/`, { headers });
        const data = await res.json();

        const item = (data.posters || data.series || []).find(i =>
            i.imdb_id === parsed.main
        );

        if (item) {
            const internal = item.id.toString();
            idCache.set(parsed.main, internal);
            return internal;
        }
    } catch {}

    return null;
}

// ================= CATALOG =================
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const headers = { ...HEADERS, Authorization: `Bearer ${token}` };

        let url;

        if (id === "rc_live") {
            url = `${BASE_URL}/api/channel/by/category/1/${SW_KEY}/`;
        } else if (extra?.search) {
            url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else {
            url = `${BASE_URL}/api/${type === 'movie' ? 'movie' : 'serie'}/by/filtres/0/created/0/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers });
        const data = await res.json();

        const items = data.channels || data.posters || data.series || [];

        return {
            metas: items.map(i => ({
                id: i.imdb_id ? i.imdb_id : `rectv_${type}_${i.id}`,
                type,
                name: i.title || i.name,
                poster: i.image || i.thumbnail
            }))
        };

    } catch {
        return { metas: [] };
    }
});

// ================= META =================
builder.defineMetaHandler(async ({ type, id }) => {
    const parsed = parseId(id);
    const token = await getAuthToken();

    const internalId = await mapExternalToInternal(parsed, token);

    if (!internalId) return { meta: {} };

    const headers = { ...HEADERS, Authorization: `Bearer ${token}` };

    try {
        let url;

        if (type === "movie") {
            url = `${BASE_URL}/api/movie/${internalId}/${SW_KEY}/`;
        } else if (type === "series") {
            url = `${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`;
        } else {
            url = `${BASE_URL}/api/channel/${internalId}/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers });
        const data = await res.json();

        if (type !== "series") {
            return {
                meta: {
                    id,
                    type,
                    name: data.title || data.name,
                    poster: data.image,
                    imdb_id: id.startsWith("tt") ? id : null
                }
            };
        }

        // SERIES
        const videos = [];
        data.forEach(s => {
            const sNum = parseInt(s.title.match(/\d+/)) || 1;
            s.episodes.forEach(e => {
                const eNum = parseInt(e.title.match(/\d+/)) || 1;
                videos.push({
                    id: `${id}:${sNum}:${eNum}`,
                    title: e.title,
                    season: sNum,
                    episode: eNum
                });
            });
        });

        return { meta: { id, type: "series", videos } };

    } catch {
        return { meta: {} };
    }
});

// ================= STREAM =================
builder.defineStreamHandler(async ({ id }) => {
    const parsed = parseId(id);
    const token = await getAuthToken();

    const internalId = await mapExternalToInternal(parsed, token);
    if (!internalId) return { streams: [] };

    const headers = { ...HEADERS, Authorization: `Bearer ${token}` };

    try {
        let sources = [];

        if (parsed.main.startsWith("CH_")) {
            const res = await fetch(`${BASE_URL}/api/channel/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || [];
        } else if (!parsed.season) {
            const res = await fetch(`${BASE_URL}/api/movie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || [];
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();

            const season = data.find(s => s.title.includes(parsed.season));
            const episode = season?.episodes.find(e => e.title.includes(parsed.episode));

            sources = episode?.sources || [];
        }

        return {
            streams: sources.map(s => ({
                name: "RECTV",
                url: s.url,
                behaviorHints: {
                    notWebReady: true,
                    proxyHeaders: { request: PLAYER_HEADERS }
                }
            }))
        };

    } catch {
        return { streams: [] };
    }
});

// ================= START =================
serveHTTP(builder.getInterface(), { port: PORT });
