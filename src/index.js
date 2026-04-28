import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://twitter.com/',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const manifest = {
    id: "com.mooncrown.rectv.v2",
    version: "2.0.0",
    name: "MOONCROWN RECTV",
    description: "RecTV API tabanlı Film ve Dizi eklentisi",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv_"], // Karışıklığı önlemek için özel prefix
    catalogs: [
        { id: "rc_movie", type: "movie", name: "RECTV Filmler", extra: [{ name: "search" }] },
        { id: "rc_series", type: "series", name: "RECTV Diziler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

// Yardımcı: Token Alımı (Sinewix'teki gibi otomatik)
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
        
        let url = "";
        if (extra?.search) {
            url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else {
            const path = type === 'movie' ? 'movie' : 'serie';
            url = `${BASE_URL}/api/${path}/by/filtres/0/created/0/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers });
        const data = await res.json();
        const items = type === 'movie' ? (data.posters || data) : (data.series || data);

        const metas = (Array.isArray(items) ? items : []).map(item => ({
            id: `rectv_${type}_${item.id}`, // Örn: rectv_movie_123
            type: type,
            name: item.title || item.name,
            poster: item.image || item.thumbnail
        }));

        return { metas };
    } catch (e) { return { metas: [] }; }
});

// META HANDLER
builder.defineMetaHandler(async ({ type, id }) => {
    const internalId = id.replace(`rectv_${type}_`, "");
    try {
        const token = await getAuthToken();
        const headers = { ...COMMON_HEADERS, 'Authorization': `Bearer ${token}` };
        
        const path = type === 'movie' ? 'movie' : 'season/by/serie';
        const res = await fetch(`${BASE_URL}/api/${path}/${internalId}/${SW_KEY}/`, { headers });
        const data = await res.json();

        if (type === 'movie') {
            return { meta: { id, type, name: data.title, poster: data.image, description: data.description } };
        } else {
            // Dizi için sezonları/bölümleri Sinewix formatında hazırla
            const videos = [];
            data.forEach(season => {
                const sNum = parseInt(season.title.match(/\d+/) || 1);
                season.episodes.forEach(ep => {
                    const eNum = parseInt(ep.title.match(/\d+/) || 1);
                    videos.push({
                        id: `${id}:${sNum}:${eNum}`,
                        title: ep.title,
                        season: sNum,
                        episode: eNum
                    });
                });
            });
            return { meta: { id, type, name: "Dizi Detayı", videos } };
        }
    } catch (e) { return { meta: {} }; }
});

// STREAM HANDLER (Kazıyıcı mantığı burada çalışır)
builder.defineStreamHandler(async ({ id }) => {
    // ID Formatı: rectv_series_123:1:5 veya rectv_movie_123
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
            streams = (data.sources || []).map((src, i) => ({
                name: "RECTV",
                title: `Kaynak ${i + 1}`,
                url: src.url
            }));
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const season = data.find(s => parseInt(s.title.match(/\d+/)) == sNum);
            const episode = season?.episodes.find(e => parseInt(e.title.match(/\d+/)) == eNum);
            
            streams = (episode?.sources || []).map((src, i) => ({
                name: "RECTV",
                title: `Kaynak ${i + 1}`,
                url: src.url
            }));
        }
        return { streams };
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });
