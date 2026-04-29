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
    id: "com.mooncrown.rectv.v18.ultimate",
    version: "4.5.0",
    name: "RECTV Pro",
    description: "Canlı TV ve Film Detay Fix",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv_"],
    catalogs: [
        { id: "rc_movie", type: "movie", name: "RECTV Filmler", extra: [{ name: "search" }, { name: "skip" }] },
        { id: "rc_series", type: "series", name: "RECTV Diziler", extra: [{ name: "search" }, { name: "skip" }] },
        { id: "rc_tv", type: "tv", name: "RECTV Canlı TV" }
    ]
};

const builder = new addonBuilder(manifest);

async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const text = await res.text();
        const json = JSON.parse(text);
        return json.accessToken || text.trim();
    } catch (e) { return null; }
}

// CATALOG HANDLER - Canlı TV kategorilerini kanallara döküyoruz
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let url;

        if (type === 'tv') {
            url = `${BASE_URL}/api/category/all/channel/${SW_KEY}/`;
        } else if (extra?.search) {
            url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else {
            const path = type === 'movie' ? 'movie' : 'serie';
            url = `${BASE_URL}/api/${path}/by/filtres/0/created/${extra?.skip || 0}/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers: authHeaders });
        const data = await res.json();
        let metas = [];

        if (type === 'tv') {
            // RecTV'de kanallar kategoriler içinde dizi (array) olarak gelir
            if (Array.isArray(data)) {
                data.forEach(cat => {
                    if (cat.channels) {
                        cat.channels.forEach(ch => {
                            metas.push({
                                id: `rectv_tv_${ch.id}`,
                                type: 'tv',
                                name: ch.title || ch.name,
                                poster: ch.image || ch.thumbnail
                            });
                        });
                    }
                });
            }
        } else {
            const items = data.posters || data.series || (Array.isArray(data) ? data : []);
            metas = items.map(item => ({
                id: `rectv_${type}_${item.id}`,
                type: type,
                name: item.title || item.name,
                poster: item.image || item.thumbnail
            }));
        }
        return { metas };
    } catch (e) { return { metas: [] }; }
});

// META HANDLER - Film detay sayfasının gelmeme sorunu burada çözüldü
builder.defineMetaHandler(async ({ type, id }) => {
    const internalId = id.split('_').pop();
    
    if (type === 'tv') {
        return { meta: { id, type, name: "Canlı Yayın", poster: "https://i.ibb.co/rt6L58P/tv.png" } };
    }

    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        const url = type === 'movie' 
            ? `${BASE_URL}/api/movie/${internalId}/${SW_KEY}/` 
            : `${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`;

        const res = await fetch(url, { headers: authHeaders });
        const data = await res.json();

        if (type === 'movie') {
            return {
                meta: {
                    id: id,
                    type: 'movie',
                    name: data.title,
                    poster: data.image,
                    background: data.image,
                    description: data.description,
                    // ÖNEMLİ: Filmde de bir video nesnesi olması Stremio'nun 'Oynat' tetiklemesini sağlar
                    videos: [{ id: id, title: data.title }] 
                }
            };
        } else {
            const videos = [];
            data.forEach(s => {
                const sNum = parseInt(s.title.match(/\d+/) || 1);
                s.episodes.forEach(ep => {
                    const eNum = parseInt(ep.title.match(/\d+/) || 1);
                    videos.push({
                        id: `${id}:${sNum}:${eNum}`,
                        title: ep.title,
                        season: sNum,
                        episode: eNum
                    });
                });
            });
            return { meta: { id, type: 'series', name: data[0]?.title || "Dizi", videos } };
        }
    } catch (e) { return { meta: {} }; }
});

// STREAM HANDLER
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split(':');
    const idParts = parts[0].split('_');
    const typePart = idParts[1];
    const internalId = idParts[2];
    
    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let sources = [];

        if (typePart === 'movie' || typePart === 'tv') {
            const endpoint = typePart === 'movie' ? `movie/${internalId}` : `channel/${internalId}`;
            const res = await fetch(`${BASE_URL}/api/${endpoint}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            sources = data.sources || [];
        } else if (typePart === 'series') {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            const season = data.find(s => parseInt(s.title.match(/\d+/)) == parts[1]);
            const episode = season?.episodes.find(e => parseInt(e.title.match(/\d+/)) == parts[2]);
            sources = episode?.sources || [];
        }

        return {
            streams: sources.map((src, idx) => ({
                name: `RECTV ${typePart === 'tv' ? '📺' : '🎥'}`,
                title: `${src.quality || 'Auto'} - Kaynak ${idx + 1}`,
                url: src.url,
                behaviorHints: {
                    notWebReady: true,
                    proxyHeaders: { "request": PLAYER_HEADERS }
                }
            }))
        };
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });
