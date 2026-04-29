import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

const PLAYER_HEADERS = {
    'User-Agent': 'googleusercontent',
    'Referer': 'https://twitter.com/',
    'Accept-Encoding': 'identity'
};

const manifest = {
    id: "com.mooncrown.rectv.bridge",
    version: "12.0.0",
    name: "RECTV Bridge Mode",
    description: "Internal RECTV IDs with External IMDb/TMDB Export",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv_", "tt", "tmdb:", "CH_"],
    catalogs: [
        { id: "rc_live", type: "tv", name: "RECTV Canlı TV" },
        { id: "rc_movie", type: "movie", name: "RECTV Filmler", extra: [{ name: "search" }, { name: "skip" }] },
        { id: "rc_series", type: "series", name: "RECTV Diziler", extra: [{ name: "search" }, { name: "skip" }] }
    ]
};

const builder = new addonBuilder(manifest);

async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const json = await res.json();
        return json.accessToken || (await res.text()).trim();
    } catch (e) { return null; }
}

function parseId(id) {
    const parts = id.split(':');
    const mainId = parts[0];
    
    let type = "movie";
    if (mainId.startsWith("CH_") || id.includes("_tv_")) type = "tv";
    if (id.includes("_series_") || parts.length > 1) type = "series";

    const cleanId = mainId.replace('rectv_movie_', '')
                          .replace('rectv_series_', '')
                          .replace('rectv_tv_', '')
                          .replace('tmdb:', '')
                          .replace('CH_', '')
                          .replace('tt', '');

    return {
        type,
        fullId: id,
        cleanId,
        isExternal: mainId.startsWith('tt') || mainId.startsWith('tmdb:'),
        season: parts[1] ? parseInt(parts[1]) : null,
        episode: parts[2] ? parseInt(parts[2]) : null
    };
}

// 1. CATALOG HANDLER - KENDİ ID'mizi döndür (tt değil)
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log("[CATALOG] Request:", { type, id, extra });
    try {
        const token = await getAuthToken();
        console.log("[CATALOG] Token:", token ? "OK" : "FAIL");
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        
        let url;
        if (id === "rc_live") {
            url = `${BASE_URL}/api/channel/by/category/1/${SW_KEY}/`;
        } else {
            url = extra?.search 
                ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
                : `${BASE_URL}/api/${type === 'movie' ? 'movie' : 'serie'}/by/filtres/0/created/${extra?.skip || 0}/${SW_KEY}/`;
        }
        
        console.log("[CATALOG] Fetching:", url);
        const res = await fetch(url, { headers: authHeaders });
        console.log("[CATALOG] Response status:", res.status);
        
        const data = await res.json();
        console.log("[CATALOG] Data keys:", Object.keys(data));
        
        const items = data.channels || data.posters || data.series || (Array.isArray(data) ? data : []);
        console.log("[CATALOG] Items found:", items.length);
        
        return { 
            metas: items.map(item => {
                // KENDİ ID'mizi kullan - tt'yi META içine gömeceğiz
                return { 
                    id: `rectv_${type}_${item.id}`, 
                    type: type, 
                    name: item.title || item.name, 
                    poster: item.image || item.thumbnail,
                    posterShape: type === 'tv' ? "landscape" : "poster"
                };
            }) 
        };
    } catch (e) { 
        console.error("[CATALOG] Error:", e.message);
        return { metas: [] }; 
    }
});

// 2. META HANDLER - tt ve tmdb ID'leri embed et
builder.defineMetaHandler(async ({ type, id }) => {
    console.log("[META] Request:", { type, id });
    const parsed = parseId(id);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let url;
        if (id.startsWith('CH_') || id.includes('_tv_')) {
            url = `${BASE_URL}/api/channel/${parsed.cleanId}/${SW_KEY}/`;
        } else if (type === 'movie') {
            url = `${BASE_URL}/api/movie/${parsed.cleanId}/${SW_KEY}/`;
        } else {
            url = `${BASE_URL}/api/season/by/serie/${parsed.cleanId}/${SW_KEY}/`;
        }

        console.log("[META] Fetching:", url);
        const res = await fetch(url, { headers });
        console.log("[META] Response status:", res.status);
        
        const data = await res.json();
        console.log("[META] Data keys:", Object.keys(data));

        if (type === 'movie' || type === 'tv') {
            return { 
                meta: { 
                    id: id,
                    type, 
                    name: data.title || data.name, 
                    poster: data.image || data.thumbnail, 
                    background: data.image || data.thumbnail,
                    // tt varsa embed et - diğer sağlayıcılar (Torrentio vb.) bunu görür
                    imdb_id: data.imdb_id || null,
                    tmdb_id: data.tmdb_id || null
                } 
            };
        } else {
            const videos = [];
            if (Array.isArray(data)) {
                data.forEach(s => {
                    const sNum = parseInt(s.title.match(/\d+/) || 1);
                    s.episodes.forEach(ep => {
                        const eNum = parseInt(ep.title.match(/\d+/) || 1);
                        const videoId = `${id}:${sNum}:${eNum}`;
                        videos.push({ id: videoId, title: ep.title, season: sNum, episode: eNum });
                    });
                });
            }
            return { meta: { id, type: 'series', name: data.title || data.name || "Dizi Detayı", poster: data.image || data.thumbnail, videos } };
        }
    } catch (e) { 
        console.error("[META] Error:", e.message);
        return { meta: null }; 
    }
});

// 3. STREAM HANDLER
builder.defineStreamHandler(async ({ id }) => {
    console.log("[STREAM] Request:", { id });
    const parsed = parseId(id);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let sources = [];
        if (parsed.type === 'tv') {
            const res = await fetch(`${BASE_URL}/api/channel/${parsed.cleanId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || (data.url ? [{ url: data.url }] : []);
        } else if (!parsed.season) {
            const res = await fetch(`${BASE_URL}/api/movie/${parsed.cleanId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || [];
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${parsed.cleanId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const season = data.find(s => (s.title.match(/\d+/) || [])[0] == parsed.season);
            const episode = season?.episodes.find(e => (e.title.match(/\d+/) || [])[0] == parsed.episode);
            sources = episode?.sources || [];
        }

        return {
            streams: sources.map(src => ({
                name: "RECTV",
                title: "Oynat",
                url: src.url,
                behaviorHints: { notWebReady: true, proxyHeaders: { "request": PLAYER_HEADERS } }
            }))
        };
    } catch (e) { 
        console.error("[STREAM] Error:", e.message);
        return { streams: [] }; 
    }
});

serveHTTP(builder.getInterface(), { port: PORT });
console.log(`RECTV Bridge Mode running on port ${PORT}`);
