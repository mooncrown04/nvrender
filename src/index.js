import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const COMMON_HEADERS = {
    'User-Agent': 'EasyPlex (Android 14; SM-A546B; Samsung Galaxy A54 5G; tr)',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

// BILGI NOTU: Manifest Sinewix standartlarına göre güncellendi.
const manifest = {
    id: "com.mooncrown.rectv.v3",
    version: "3.0.0",
    name: "RECTV Pro",
    description: "Sinewix Altyapılı RecTV Eklentisi",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv_"], // Prefix sabitlendi
    catalogs: [
        { id: "rc_movie", type: "movie", name: "RECTV Filmler", extra: [{ name: "search" }, { name: "skip" }] },
        { id: "rc_series", type: "series", name: "RECTV Diziler", extra: [{ name: "search" }, { name: "skip" }] }
    ]
};

const builder = new addonBuilder(manifest);

async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: COMMON_HEADERS });
        const json = await res.json();
        return json.accessToken || null;
    } catch (e) { 
        console.error("Auth Error:", e);
        return null; 
    }
}

// CATALOG HANDLER
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const headers = { ...COMMON_HEADERS, 'Authorization': `Bearer ${token}` };
        
        let url;
        if (extra?.search) {
            url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else {
            const path = type === 'movie' ? 'movie' : 'serie';
            const skip = extra?.skip || 0;
            url = `${BASE_URL}/api/${path}/by/filtres/0/created/${skip}/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers });
        const data = await res.json();
        const items = data.posters || data.series || (Array.isArray(data) ? data : []);

        const metas = items.map(item => ({
            id: `rectv_${type}_${item.id}`, // Örn: rectv_movie_123
            type: type,
            name: item.title || item.name,
            poster: item.image || item.thumbnail,
            description: item.description || ""
        }));

        return { metas };
    } catch (e) { 
        console.error("Catalog Error:", e);
        return { metas: [] }; 
    }
});

// META HANDLER
builder.defineMetaHandler(async ({ type, id }) => {
    // BILGI NOTU: ID parçalama Sinewix gibi idPrefixes ile uyumlu yapıldı.
    const internalId = id.split('_').pop(); 
    try {
        const token = await getAuthToken();
        const headers = { ...COMMON_HEADERS, 'Authorization': `Bearer ${token}` };
        
        if (type === 'movie') {
            const res = await fetch(`${BASE_URL}/api/movie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            return {
                meta: {
                    id: id,
                    type: 'movie',
                    name: data.title,
                    poster: data.image,
                    background: data.image,
                    description: data.description
                }
            };
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const videos = [];

            if (Array.isArray(data)) {
                data.forEach(season => {
                    const sNum = parseInt(season.title.match(/\d+/) || 1);
                    (season.episodes || []).forEach(ep => {
                        const eNum = parseInt(ep.title.match(/\d+/) || 1);
                        videos.push({
                            id: `${id}:${sNum}:${eNum}`, // Örn: rectv_series_123:1:1
                            title: ep.title || `${eNum}. Bölüm`,
                            season: sNum,
                            episode: eNum,
                            released: new Date().toISOString()
                        });
                    });
                });
            }
            return { meta: { id, type: 'series', name: "Dizi Detayı", videos } };
        }
    } catch (e) { 
        console.error("Meta Error:", e);
        return { meta: {} }; 
    }
});

// STREAM HANDLER
builder.defineStreamHandler(async ({ id }) => {
    // Format: rectv_series_123:1:1 veya rectv_movie_123
    const parts = id.split(':');
    const fullPrefixId = parts[0]; 
    const internalId = fullPrefixId.split('_').pop();
    const type = id.includes('_movie_') ? 'movie' : 'series';
    const sNum = parts[1];
    const eNum = parts[2];

    try {
        const token = await getAuthToken();
        const headers = { ...COMMON_HEADERS, 'Authorization': `Bearer ${token}` };
        
        let streams = [];
        if (type === 'movie') {
            const res = await fetch(`${BASE_URL}/api/movie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            streams = (data.sources || []).map((src, i) => ({
                name: "RECTV",
                title: `Kaynak ${i + 1}\n${src.quality || ''}`,
                url: src.url,
                behaviorHints: { proxyHeaders: { "Referer": "https://twitter.com/" } }
            }));
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const season = data.find(s => parseInt(s.title.match(/\d+/)) == sNum);
            const episode = season?.episodes.find(e => parseInt(e.title.match(/\d+/)) == eNum);
            
            streams = (episode?.sources || []).map((src, i) => ({
                name: "RECTV",
                title: `Kaynak ${i + 1}\n${src.quality || ''}`,
                url: src.url,
                behaviorHints: { proxyHeaders: { "Referer": "https://twitter.com/" } }
            }));
        }
        return { streams };
    } catch (e) { 
        console.error("Stream Error:", e);
        return { streams: [] }; 
    }
});

serveHTTP(builder.getInterface(), { port: PORT });
