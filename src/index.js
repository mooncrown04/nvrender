import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

/* -------------------------
   HELPERS
------------------------- */

// CH_KANAL_D → Kanal D
function normalizeChannel(id) {
    return id
        .replace("CH_", "")
        .replace(/_/g, " ")
        .toLowerCase()
        .trim();
}

// tt123456:1:1 parser
function parseId(id) {
    const parts = id.split(":");
    return {
        imdb: parts[0],
        season: parts[1] || 1,
        episode: parts[2] || 1
    };
}

// TMDB → isim çöz
async function getTitleFromTmdb(imdbId, type) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();

        const obj =
            type === "series"
                ? data.tv_results?.[0]
                : data.movie_results?.[0];

        return obj?.title || obj?.name || null;
    } catch {
        return null;
    }
}

/* -------------------------
   MANIFEST
------------------------- */

const manifest = {
    id: "com.fix.hybrid.scraper",
    version: "1.0.0",
    name: "Hybrid TV + Scraper",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "CH_"],
    catalogs: [
        {
            id: "live_tv",
            type: "tv",
            name: "Canlı TV",
            extra: [{ name: "search" }]
        },
        {
            id: "movies",
            type: "movie",
            name: "Filmler",
            extra: [{ name: "search" }]
        },
        {
            id: "series",
            type: "series",
            name: "Diziler",
            extra: [{ name: "search" }]
        }
    ]
};

const builder = new addonBuilder(manifest);

/* -------------------------
   CATALOG
------------------------- */

builder.defineCatalogHandler(async ({ id, type, extra }) => {
    try {

        // LIVE TV
        if (id === "live_tv") {
            const url = extra?.search
                ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
                : `${BASE_URL}/api/channel/by/filtres/3/0/0/${SW_KEY}/`;

            const res = await fetch(url, { headers: HEADERS });
            const data = await res.json();

            const list = data.channels || data || [];

            return {
                metas: list.map(c => ({
                    id: `CH_${c.title?.replace(/\s+/g, "_")}`,
                    type: "tv",
                    name: c.title || c.name,
                    poster: c.image
                }))
            };
        }

        // MOVIE / SERIES SEARCH
        const url = `${BASE_URL}/api/search/${encodeURIComponent(extra?.search || "")}/${SW_KEY}/`;
        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json();

        const items = type === "series" ? (data.series || []) : (data.posters || []);

        return {
            metas: items.slice(0, 20).map(item => {
                const imdb = item.imdb || item.imdb_id || "tt000000";
                return {
                    id: type === "series" ? `${imdb}:1:1` : imdb,
                    type,
                    name: item.title || item.name,
                    poster: item.image
                };
            })
        };

    } catch (e) {
        return { metas: [] };
    }
});

/* -------------------------
   STREAM (SCRAPER CORE FIX)
------------------------- */

builder.defineStreamHandler(async ({ id, type }) => {
    try {

        /* =====================
           CANLI TV
        ===================== */
        if (id.startsWith("CH_")) {
            const name = normalizeChannel(id);

            const res = await fetch(
                `${BASE_URL}/api/search/${encodeURIComponent(name)}/${SW_KEY}/`,
                { headers: HEADERS }
            );

            const data = await res.json();
            const ch = (data.channels || []).find(c =>
                normalizeChannel("CH_" + c.title) === id.toLowerCase()
            );

            if (!ch) return { streams: [] };

            const r = await fetch(
                `${BASE_URL}/api/channel/${ch.id}/${SW_KEY}/`,
                { headers: HEADERS }
            );

            const d = await r.json();

            return {
                streams: (d.sources || []).map(s => ({
                    name: "RECTV",
                    title: s.title,
                    url: s.url
                }))
            };
        }

        /* =====================
           MOVIE / SERIES SCRAPER BRIDGE
        ===================== */

        const { imdb, season, episode } = parseId(id);

        const title = await getTitleFromTmdb(imdb, type);
        if (!title) return { streams: [] };

        // 🔥 KRİTİK: isim ile tekrar kazıma
        const searchRes = await fetch(
            `${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`,
            { headers: HEADERS }
        );

        const searchData = await searchRes.json();

        const pool = type === "series"
            ? (searchData.series || [])
            : (searchData.posters || []);

        const match = pool.find(p =>
            (p.title || p.name)
                .toLowerCase()
                .includes(title.toLowerCase().split(" ")[0])
        );

        if (!match) return { streams: [] };

        const detailRes = await fetch(
            `${BASE_URL}/api/${type === "series" ? "serie" : "movie"}/${match.id}/${SW_KEY}/`,
            { headers: HEADERS }
        );

        const detail = await detailRes.json();

        if (type === "series") {
            const s = (detail.seasons || []).find(x => x.season_number == season);
            const e = s?.episodes?.find(x => x.episode_number == episode);

            return {
                streams: (e?.sources || []).map(src => ({
                    name: "RECTV",
                    title: src.title,
                    url: src.url
                }))
            };
        }

        return {
            streams: (detail.sources || []).map(src => ({
                name: "RECTV",
                title: src.title,
                url: src.url
            }))
        };

    } catch (e) {
        return { streams: [] };
    }
});

/* -------------------------
   START
------------------------- */

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
