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
    id: "com.mooncrown.rectv.v18.final",
    version: "4.0.0",
    name: "RECTV Ultimate",
    description: "Film, Dizi ve Canlı TV - 403 Fix",
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

function analyzeStream(url, index, itemLabel) {
    const lowUrl = url.toLowerCase();
    const lowLabel = (itemLabel || "").toLowerCase();
    let info = { icon: "🌐", text: "Altyazı" };
    const isTurkish = lowLabel.includes("dublaj") || lowLabel.includes("yerli") || lowLabel.includes("tr dub") || lowLabel.includes("türkçe") || lowUrl.includes("dublaj") || lowUrl.includes("/tr/");
    if (isTurkish) {
        if (lowLabel.includes("altyazı") && index === 1) {
            info.icon = "🌐"; info.text = "Altyazı";
        } else {
            info.icon = "🇹🇷"; info.text = "Dublaj";
        }
    }
    return info;
}

// CATALOG HANDLER
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
        
        let items = [];
        if (type === 'tv') {
            // TV kanalları genellikle kategoriler altında gelir
            data.forEach(cat => { if(cat.channels) items = items.concat(cat.channels); });
        } else {
            items = data.posters || data.series || (Array.isArray(data) ? data : []);
        }

        return {
            metas: items.map(item => ({
                id: `rectv_${type}_${item.id}`,
                type: type,
                name: item.title || item.name,
                poster: item.image || item.thumbnail
            }))
        };
    } catch (e) { return { metas: [] }; }
});

// META HANDLER
builder.defineMetaHandler(async ({ type, id }) => {
    if (type === 'tv') return { meta: { id, type, name: "Canlı TV" } };

    const internalId = id.split('_').pop();
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
                    description: data.description
                }
            };
        } else {
            const videos = [];
            data.forEach(s => {
                const sMatch = s.title.match(/\d+/);
                const sNum = sMatch ? parseInt(sMatch[0]) : 1;
                s.episodes.forEach(ep => {
                    const eMatch = ep.title.match(/\d+/);
                    const eNum = eMatch ? parseInt(eMatch[0]) : 1;
                    videos.push({
                        id: `${id}:${sNum}:${eNum}`,
                        title: ep.title,
                        season: sNum,
                        episode: eNum,
                        released: new Date().toISOString()
                    });
                });
            });
            return { meta: { id, type: 'series', name: "Dizi Detayı", videos } };
        }
    } catch (e) { return { meta: {} }; }
});

// STREAM HANDLER
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split(':');
    const typePart = parts[0].split('_')[1];
    const internalId = parts[0].split('_').pop();
    
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
            const season = data.find(s => (s.title.match(/\d+/) || [])[0] == parts[1]);
            const episode = season?.episodes.find(e => (e.title.match(/\d+/) || [])[0] == parts[2]);
            sources = episode?.sources || [];
        } else if (typePart === 'tv') {
            const res = await fetch(`${BASE_URL}/api/channel/${internalId}/${SW_KEY}/`, { headers: authHeaders });
            const data = await res.json();
            sources = data.sources || [];
        }

        return {
            streams: sources.map((src, idx) => ({
                name: `RECTV ${typePart === 'tv' ? '📺' : analyzeStream(src.url, idx, "").icon}`,
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
