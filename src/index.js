import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

// --- YAPILANDIRMA AYARLARI ---
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
    id: "com.mooncrown.rectv.v23",
    version: "8.8.0",
    name: "RECTV Ultimate Fix",
    description: "Kesin Kategori Ayrımı (Dizi & Film Fix)",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv_", "tt", "CH_", "tmdb:"],
    catalogs: [
        { id: "rc_live", type: "tv", name: "RECTV Canlı TV", extra: [{ name: "search" }] },
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
    return id.split(':').shift().replace('rectv_movie_', '').replace('rectv_series_', '').replace('tmdb:', '').replace('tt', '').split('_').pop();
}

// --- 1. KATALOG İŞLEYİCİ (FIXED: Dizi-Film Karışıklığı Giderildi) ---

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        
        let url;
        if (id === "rc_live" || type === "tv") {
            url = extra?.search ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` : `${BASE_URL}/api/channel/by/filtres/6/0/0/${SW_KEY}/`;
        } else if (extra?.search) {
            url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else {
            url = `${BASE_URL}/api/${type === 'movie' ? 'movie' : 'serie'}/by/filtres/0/created/${extra?.skip || 0}/${SW_KEY}/`;
        }
        
        const res = await fetch(url, { headers: authHeaders });
        const data = await res.json();
        
        const rawItems = [];
        if (data.channels) data.channels.forEach(i => rawItems.push({ ...i, _trueType: 'tv' }));
        if (data.posters) data.posters.forEach(i => rawItems.push({ ...i, _trueType: 'movie' }));
        if (data.series) data.series.forEach(i => rawItems.push({ ...i, _trueType: 'series' }));
        
        if (rawItems.length === 0 && Array.isArray(data)) {
            data.forEach(i => {
                let t = 'movie';
                if (i.is_series === 1 || i.seasons || i.type === 'serie') t = 'series';
                if (i.category_id || i.type === 'channel') t = 'tv';
                rawItems.push({ ...i, _trueType: t });
            });
        }

        // Filtreleme: Hangi sekmedeysek sadece o _trueType gelsin
        let filteredItems = rawItems.filter(item => {
            if (type === "movie") return item._trueType === 'movie';
            if (type === "series") return item._trueType === 'series';
            if (type === "tv") return item._trueType === 'tv';
            return true;
        });

        return { 
            metas: filteredItems.map(item => {
                const t = item._trueType;
                return { 
                    id: (t === "tv") ? `CH_${item.id}` : `rectv_${t}_${item.id}`, 
                    type: t, 
                    name: item.title || item.name, 
                    poster: item.image || item.thumbnail,
                    posterShape: (t === "tv") ? "landscape" : "poster" 
                };
            }) 
        };
    } catch (e) { return { metas: [] }; }
});

// --- 2. META VERİ İŞLEYİCİ ---

builder.defineMetaHandler(async ({ type, id }) => {
    const cleanId = getCleanId(id);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
    try {
        let url;
        if (id.startsWith('CH_') || type === 'tv') {
            url = `${BASE_URL}/api/channel/by/${cleanId}/${SW_KEY}/`;
        } else if (type === 'movie') {
            url = `${BASE_URL}/api/movie/by/${cleanId}/${SW_KEY}/`;
        } else {
            url = `${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`;
        }
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (id.startsWith('CH_') || type === 'tv') {
            return { meta: { id, type: 'tv', name: data.name || data.title, poster: data.thumbnail || data.image, background: data.image || data.thumbnail, description: data.description, posterShape: "landscape" } };
        }
        if (type === 'movie') {
            return { meta: { id, type: 'movie', name: data.title || data.name, poster: data.image || data.thumbnail, background: data.backdrop || data.image, description: data.description, releaseInfo: data.year || "" } };
        }
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
        return { meta: { id, type: 'series', name: "Dizi İçeriği", videos: videos } };
    } catch (e) { return { meta: {} }; }
});

// --- 3. YAYIN İŞLEYİCİ ---

builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split(':');
    const cleanId = getCleanId(parts[0]);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
    try {
        let sources = [];
        if (id.startsWith('CH_')) {
            const res = await fetch(`${BASE_URL}/api/channel/by/${cleanId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || (data.url ? [{ url: data.url }] : []);
        } else if (!id.includes(':')) {
            const res = await fetch(`${BASE_URL}/api/movie/by/${cleanId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || [];
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const season = data.find(s => (s.title.match(/\d+/) || [])[0] == parts[1]);
            const episode = season?.episodes.find(e => (e.title.match(/\d+/) || [])[0] == parts[2]);
            sources = episode?.sources || [];
        }
        return { streams: sources.map(src => ({ name: "RECTV", title: id.startsWith('CH_') ? "CANLI" : "AHD", url: src.url, behaviorHints: { notWebReady: true, proxyHeaders: { "request": PLAYER_HEADERS } } })) };
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });
