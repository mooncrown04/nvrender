import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json'
};

// BILGI NOTU: Stremio-RecTV Entegrasyonu Başlatılıyor.
const manifest = {
    id: "com.mooncrown.rectv.final",
    version: "2.1.0",
    name: "RECTV Pro",
    description: "RecTV API tabanlı Film ve Dizi eklentisi (Final Fix)",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv_"],
    catalogs: [
        { id: "rc_movie", type: "movie", name: "RECTV Filmler", extra: [{ name: "search" }] },
        { id: "rc_series", type: "series", name: "RECTV Diziler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: COMMON_HEADERS });
        const text = await res.text();
        const json = JSON.parse(text);
        return json.accessToken || text.trim();
    } catch (e) { return null; }
}

// CATALOG HANDLER
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const headers = { ...COMMON_HEADERS, 'Authorization': `Bearer ${token}` };
        
        let url = extra?.search 
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${type === 'movie' ? 'movie' : 'serie'}/by/filtres/0/created/0/${SW_KEY}/`;

        const res = await fetch(url, { headers });
        const data = await res.json();
        
        // HATA DUZELTME: API'den gelen farklı veri yapılarını kontrol et
        const items = data.posters || data.series || (Array.isArray(data) ? data : []);

        const metas = items.map(item => ({
            id: `rectv_${type}_${item.id}`,
            type: type,
            name: item.title || item.name,
            poster: item.image || item.thumbnail
        }));

        return { metas };
    } catch (e) { return { metas: [] }; }
});

// META HANDLER
builder.defineMetaHandler(async ({ type, id }) => {
    const internalId = id.split('_').pop();
    try {
        const token = await getAuthToken();
        const headers = { ...COMMON_HEADERS, 'Authorization': `Bearer ${token}` };
        
        const endpoint = type === 'movie' 
            ? `${BASE_URL}/api/movie/${internalId}/${SW_KEY}/`
            : `${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`;

        const res = await fetch(endpoint, { headers });
        const data = await res.json();

        if (type === 'movie') {
            return {
                meta: {
                    id,
                    type: 'movie',
                    name: data.title || "Film",
                    poster: data.image,
                    background: data.image,
                    description: data.description || ""
                }
            };
        } else {
            const videos = [];
            const seasons = Array.isArray(data) ? data : [];
            seasons.forEach(season => {
                const sNum = parseInt(season.title.match(/\d+/) || 1);
                (season.episodes || []).forEach(ep => {
                    const eNum = parseInt(ep.title.match(/\d+/) || 1);
                    videos.push({
                        id: `${id}:${sNum}:${eNum}`,
                        title: ep.title || `${eNum}. Bölüm`,
                        season: sNum,
                        episode: eNum,
                        released: new Date().toISOString()
                    });
                });
            });
            return { meta: { id, type: 'series', name: "Dizi Detayı", videos } };
        }
    } catch (e) { 
        console.error("Meta Error:", e);
        return { meta: {} }; 
    }
});

// STREAM HANDLER
builder.defineStreamHandler(async ({ id }) => {
    // BILGI NOTU: Link yakalanıyor...
    const parts = id.split(':');
    const baseId = parts[0]; 
    const sNum = parts[1];
    const eNum = parts[2];
    const internalId = baseId.split('_').pop();
    const type = id.includes('_movie_') ? 'movie' : 'series';

    try {
        const token = await getAuthToken();
        const headers = { ...COMMON_HEADERS, 'Authorization': `Bearer ${token}` };
        
        let streams = [];
        if (type === 'movie') {
            const res = await fetch(`${BASE_URL}/api/movie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const sources = data.sources || [];
            
            streams = sources.map((src, i) => ({
                name: "RECTV",
                title: `Kaynak ${i + 1}\n${src.quality || 'HD'}`,
                url: src.url,
                behaviorHints: { notWebReady: true, proxyHeaders: { "Referer": "https://twitter.com/" } }
            }));
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const season = data.find(s => parseInt(s.title.match(/\d+/)) == sNum);
            const episode = season?.episodes.find(e => parseInt(e.title.match(/\d+/)) == eNum);
            
            streams = (episode?.sources || []).map((src, i) => ({
                name: "RECTV",
                title: `Kaynak ${i + 1}\n${src.quality || 'HD'}`,
                url: src.url,
                behaviorHints: { notWebReady: true, proxyHeaders: { "Referer": "https://twitter.com/" } }
            }));
        }
        return { streams };
    } catch (e) { 
        console.error("Stream Error:", e);
        return { streams: [] }; 
    }
});

serveHTTP(builder.getInterface(), { port: PORT });
