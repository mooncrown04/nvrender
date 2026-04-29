import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;
import fetch from "node-fetch";

/* =========================
   CONFIG
========================= */
const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "68e094699525b18a70bab2f86b1fa706";

/* =========================
   🔥 GLOBAL CACHE (EN ÖNEMLİ PARÇA)
========================= */
const CACHE = new Map();

/* =========================
   HEADERS
========================= */
const HEADERS = {
    "User-Agent": "okhttp/4.12.0",
    "Accept": "application/json"
};

/* =========================
   MANIFEST (HATASIZ)
========================= */
const manifest = {
    id: "com.rectv.pro.ultra",
    version: "6.0.0",
    name: "RECTV PRO ULTRA",
    description: "Unified Catalog + Scraper System",
    types: ["movie", "series", "tv"],
    resources: ["catalog", "meta", "stream"],
    idPrefixes: ["tt", "CH_"],

    catalogs: [
        {
            id: "live",
            type: "tv",
            name: "📺 Canlı TV",
            extra: [{ name: "search" }]
        },
        {
            id: "movies",
            type: "movie",
            name: "🎬 Filmler",
            extra: [{ name: "search" }]
        },
        {
            id: "series",
            type: "series",
            name: "🍿 Diziler",
            extra: [{ name: "search" }]
        }
    ]
};

const builder = new addonBuilder(manifest);

/* =========================
   TMDB → TITLE
========================= */
async function getTitleFromImdb(imdb, type) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdb}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();

        if (type === "movie") return data.movie_results?.[0]?.title;
        if (type === "series") return data.tv_results?.[0]?.name;
    } catch (e) {}
    return null;
}

/* =========================
   CATALOG
========================= */
builder.defineCatalogHandler(async ({ id, type, extra }) => {

    const search = extra?.search || "";

    /* -------- LIVE TV -------- */
    if (id === "live") {
        const res = await fetch(`${BASE_URL}/api/search/${search}/${SW_KEY}/`);
        const data = await res.json();

        return {
            metas: (data.channels || []).map(ch => {
                const cid = "CH_" + ch.title.replace(/\s/g, "_");

                CACHE.set(cid, ch.title); // 🔥 CACHE

                return {
                    id: cid,
                    type: "tv",
                    name: ch.title
                };
            })
        };
    }

    /* -------- MOVIE / SERIES -------- */
    const res = await fetch(`${BASE_URL}/api/search/${search}/${SW_KEY}/`);
    const data = await res.json();

    const list = data.series || data.posters || [];

    const metas = list.slice(0, 20).map(item => {
        const imdb = "tt" + String(item.id).padStart(7, "0");

        CACHE.set(imdb, item.title); // 🔥 CACHE BRIDGE

        return {
            id: type === "series" ? `${imdb}:1:1` : imdb,
            type,
            name: item.title
        };
    });

    return { metas };
});

/* =========================
   META
========================= */
builder.defineMetaHandler(async ({ id, type }) => {

    if (id.startsWith("CH_")) {
        const name = CACHE.get(id) || id.replace("CH_", "").replace(/_/g, " ");
        return {
            meta: {
                id,
                type: "tv",
                name
            }
        };
    }

    return {
        meta: {
            id,
            type,
            name: CACHE.get(id.split(":")[0]) || id
        }
    };
});

/* =========================
   STREAM (ASIL SİSTEM)
   ❌ SEARCH YOK
   ✔ SADECE CACHE + 1 API
========================= */
builder.defineStreamHandler(async ({ id, type }) => {

    /* -------- LIVE TV -------- */
    if (id.startsWith("CH_")) {

        const name = CACHE.get(id);

        const res = await fetch(`${BASE_URL}/api/search/${name}/${SW_KEY}/`);
        const data = await res.json();

        const ch = (data.channels || []).find(c =>
            c.title.replace(/\s/g, "_") === id.replace("CH_", "")
        );

        if (!ch) return { streams: [] };

        const r = await fetch(`${BASE_URL}/api/channel/${ch.id}/${SW_KEY}/`);
        const d = await r.json();

        return {
            streams: (d.sources || []).map(s => ({
                name: "RECTV",
                url: s.url
            }))
        };
    }

    /* -------- MOVIE / SERIES -------- */
    const imdb = id.split(":")[0];

    const title = CACHE.get(imdb) || await getTitleFromImdb(imdb, type);

    if (!title) return { streams: [] };

    const res = await fetch(`${BASE_URL}/api/search/${title}/${SW_KEY}/`);
    const data = await res.json();

    const pool = data.series || data.posters || [];

    let streams = [];

    for (let item of pool) {

        if (type === "series") {

            const s = await fetch(`${BASE_URL}/api/serie/${item.id}/${SW_KEY}/`);
            const d = await s.json();

            (d.seasons || []).forEach(season => {
                season.episodes?.forEach(ep => {
                    ep.sources?.forEach(src => {
                        streams.push({
                            name: "RECTV",
                            url: src.url
                        });
                    });
                });
            });

        } else {

            const s = await fetch(`${BASE_URL}/api/movie/${item.id}/${SW_KEY}/`);
            const d = await s.json();

            (d.sources || []).forEach(src => {
                streams.push({
                    name: "RECTV",
                    url: src.url
                });
            });
        }
    }

    return { streams };
});

/* =========================
   RUN
========================= */
const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
