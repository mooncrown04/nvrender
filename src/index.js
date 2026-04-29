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
    version: "12.1.0",
    name: "RECTV Bridge Mode",
    description: "Internal RECTV IDs with External IMDb/TMDB Export",
    resources: [
        "catalog",
        {
            name: "meta",
            types: ["movie", "series", "tv"],
            idPrefixes: ["rectv_", "tt", "tmdb:", "CH_"]
        },
        {
            name: "stream",
            types: ["movie", "series", "tv"],
            idPrefixes: ["rectv_", "tt", "tmdb:", "CH_"]
        }
    ],
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
    if (mainId.startsWith("CH_") || mainId.includes("_tv_")) type = "tv";
    else if (mainId.includes("_series_") || parts.length > 1) type = "series";

    const cleanId = mainId
        .replace('rectv_movie_', '')
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

// 1. CATALOG HANDLER
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        if (!token) return { metas: [] };
        
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        
        let url;
        if (id === "rc_live") {
            url = `${BASE_URL}/api/channel/by/category/1/${SW_KEY}/`;
        } else if (id === "rc_movie") {
            if (extra?.search) {
                url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            } else {
                url = `${BASE_URL}/api/movie/by/filtres/0/created/${extra?.skip || 0}/${SW_KEY}/`;
            }
        } else if (id === "rc_series") {
            if (extra?.search) {
                url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            } else {
                url = `${BASE_URL}/api/serie/by/filtres/0/created/${extra?.skip || 0}/${SW_KEY}/`;
            }
        } else {
            return { metas: [] };
        }
        
        const res = await fetch(url, { headers: authHeaders });
        if (!res.ok) return { metas: [] };
        
        const data = await res.json();
        
        // Farklı API yanıt yapılarını destekle
        let items = [];
        if (id === "rc_live") {
            items = data.channels || data.data?.channels || data;
        } else if (id === "rc_movie") {
            items = data.posters || data.movies || data.data?.posters || data.data?.movies || data;
        } else if (id === "rc_series") {
            items = data.series || data.posters || data.data?.series || data.data?.posters || data;
        }
        
        if (!Array.isArray(items)) items = [];
        
        return { 
            metas: items.map(item => {
                const externalId = item.imdb_id || item.tmdb_id;
                const itemType = id === "rc_live" ? "tv" : (id === "rc_movie" ? "movie" : "series");
                
                return { 
                    id: externalId ? (externalId.startsWith('tt') ? externalId : `tmdb:${externalId}`) : `rectv_${itemType}_${item.id}`, 
                    type: itemType, 
                    name: item.title || item.name || "Untitled", 
                    poster: item.image || item.thumbnail || item.logo || "",
                    posterShape: itemType === 'tv' ? "landscape" : "poster"
                };
            }) 
        };
    } catch (e) { 
        console.error("Catalog error:", e);
        return { metas: [] }; 
    }
});

// 2. META HANDLER
builder.defineMetaHandler(async ({ type, id }) => {
    const parsed = parseId(id);
    
    try {
        const token = await getAuthToken();
        if (!token) return { meta: null };
        
        const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let url;
        
        if (type === 'tv' || id.startsWith('CH_') || id.includes('_tv_')) {
            url = `${BASE_URL}/api/channel/${parsed.cleanId}/${SW_KEY}/`;
        } else if (type === 'movie') {
            url = `${BASE_URL}/api/movie/${parsed.cleanId}/${SW_KEY}/`;
        } else if (type === 'series') {
            url = `${BASE_URL}/api/season/by/serie/${parsed.cleanId}/${SW_KEY}/`;
        } else {
            return { meta: null };
        }

        const res = await fetch(url, { headers });
        if (!res.ok) return { meta: null };
        
        const data = await res.json();

        if (type === 'movie' || type === 'tv') {
            return { 
                meta: { 
                    id: id,
                    type: type, 
                    name: data.title || data.name || "Untitled", 
                    poster: data.image || data.thumbnail || data.logo || "", 
                    background: data.image || data.thumbnail || data.logo || "",
                    description: data.description || data.plot || "",
                    imdb_id: data.imdb_id || (id.startsWith('tt') ? id : null)
                } 
            };
        } else if (type === 'series') {
            const videos = [];
            const seasons = data.seasons || data;
            
            if (Array.isArray(seasons)) {
                seasons.forEach((s, sIdx) => {
                    const sNum = parseInt(s.title?.match(/\d+/)?.[0]) || (sIdx + 1);
                    const episodes = s.episodes || [];
                    
                    episodes.forEach((ep, eIdx) => {
                        const eNum = parseInt(ep.title?.match(/\d+/)?.[0]) || (eIdx + 1);
                        const videoId = `${id}:${sNum}:${eNum}`;
                        
                        videos.push({ 
                            id: videoId, 
                            title: ep.title || `Episode ${eNum}`, 
                            season: sNum, 
                            episode: eNum 
                        });
                    });
                });
            }
            
            return { 
                meta: { 
                    id: id, 
                    type: 'series', 
                    name: data.title || data.name || "Series", 
                    poster: data.image || data.thumbnail || "",
                    background: data.image || data.thumbnail || "",
                    description: data.description || "",
                    videos: videos 
                } 
            };
        }
        
        return { meta: null };
    } catch (e) { 
        console.error("Meta error:", e);
        return { meta: null }; 
    }
});

// 3. STREAM HANDLER
builder.defineStreamHandler(async ({ type, id }) => {
    const parsed = parseId(id);
    
    try {
        const token = await getAuthToken();
        if (!token) return { streams: [] };
        
        const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let sources = [];
        
        if (parsed.type === 'tv' || type === 'tv') {
            const res = await fetch(`${BASE_URL}/api/channel/${parsed.cleanId}/${SW_KEY}/`, { headers });
            if (res.ok) {
                const data = await res.json();
                sources = data.sources || (data.url ? [{ url: data.url }] : []);
            }
        } else if (!parsed.season) {
            const res = await fetch(`${BASE_URL}/api/movie/${parsed.cleanId}/${SW_KEY}/`, { headers });
            if (res.ok) {
                const data = await res.json();
                sources = data.sources || [];
            }
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${parsed.cleanId}/${SW_KEY}/`, { headers });
            if (res.ok) {
                const data = await res.json();
                const seasons = data.seasons || data;
                
                if (Array.isArray(seasons)) {
                    const season = seasons.find(s => {
                        const sNum = parseInt(s.title?.match(/\d+/)?.[0]);
                        return sNum === parsed.season;
                    });
                    
                    if (season?.episodes) {
                        const episode = season.episodes.find(e => {
                            const eNum = parseInt(e.title?.match(/\d+/)?.[0]);
                            return eNum === parsed.episode;
                        });
                        sources = episode?.sources || [];
                    }
                }
            }
        }

        return {
            streams: sources.map(src => ({
                name: "RECTV",
                title: "Oynat",
                url: src.url,
                behaviorHints: { 
                    notWebReady: true, 
                    proxyHeaders: { "request": PLAYER_HEADERS } 
                }
            }))
        };
    } catch (e) { 
        console.error("Stream error:", e);
        return { streams: [] }; 
    }
});

serveHTTP(builder.getInterface(), { port: PORT });
console.log(`RECTV Bridge Mode running on port ${PORT}`);
