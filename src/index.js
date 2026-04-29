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
    id: "com.mooncrown.rectv.final",
    version: "4.0.0",
    name: "RECTV Ultimate",
    description: "Canlı TV, Film ve Dizi - Poster & Scraper Fix",
    resources: ["catalog", "meta", "stream"],
    // TV ve Channel tipleri eklendi
    types: ["movie", "series", "tv", "channel"],
    idPrefixes: ["rectv_"],
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
        let token;
        try {
            const json = JSON.parse(text);
            token = json.accessToken || text.trim();
        } catch (e) { token = text.trim(); }
        return token;
    } catch (e) { return null; }
}

// CATALOG HANDLER
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const searchHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        
        let url;
        if (type === 'tv' || type === 'channel') {
            url = `${BASE_URL}/api/channel/by/category/1/${SW_KEY}/`; // Örnek Canlı TV API yolu
        } else {
            url = extra?.search 
                ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
                : `${BASE_URL}/api/${type === 'movie' ? 'movie' : 'serie'}/by/filtres/0/created/${extra?.skip || 0}/${SW_KEY}/`;
        }
        
        const res = await fetch(url, { headers: searchHeaders });
        const data = await res.json();
        
        // API'den gelen farklı anahtar isimlerini (posters, series, channels) standardize et
        const items = data.posters || data.series || data || [];
        
        return { 
            metas: items.map(item => ({ 
                id: `rectv_${type}_${item.id}`, 
                type, 
                name: item.title || item.name, 
                poster: item.image || item.thumbnail 
            })) 
        };
    } catch (e) { return { metas: [] }; }
});

// META HANDLER (Poster ve Detay Sorunu Burada Çözüldü)
builder.defineMetaHandler(async ({ type, id }) => {
    const internalId = id.split('_').pop();
    try {
        const token = await getAuthToken();
        const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        
        // Canlı TV kanalı ise farklı API'ye git
        const url = (type === 'tv' || type === 'channel') 
            ? `${BASE_URL}/api/channel/${internalId}/${SW_KEY}/`
            : (type === 'movie' ? `${BASE_URL}/api/movie/${internalId}/${SW_KEY}/` : `${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`);

        const res = await fetch(url, { headers });
        const data = await res.json();

        if (type === 'movie' || type === 'tv' || type === 'channel') {
            return { 
                meta: { 
                    id, 
                    type, 
                    name: data.title || data.name, 
                    poster: data.image || data.thumbnail, 
                    background: data.image || data.thumbnail, 
                    description: data.description || "RECTV Canlı Yayın" 
                } 
            };
        } else {
            const videos = [];
            data.forEach(s => {
                const sNum = parseInt(s.title.match(/\d+/) || 1);
                s.episodes.forEach(ep => {
                    const eNum = parseInt(ep.title.match(/\d+/) || 1);
                    videos.push({ id: `${id}:${sNum}:${eNum}`, title: ep.title, season: sNum, episode: eNum });
                });
            });
            return { meta: { id, type, name: "Dizi Detayı", videos } };
        }
    } catch (e) { return { meta: {} }; }
});

// STREAM HANDLER (Kazıyıcı Bağlantısı ve Canlı TV Desteği)
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split(':');
    const idParts = parts[0].split('_');
    const internalId = idParts.pop();
    const type = idParts.includes('movie') ? 'movie' : (idParts.includes('tv') || idParts.includes('channel') ? 'tv' : 'series');
    
    try {
        const token = await getAuthToken();
        const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let sources = [];

        if (type === 'movie') {
            const res = await fetch(`${BASE_URL}/api/movie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || [];
        } else if (type === 'tv') {
            const res = await fetch(`${BASE_URL}/api/channel/${internalId}/${SW_KEY}//`, { headers });
            const data = await res.json();
            // Canlı TV'de kaynaklar direkt "sources" içinde gelmeyebilir, URL'yi kontrol et
            sources = data.sources || (data.url ? [{ url: data.url }] : []);
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const season = data.find(s => parseInt(s.title.match(/\d+/)) == parts[1]);
            const episode = season?.episodes.find(e => parseInt(e.title.match(/\d+/)) == parts[2]);
            sources = episode?.sources || [];
        }

        return {
            streams: sources.map((src, idx) => ({
                name: `RECTV ${type === 'tv' ? 'LIVE' : 'SOURCE'}`,
                title: `Kaynak ${idx + 1}`,
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
