import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96"; // tt -> başlık dönüşümü için

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
    id: "com.mooncrown.rectv.v23",
    version: "8.1.0",
    name: "RECTV Fix Scraper",
    description: "Kendi ID + tt (IMDb) Arama Desteği",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv", "channel"],
    idPrefixes: ["rectv_", "tt", "CH_"],
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

function getCleanId(id) {
    if (!id) return "";
    return id.split(':').shift()
             .replace('tmdb:', '')
             .replace('CH_', '')
             .replace('tt', '')
             .replace('rectv_movie_', '')
             .replace('rectv_series_', '');
}

// tt ID'sini başlığa çeviren yardımcı fonksiyon
async function getTitleFromImdb(tt, type) {
    try {
        const tmdbType = type === 'series' ? 'tv' : 'movie';
        const res = await fetch(`https://api.themoviedb.org/3/find/${tt}?api_key=${TMDB_KEY}&external_source=imdb_id`);
        const data = await res.json();
        const result = data[`${tmdbType}_results`][0];
        return result ? (result.title || result.name) : null;
    } catch (e) { return null; }
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let url;
        if (id === "rc_live" || type === "tv") {
            url = `${BASE_URL}/api/channel/by/category/1/${SW_KEY}/`;
        } else {
            url = extra?.search 
                ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
                : `${BASE_URL}/api/${type === 'movie' ? 'movie' : 'serie'}/by/filtres/0/created/${extra?.skip || 0}/${SW_KEY}/`;
        }
        const res = await fetch(url, { headers: authHeaders });
        const data = await res.json();
        const items = data.channels || data.posters || data.series || (Array.isArray(data) ? data : []);
        return { 
            metas: items.map(item => ({ 
                id: (id === "rc_live" || type === "tv") ? `CH_${item.id}` : `rectv_${type}_${item.id}`, 
                type: type, 
                name: item.title || item.name, 
                poster: item.image || item.thumbnail,
                posterShape: id === "rc_live" ? "landscape" : "poster"
            })) 
        };
    } catch (e) { return { metas: [] }; }
});

builder.defineMetaHandler(async ({ type, id }) => {
    const cleanId = getCleanId(id);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let url;
        if (id.startsWith('CH_')) {
            url = `${BASE_URL}/api/channel/${cleanId}/${SW_KEY}/`;
        } else if (type === 'movie' || id.includes('movie')) {
            url = `${BASE_URL}/api/movie/${cleanId}/${SW_KEY}/`;
        } else {
            url = `${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers });
        const data = await res.json();

        if (type === 'movie' || id.startsWith('CH_') || type === 'tv') {
            return { 
                meta: { id, type, name: data.title || data.name, poster: data.image || data.thumbnail, background: data.image || data.thumbnail, description: data.description || "RECTV" } 
            };
        } else {
            const videos = [];
            if (Array.isArray(data)) {
                data.forEach(s => {
                    const sNum = parseInt(s.title.match(/\d+/) || 1);
                    s.episodes.forEach(ep => {
                        const eNum = parseInt(ep.title.match(/\d+/) || 1);
                        videos.push({ id: `${id}:${sNum}:${eNum}`, title: ep.title, season: sNum, episode: eNum });
                    });
                });
            }
            return { meta: { id, type: 'series', name: "Dizi", videos } };
        }
    } catch (e) { return { meta: {} }; }
});

// --- STREAM HANDLER: Hem kendi ID'sini hem tt ID'sini yönetir ---
builder.defineStreamHandler(async ({ id, type }) => {
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
    const parts = id.split(':');
    let sources = [];

    try {
        // 1. tt (IMDb) İLE GELEN ARAMA (KAZIYICI MANTIĞI)
        if (id.startsWith('tt')) {
            const ttId = parts[0];
            const title = await getTitleFromImdb(ttId, type);
            if (!title) return { streams: [] };

            // RECTV içinde bu başlığı ara
            const searchRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers });
            const searchData = await searchRes.json();
            const pool = type === 'movie' ? (searchData.posters || []) : (searchData.series || []);
            
            // İlk eşleşen içeriği al
            const found = pool.find(i => (i.title || i.name).toLowerCase().includes(title.toLowerCase()));
            if (!found) return { streams: [] };

            if (type === 'movie') {
                const res = await fetch(`${BASE_URL}/api/movie/${found.id}/${SW_KEY}/`, { headers });
                const data = await res.json();
                sources = data.sources || [];
            } else {
                const res = await fetch(`${BASE_URL}/api/season/by/serie/${found.id}/${SW_KEY}/`, { headers });
                const data = await res.json();
                const season = data.find(s => (s.title.match(/\d+/) || [])[0] == parts[1]);
                const episode = season?.episodes.find(e => (e.title.match(/\d+/) || [])[0] == parts[2]);
                sources = episode?.sources || [];
            }
        } 
        // 2. KENDİ KATALOĞUNDAN GELEN ARAMA (ORİJİNAL MANTIK)
        else {
            const cleanId = getCleanId(parts[0]);
            if (id.startsWith('CH_')) {
                const res = await fetch(`${BASE_URL}/api/channel/${cleanId}/${SW_KEY}/`, { headers });
                const data = await res.json();
                sources = data.sources || (data.url ? [{ url: data.url }] : []);
            } else if (!id.includes(':')) {
                const res = await fetch(`${BASE_URL}/api/movie/${cleanId}/${SW_KEY}/`, { headers });
                const data = await res.json();
                sources = data.sources || [];
            } else {
                const res = await fetch(`${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`, { headers });
                const data = await res.json();
                const season = data.find(s => (s.title.match(/\d+/) || [])[0] == parts[1]);
                const episode = season?.episodes.find(e => (e.title.match(/\d+/) || [])[0] == parts[2]);
                sources = episode?.sources || [];
            }
        }

        return {
            streams: sources.map(src => ({
                name: "RECTV",
                title: id.startsWith('CH_') ? "CANLI YAYIN" : "HD",
                url: src.url,
                behaviorHints: { notWebReady: true, proxyHeaders: { "request": PLAYER_HEADERS } }
            }))
        };
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });
