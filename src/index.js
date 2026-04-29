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
    // Burası kritik: Hem kendi prefiximizi hem de standartları ekliyoruz
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

// ID'leri hem içeride hem dışarıda kullanılabilir hale getiren ayıklayıcı
function parseId(id) {
    // 1. Dizi bölümleri: tt123:1:1 veya rectv_series_123:1:1
    const parts = id.split(':');
    const mainId = parts[0];
    
    // 2. Tip ve Saf ID bulma
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

// 1. CATALOG HANDLER
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        
        let url;
        if (id === "rc_live") {
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
            metas: items.map(item => {
                // Eğer API'den gelen veride tt_id (imdb) varsa onu kullan, yoksa kendi ID'ni bas
                // Bu sayede kazıyıcılar direkt tt_id üzerinden yakalayabilir
                const externalId = item.imdb_id || item.tmdb_id; 
                return { 
                    id: externalId ? (externalId.startsWith('tt') ? externalId : `tmdb:${externalId}`) : `rectv_${type}_${item.id}`, 
                    type: type, 
                    name: item.title || item.name, 
                    poster: item.image || item.thumbnail,
                    posterShape: type === 'tv' ? "landscape" : "poster"
                };
            }) 
        };
    } catch (e) { return { metas: [] }; }
});

// 2. META HANDLER
builder.defineMetaHandler(async ({ type, id }) => {
    const parsed = parseId(id);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let url;
        // Eğer ID dışarıdan (tt...) geliyorsa önce kendi API'mizde aratıp ID'mizi bulmamız lazım
        // Ama şimdilik senin katalogdan gelen "rectv_" id'lerini işleyelim:
        if (id.startsWith('CH_') || id.includes('_tv_')) {
            url = `${BASE_URL}/api/channel/${parsed.cleanId}/${SW_KEY}/`;
        } else if (type === 'movie') {
            url = `${BASE_URL}/api/movie/${parsed.cleanId}/${SW_KEY}/`;
        } else {
            url = `${BASE_URL}/api/season/by/serie/${parsed.cleanId}/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers });
        const data = await res.json();

        if (type === 'movie' || type === 'tv') {
            return { 
                meta: { 
                    id: id, // Gelen ID'yi koru (tt ise tt kalsın)
                    type, 
                    name: data.title || data.name, 
                    poster: data.image || data.thumbnail, 
                    background: data.image || data.thumbnail,
                    // Dış kazıyıcılar için IMDb ID'sini meta içine gömüyoruz
                    imdb_id: data.imdb_id || (id.startsWith('tt') ? id : null)
                } 
            };
        } else {
            const videos = [];
            if (Array.isArray(data)) {
                data.forEach(s => {
                    const sNum = parseInt(s.title.match(/\d+/) || 1);
                    s.episodes.forEach(ep => {
                        const eNum = parseInt(ep.title.match(/\d+/) || 1);
                        // Dizi bölümlerini de tt formatında export et
                        const videoId = id.startsWith('tt') ? `${id}:${sNum}:${eNum}` : `${id}:${sNum}:${eNum}`;
                        videos.push({ id: videoId, title: ep.title, season: sNum, episode: eNum });
                    });
                });
            }
            return { meta: { id, type: 'series', name: "Dizi Detayı", videos } };
        }
    } catch (e) { return { meta: {} }; }
});

// 3. STREAM HANDLER
builder.defineStreamHandler(async ({ id }) => {
    const parsed = parseId(id);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let sources = [];
        // Stream kısmında mecburen kendi API'mize saf ID ile gitmeliyiz
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
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });
