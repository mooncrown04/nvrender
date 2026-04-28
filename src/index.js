import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

// BILGI NOTU: Port ve API sabitleri tanımlanıyor.
const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const COMMON_HEADERS = {
    'User-Agent': 'EasyPlex (Android 14; SM-A546B; Samsung Galaxy A54 5G; tr)',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const manifest = {
    id: "com.mooncrown.rectv.v3",
    version: "3.1.0",
    name: "RECTV Pro",
    description: "Sinewix Altyapılı RecTV Eklentisi - 403 Fix",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv_"],
    catalogs: [
        { id: "rc_movie", type: "movie", name: "RECTV Filmler", extra: [{ name: "search" }, { name: "skip" }] },
        { id: "rc_series", type: "series", name: "RECTV Diziler", extra: [{ name: "search" }, { name: "skip" }] }
    ]
};

const builder = new addonBuilder(manifest);

// BILGI NOTU: Auth Token alımı (Sinewix mantığı)
async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: COMMON_HEADERS });
        const json = await res.json();
        if (!json.accessToken) {
            console.error("!!! TOKEN HATASI: Ham veri beklediğimiz siteden boş döndü.");
        }
        return json.accessToken || null;
    } catch (e) {
        console.error("!!! AUTH FETCH HATASI:", e.message);
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
        
        // BILGI NOTU: Gelen ham katalog verisine bakıyoruz
        if (!data) console.error("!!! KATALOG VERISI BOS");

        const items = data.posters || data.series || (Array.isArray(data) ? data : []);

        const metas = items.map(item => ({
            id: `rectv_${type}_${item.id}`,
            type: type,
            name: item.title || item.name,
            poster: item.image || item.thumbnail
        }));

        return { metas };
    } catch (e) {
        console.error("!!! KATALOG HATASI:", e.message);
        return { metas: [] };
    }
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
                    id: id,
                    type: 'movie',
                    name: data.title,
                    poster: data.image,
                    background: data.image,
                    description: data.description
                }
            };
        } else {
            const videos = [];
            if (Array.isArray(data)) {
                data.forEach(season => {
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
            }
            return { meta: { id, type: 'series', name: "Dizi Detayı", videos } };
        }
    } catch (e) {
        console.error("!!! META HATASI:", e.message);
        return { meta: {} };
    }
});

// STREAM HANDLER (403 Çözümü Dahil)
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split(':');
    const fullPrefixId = parts[0]; 
    const internalId = fullPrefixId.split('_').pop();
    const type = id.includes('_movie_') ? 'movie' : 'series';
    const sNum = parts[1];
    const eNum = parts[2];

    try {
        const token = await getAuthToken();
        const headers = { ...COMMON_HEADERS, 'Authorization': `Bearer ${token}` };
        
        let sources = [];
        if (type === 'movie') {
            const res = await fetch(`${BASE_URL}/api/movie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || [];
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const season = data.find(s => parseInt(s.title.match(/\d+/)) == sNum);
            const episode = season?.episodes.find(e => parseInt(e.title.match(/\d+/)) == eNum);
            sources = episode?.sources || [];
        }

        const streams = sources.map((src, i) => ({
            name: "RECTV",
            title: `Kaynak ${i + 1}\n${src.quality || ''}`,
            url: src.url,
            behaviorHints: {
                notWebReady: true,
                proxyHeaders: {
                    "request": {
                        "User-Agent": "EasyPlex (Android 14; SM-A546B; Samsung Galaxy A54 5G; tr)",
                        "Referer": "https://twitter.com/",
                        "Origin": "https://twitter.com"
                    }
                }
            }
        }));

        return { streams };
    } catch (e) {
        console.error("!!! STREAM HATASI (403):", e.message);
        return { streams: [] };
    }
});

// BILGI NOTU: Server başlatılıyor.
serveHTTP(builder.getInterface(), { port: PORT });
