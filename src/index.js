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

const manifest = {
    id: "com.mooncrown.rectv.v23",
    version: "8.8.0",
    name: "RECTV Ultimate Fix",
    description: "Dizi ve Film Arşivi",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv_", "CH_"],
    catalogs: [
        { id: "rc_live", type: "tv", name: "RECTV TV", extra: [{ name: "search" }, { name: "genre", options: ["Spor", "Belgesel", "Ulusal", "Haber", "Sinema"] }] },
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

// --- 1. KATALOG (ANA EKRAN) İŞLEYİCİ ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let url;
        
        if (extra?.search) {
            url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else {
            let rectvType = (type === 'series') ? 'serie' : (type === 'movie' ? 'movie' : 'channel');
            url = `${BASE_URL}/api/${rectvType}/by/filtres/0/created/${extra?.skip || 0}/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers: authHeaders });
        const data = await res.json();
        const raw = data.channels || data.posters || data.series || (Array.isArray(data) ? data : []);

        return { 
            metas: raw.map(item => ({
                id: (type === 'tv' || item.type === 'channel') ? `CH_${item.id}` : `rectv_${type}_${item.id}`,
                type: type,
                name: item.title,
                poster: item.image,
                background: item.cover || item.image,
                // KATALOGDA GÖRÜNEN AÇIKLAMA BURASI:
                description: item.description || item.resume || "", 
                releaseInfo: item.year ? item.year.toString() : (item.label || "")
            })) 
        };
    } catch (e) { return { metas: [] }; }
});

// --- 2. META (DETAY SAYFASI) ---
builder.defineMetaHandler(async ({ type, id }) => {
    const cleanId = id.split('_').pop();
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let detailUrl = type === 'movie' ? `${BASE_URL}/api/movie/by/${cleanId}/${SW_KEY}/` : `${BASE_URL}/api/serie/by/${cleanId}/${SW_KEY}/`;
        if (id.startsWith('CH_')) detailUrl = `${BASE_URL}/api/channel/by/${cleanId}/${SW_KEY}/`;

        const res = await fetch(detailUrl, { headers });
        const data = await res.json();

        const meta = {
            id: id,
            type: type,
            name: data.title,
            poster: data.image,
            background: data.cover || data.image,
            description: data.description || data.resume || "",
            releaseInfo: data.year?.toString()
        };

        if (type === 'series') {
            const sRes = await fetch(`${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`, { headers });
            const seasons = await sRes.json();
            meta.videos = [];
            if (Array.isArray(seasons)) {
                seasons.forEach(s => {
                    const sNum = parseInt((s.title?.match(/\d+/) || [1])[0]);
                    if (s.episodes) {
                        s.episodes.forEach(ep => {
                            meta.videos.push({
                                id: `${id}:${sNum}:${parseInt((ep.title?.match(/\d+/) || [1])[0])}`,
                                title: ep.title,
                                season: sNum,
                                episode: parseInt((ep.title?.match(/\d+/) || [1])[0]),
                                description: ep.description || meta.description
                            });
                        });
                    }
                });
            }
        }
        return { meta };
    } catch (e) { return { meta: {} }; }
});

// --- 3. STREAM ---
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split(':');
    const cleanId = parts[0].split('_').pop();
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let sources = [];
        if (id.startsWith('CH_')) {
            const d = await (await fetch(`${BASE_URL}/api/channel/by/${cleanId}/${SW_KEY}/`, { headers })).json();
            sources = d.sources || [{ url: d.url }];
        } else if (parts.length === 1) {
            const d = await (await fetch(`${BASE_URL}/api/movie/by/${cleanId}/${SW_KEY}/`, { headers })).json();
            sources = d.sources || [];
        } else {
            const d = await (await fetch(`${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`, { headers })).json();
            const s = d.find(x => (x.title?.match(/\d+/) || [])[0] == parts[1]);
            const e = s?.episodes.find(x => (x.title?.match(/\d+/) || [])[0] == parts[2]);
            sources = e?.sources || [];
        }
        return {
            streams: sources.map(src => ({
                name: "RECTV",
                title: src.title || "HD",
                url: src.url,
                behaviorHints: { notWebReady: true, proxyHeaders: { "request": { "User-Agent": "googleusercontent", "Referer": "https://twitter.com/" } } }
            }))
        };
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });const manifest = {
    id: "com.mooncrown.rectv.v23",
    version: "8.5.2",
    name: "RECTV Ultimate Fix",
    description: "dizi-film55",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv_", "tt", "CH_", "tmdb:"],
    catalogs: [
        { id: "rc_live", type: "tv", name: "RECTV Canlı TV", extra: [{ name: "search" }, { name: "genre", options: Object.keys(TV_MAP) }] },
        { id: "rc_movie", type: "movie", name: "RECTV Filmler", extra: [{ name: "search" }, { name: "skip" }, { name: "genre", options: Object.keys(MOVIE_MAP) }] },
        { id: "rc_series", type: "series", name: "RECTV Diziler", extra: [{ name: "search" }, { name: "skip" }, { name: "genre", options: Object.keys(SERIES_MAP) }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR ---
async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const json = await res.json();
        return json.accessToken || (await res.text()).trim();
    } catch (e) { return null; }
}

function getCleanId(id) {
    if (!id) return "";
    return id.split(':').shift()
             .replace('rectv_movie_', '')
             .replace('rectv_series_', '')
             .replace('tmdb:', '')
             .replace('tt', '')
             .split('_').pop();
}

// --- 1. KATALOG İŞLEYİCİ ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let url;
        
        if (id === "rc_live" || type === "tv") {
            if (extra?.search) url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            else if (extra?.genre) url = `${BASE_URL}/api/channel/by/filtres/${TV_MAP[extra.genre] || "6"}/0/0/${SW_KEY}/`;
            else url = `${BASE_URL}/api/channel/by/filtres/6/0/0/${SW_KEY}/`;
        } else if (extra?.search) {
            url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else {
            let rectvType = (type === 'series') ? 'serie' : 'movie';
            let genreId = type === 'movie' ? (MOVIE_MAP[extra?.genre] || "0") : (SERIES_MAP[extra?.genre] || "0");
            url = `${BASE_URL}/api/${rectvType}/by/filtres/${genreId}/created/${extra?.skip || 0}/${SW_KEY}/`;
        }
        
        const res = await fetch(url, { headers: authHeaders });
        const data = await res.json();
        const items = [];
        if (data.channels) data.channels.forEach(i => items.push({ ...i, _origin: 'tv' }));
        if (data.posters) data.posters.forEach(i => items.push({ ...i, _origin: 'movie' }));
        if (data.series) data.series.forEach(i => items.push({ ...i, _origin: 'series' }));
        if (items.length === 0 && Array.isArray(data)) data.forEach(i => items.push({ ...i, _origin: type }));

        return { 
            metas: items.map(item => ({
                id: (item.type === "channel" || item._origin === 'tv') ? `CH_${item.id}` : `rectv_${type}_${item.id}`,
                type: (item.type === "channel" || item._origin === 'tv') ? "tv" : type,
                name: item.title,
                poster: item.image,
                background: item.image,
                posterShape: (item.type === "channel" || item._origin === 'tv') ? "landscape" : "poster"
            })) 
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
        if (id.startsWith('CH_')) url = `${BASE_URL}/api/channel/by/${cleanId}/${SW_KEY}/`;
        else if (type === 'movie') url = `${BASE_URL}/api/movie/by/${cleanId}/${SW_KEY}/`;
        else url = `${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`;

        const res = await fetch(url, { headers });
        const data = await res.json();

        if (id.startsWith('CH_') || type === 'tv') {
            return { meta: { id, type: 'tv', name: data.title, poster: data.image, description: data.description || "Canlı Yayın", posterShape: "landscape" } };
        }

        if (type === 'movie') {
            return { meta: { id, type: 'movie', name: data.title, poster: data.image, description: data.description || "Film özeti bulunamadı.", releaseInfo: data.year?.toString() } };
        }

        // --- DİZİ (SERIES) DÜZELTİLMİŞ KISIM ---
        const videos = [];
        const isDataArray = Array.isArray(data);
        const mainData = isDataArray ? data[0] : data;

        // Sezon içinde description yoksa, RECTV API'sinde genellikle 'serie_description' anahtarında bulunur.
        const seriesDesc = mainData?.serie_description || mainData?.description || mainData?.resume || "Dizi açıklaması bulunmamaktadır.";
        const seriesTitle = mainData?.serie_title || mainData?.title || "Dizi";

        if (isDataArray) {
            data.forEach(s => {
                const sNum = parseInt((s.title?.match(/\d+/) || [1])[0]);
                if (s.episodes && Array.isArray(s.episodes)) {
                    s.episodes.forEach(ep => {
                        const eNum = parseInt((ep.title?.match(/\d+/) || [1])[0]);
                        videos.push({
                            id: `${id}:${sNum}:${eNum}`,
                            title: ep.title || `${eNum}. Bölüm`,
                            // Bölüm özeti yoksa ana dizi özetini basıyoruz
                            description: ep.description || seriesDesc,
                            season: sNum,
                            episode: eNum,
                            poster: ep.image || mainData?.image,
                            released: new Date().toISOString()
                        });
                    });
                }
            });
        }

        return {
            meta: {
                id: id,
                type: 'series',
                name: seriesTitle,
                poster: mainData?.image || "",
                background: mainData?.cover || mainData?.image || "",
                logo: mainData?.image || "",
                videos: videos,
                description: seriesDesc,
                releaseInfo: mainData?.year?.toString() || "",
                genres: (mainData?.genres || []).map(g => g.title || g)
            }
        };
    } catch (e) { return { meta: {} }; }
});

// --- 3. YAYIN İŞLEYİCİ ---
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split(':');
    const cleanId = getCleanId(parts[0]);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let sources = [], contentTitle = "Yayın";
        if (id.startsWith('CH_')) {
            const data = await (await fetch(`${BASE_URL}/api/channel/by/${cleanId}/${SW_KEY}/`, { headers })).json();
            contentTitle = data.title;
            sources = data.sources || (data.url ? [{ url: data.url }] : []);
        } else if (!id.includes(':')) {
            const data = await (await fetch(`${BASE_URL}/api/movie/by/${cleanId}/${SW_KEY}/`, { headers })).json();
            contentTitle = data.title;
            sources = data.sources || [];
        } else {
            const data = await (await fetch(`${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`, { headers })).json();
            const season = data.find(s => (s.title?.match(/\d+/) || [])[0] == parts[1]);
            const episode = season?.episodes.find(e => (e.title?.match(/\d+/) || [])[0] == parts[2]);
            contentTitle = episode?.title;
            sources = episode?.sources || [];
        }

        return {
            streams: sources.map(src => ({
                name: contentTitle,
                title: `RECTV | ${src.size || "HD"} | ${(src.title || "").toLowerCase().includes("dublaj") ? "🇹🇷" : "🌐"} ${src.title || ""}`,
                url: src.url,
                behaviorHints: { notWebReady: true, proxyHeaders: { "request": PLAYER_HEADERS } }
            }))
        };
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });
