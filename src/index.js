import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

// BILGI NOTU: Kazıyıcıda çalışan User-Agent ve Referer ayarları
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

// BILGI NOTU: Oynatıcı için (ExoPlayer) çalışan özel headerlar
const PLAYER_HEADERS = {
    'User-Agent': 'googleusercontent',
    'Referer': 'https://twitter.com/',
    'Accept-Encoding': 'identity'
};

const manifest = {
    id: "com.mooncrown.rectv.v18",
    version: "3.2.0",
    name: "RECTV Final Fix",
    description: "RecTV_v18_Final_Fix mantığıyla güncellendi",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["rectv_"],
    catalogs: [
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
    } catch (e) { 
        console.error("!!! TOKEN HATASI:", e.message);
        return null; 
    }
}

// BILGI NOTU: Kazıyıcıdaki dil ve kaynak analizi
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

// CATALOG & META kısımları aynı mantıkla devam eder (Kısaltıldı, stream odaklıyız)
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const searchHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let url = extra?.search 
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${type === 'movie' ? 'movie' : 'serie'}/by/filtres/0/created/${extra?.skip || 0}/${SW_KEY}/`;
        
        const res = await fetch(url, { headers: searchHeaders });
        const data = await res.json();
        const items = data.posters || data.series || (Array.isArray(data) ? data : []);
        return { metas: items.map(item => ({ id: `rectv_${type}_${item.id}`, type, name: item.title || item.name, poster: item.image || item.thumbnail })) };
    } catch (e) { return { metas: [] }; }
});

builder.defineMetaHandler(async ({ type, id }) => {
    const internalId = id.split('_').pop();
    try {
        const token = await getAuthToken();
        const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        const url = type === 'movie' ? `${BASE_URL}/api/movie/${internalId}/${SW_KEY}/` : `${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`;
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (type === 'movie') {
            return { meta: { id, type, name: data.title, poster: data.image, background: data.image, description: data.description } };
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

// STREAM HANDLER - KAZIYICIDAKI 403 FIX MANTIGI ILE
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split(':');
    const internalId = parts[0].split('_').pop();
    const type = id.includes('_movie_') ? 'movie' : 'series';
    
    try {
        const token = await getAuthToken();
        const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let sources = [];

        if (type === 'movie') {
            const res = await fetch(`${BASE_URL}/api/movie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || [];
        } else {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${internalId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const season = data.find(s => parseInt(s.title.match(/\d+/)) == parts[1]);
            const episode = season?.episodes.find(e => parseInt(e.title.match(/\d+/)) == parts[2]);
            sources = episode?.sources || [];
        }

        return {
            streams: sources.map((src, idx) => {
                const info = analyzeStream(src.url, idx, "");
                return {
                    name: `RECTV ${info.icon}`,
                    title: `${info.text} - Kaynak ${idx + 1}`,
                    url: src.url,
                    // BILGI NOTU: Kazıyıcıda çalışan headerlar behaviorHints'e eklendi
                    behaviorHints: {
                        notWebReady: true,
                        proxyHeaders: {
                            "request": PLAYER_HEADERS
                        }
                    }
                };
            })
        };
    } catch (e) {
        console.error("!!! STREAM ERROR:", e.message);
        return { streams: [] };
    }
});

serveHTTP(builder.getInterface(), { port: PORT });
