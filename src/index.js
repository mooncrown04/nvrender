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
    id: "com.mooncrown.rectv.v18.final.fixed",
    version: "4.2.0",
    name: "RECTV Pro Ultimate",
    description: "Film Detay ve Canlı TV Katalogları Düzeltildi",
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
        try {
            const json = JSON.parse(text);
            return json.accessToken || text.trim();
        } catch (e) { return text.trim(); }
    } catch (e) { return null; }
}

// CATALOG HANDLER - Canlı TV ve Film/Dizi katalogları düzeltildi
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
            // Canlı TV kategorilerini tek bir listede birleştiriyoruz
            if (Array.isArray(data)) {
                data.forEach(category => {
                    if (category.channels && Array.isArray(category.channels)) {
                        category.channels.forEach(channel => {
                            metas.push({
                                id: `rectv_tv_${channel.id}`,
                                type: 'tv',
                                name: channel.title || channel.name,
                                poster: channel.image || channel.thumbnail
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
    } catch (e) { 
        console.error("Catalog Error:", e);
        return { metas: [] }; 
    }
});

// META HANDLER - Film meta detay sorunu çözüldü
builder.defineMetaHandler(async ({ type, id }) => {
    const idParts = id.split('_');
    const internalId = idParts[idParts.length - 1];

    if (type === 'tv') {
        return { 
            meta: { 
                id, 
                type, 
                name: "Canlı Yayın", 
                poster: "https://i.ibb.co/rt6L58P/tv.png",
                background: "https://i.ibb.co/rt6L58P/tv.png"
            } 
        };
    }

    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        
        if (type === 'movie') {
            const res = await fetch(`${BASE_URL}/api/movie/${internalId}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            return {
                meta: {
                    id: id,
                    type: 'movie',
                    name: data.title || "Film Detayı",
                    poster: data.image,
                    background: data.image,
                    description: data.description || ""
                }
            };
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            const videos = [];
            if (Array.isArray(data)) {
                data.forEach(s => {
                    const sNum = parseInt(s.title.match(/\d+/) || 1);
                    if (s.episodes) {
                        s.episodes.forEach(ep => {
                            const eNum = parseInt(ep.title.match(/\d+/) || 1);
                            videos.push({
                                id: `${id}:${sNum}:${eNum}`,
                                title: ep.title,
                                season: sNum,
                                episode: eNum,
                                released: new Date().toISOString()
                            });
                        });
                    }
                });
            }
            return { meta: { id, type: 'series', name: "Dizi Detayı", videos } };
        }
    } catch (e) { return { meta: {} }; }
});

// STREAM HANDLER
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split(':');
    const metaId = parts[0]; 
    const idParts = metaId.split('_');
    const typePart = idParts[1]; 
    const internalId = idParts[idParts.length - 1];
    
    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let sources = [];

        if (typePart === 'movie') {
            const res = await fetch(`${BASE_URL}/api/movie/${internalId}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            sources = data.sources || [];
        } else if (typePart === 'series') {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            const season = data.find(s => parseInt(s.title.match(/\d+/)) == parts[1]);
            const episode = season?.episodes.find(e => parseInt(e.title.match(/\d+/)) == parts[2]);
            sources = episode?.sources || [];
        } else if (typePart === 'tv') {
            const res = await fetch(`${BASE_URL}/api/channel/${internalId}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            sources = data.sources || [];
        }

        return {
            streams: sources.map((src, idx) => ({
                name: `RECTV ${typePart === 'tv' ? '📺' : '🎥'}`,
                title: `${src.quality || 'HD'} - Kaynak ${idx + 1}`,
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
