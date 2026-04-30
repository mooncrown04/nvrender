import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

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
    id: "com.mooncrown.rectv.v25",
    version: "9.0.0",
    name: "RECTV Ultimate Movie Fix",
    description: "Film & Dizi Tam Uyumluluk Modu",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
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
        const text = await res.text();
        if (text.includes("accessToken")) return JSON.parse(text).accessToken;
        return text.trim();
    } catch (e) { return null; }
}

// ID'den sadece sayısal kısmı ayıklar
function extractId(fullId) {
    if (!fullId) return "";
    return fullId.replace("rectv_movie_", "").replace("rectv_series_", "").replace("CH_", "").replace("tt", "").split(':')[0];
}

// --- KATALOG (LİSTELEME) ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        
        let url;
        if (id === "rc_live") {
            url = `${BASE_URL}/api/channel/by/category/1/${SW_KEY}/`;
        } else if (extra?.search) {
            url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else {
            const apiPath = type === 'movie' ? 'movie' : 'serie';
            url = `${BASE_URL}/api/${apiPath}/by/filtres/0/created/${extra?.skip || 0}/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers: authHeaders });
        const data = await res.json();
        
        // API'den gelen karmaşık yapıyı (posters, series, channels) normalize et
        let items = [];
        if (extra?.search) {
            items = (type === 'movie' ? data.posters : data.series) || [];
        } else {
            items = data.channels || data.posters || data.series || (Array.isArray(data) ? data : []);
        }

        return { 
            metas: items.map(item => ({
                id: type === 'tv' ? `CH_${item.id}` : `rectv_${type}_${item.id}`,
                type: type,
                name: item.title || item.name,
                poster: item.image || item.thumbnail,
                posterShape: type === 'tv' ? "landscape" : "poster"
            }))
        };
    } catch (e) { return { metas: [] }; }
});

// --- META (DETAYLAR) ---
builder.defineMetaHandler(async ({ type, id }) => {
    const cleanId = extractId(id);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let url;
        if (id.startsWith('CH_')) url = `${BASE_URL}/api/channel/${cleanId}/${SW_KEY}/`;
        else if (type === 'movie') url = `${BASE_URL}/api/movie/${cleanId}/${SW_KEY}/`;
        else url = `${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`;

        const res = await fetch(url, { headers });
        const data = await res.json();

        if (type === 'movie' || id.startsWith('CH_')) {
            return { meta: {
                id, type, name: data.title || data.name,
                poster: data.image || data.thumbnail,
                background: data.image || data.thumbnail,
                description: data.description || "RECTV Content"
            }};
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
            return { meta: { id, type: 'series', name: "Dizi", videos }};
        }
    } catch (e) { return { meta: {} }; }
});

// --- STREAM (OYNATMA) ---
builder.defineStreamHandler(async ({ id, type }) => {
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
    const parts = id.split(':');
    let sources = [];

    try {
        let targetId = extractId(id);

        // tt ID'si ile (Scraper) geliyorsa
        if (id.startsWith('tt')) {
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/${parts[0]}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
            const tmdbData = await tmdbRes.json();
            const tmdbObj = type === 'series' ? tmdbData.tv_results?.[0] : tmdbData.movie_results?.[0];
            
            if (tmdbObj) {
                const searchTitle = tmdbObj.title || tmdbObj.name;
                const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(searchTitle)}/${SW_KEY}/`, { headers });
                const sData = await sRes.json();
                const pool = type === 'movie' ? (sData.posters || []) : (sData.series || []);
                const found = pool.find(i => (i.title || i.name).toLowerCase().includes(searchTitle.toLowerCase().split(' ')[0]));
                if (found) targetId = found.id;
            }
        }

        // Kaynakları çek
        if (id.startsWith('CH_')) {
            const res = await fetch(`${BASE_URL}/api/channel/${targetId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || (data.url ? [{ url: data.url }] : []);
        } else if (type === 'movie' || id.includes('movie')) {
            // FİLM FİX: Direkt detay API'sine gidip sources alıyoruz
            const res = await fetch(`${BASE_URL}/api/movie/${targetId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || [];
        } else {
            // DİZİ FİX
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${targetId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const season = data.find(s => (s.title.match(/\d+/) || [])[0] == parts[1]);
            const episode = season?.episodes.find(e => (e.title.match(/\d+/) || [])[0] == parts[2]);
            sources = episode?.sources || [];
        }

        return {
            streams: sources.map((src, idx) => ({
                name: "RECTV",
                title: src.title || `Kaynak ${idx + 1}`,
                url: src.url,
                behaviorHints: { notWebReady: true, proxyHeaders: { "request": PLAYER_HEADERS } }
            }))
        };
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });
