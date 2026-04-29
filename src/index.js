import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

// 🔥 KRİTİK HEADER (eksik olursa API boş döner)
const HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'application/json'
};

// ---------------- MANIFEST ----------------
const manifest = {
    id: "com.rectv.pro.v1",
    version: "1.0.0",
    name: "RECTV PRO",
    description: "Live TV + Movies + Series",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],

    // 🔥 TV EKLENDİ
    idPrefixes: ["CH_", "rectv_", "tt"],

    catalogs: [
        {
            id: "rectv_live",
            type: "tv",
            name: "📺 Canlı TV"
        },
        {
            id: "rectv_movies",
            type: "movie",
            name: "🎬 Filmler"
        },
        {
            id: "rectv_series",
            type: "series",
            name: "🍿 Diziler"
        }
    ]
};

const builder = new addonBuilder(manifest);

// ---------------- CATALOG ----------------
builder.defineCatalogHandler(async ({ id, type, extra }) => {
    try {

        // 📺 LIVE TV
        if (id === "rectv_live") {
            const res = await fetch(`${BASE_URL}/api/channel/by/filtres/1/0/0/${SW_KEY}/`, { headers: HEADERS });
            const data = await res.json();

            return {
                metas: (data || []).map(ch => ({
                    id: `CH_${ch.id}`,
                    type: "tv",
                    name: ch.title || ch.name,
                    poster: ch.image,
                    posterShape: "landscape"
                }))
            };
        }

        // 🎬 MOVIES / SERIES
        const path = type === "series" ? "serie" : "movie";

        const url = extra?.search
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${path}/by/filtres/0/created/0/${SW_KEY}/`;

        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json();

        const items = data?.posters || data?.series || data || [];

        return {
            metas: (items || []).slice(0, 30).map(item => ({
                id: `rectv_${type}_${item.id}`,
                type,
                name: item.title || item.name,
                poster: item.image || item.thumbnail
            }))
        };

    } catch (e) {
        return { metas: [] };
    }
});

// ---------------- META ----------------
builder.defineMetaHandler(async ({ id, type }) => {
    return {
        meta: {
            id,
            type,
            name: "RECTV Content",
            description: "Loaded"
        }
    };
});

// ---------------- STREAM ----------------
builder.defineStreamHandler(async ({ id }) => {

    try {

        if (id.startsWith("CH_")) {
            const res = await fetch(`${BASE_URL}/api/channel/${id.replace("CH_", "")}/${SW_KEY}/`, { headers: HEADERS });
            const data = await res.json();

            return {
                streams: (data.sources || []).map(s => ({
                    name: "RECTV",
                    url: s.url
                }))
            };
        }

        const pure = id.replace("rectv_movie_", "").replace("rectv_series_", "");

        const res = await fetch(`${BASE_URL}/api/movie/${pure}/${SW_KEY}/`, { headers: HEADERS });
        const data = await res.json();

        return {
            streams: (data.sources || []).map(s => ({
                name: "RECTV",
                url: s.url
            }))
        };

    } catch (e) {
        return { streams: [] };
    }
});

// ---------------- SERVER ----------------
serveHTTP(builder.getInterface(), { port: PORT });
