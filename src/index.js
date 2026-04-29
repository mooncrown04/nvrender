import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json'
};

/* ---------------- MANIFEST ---------------- */

const manifest = {
    id: "com.nuvio.hybrid.scraper",
    version: "3.0.0",
    name: "NUVIO Hybrid Engine",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "CH_"],
    catalogs: [
        { id: "live", type: "tv", name: "Live TV" },
        { id: "movies", type: "movie", name: "Movies" },
        { id: "series", type: "series", name: "Series" }
    ]
};

const builder = new addonBuilder(manifest);

/* ---------------- CATALOG (SADECE ID ÜRETİR) ---------------- */

builder.defineCatalogHandler(async ({ id, type, extra }) => {

    try {

        /* LIVE TV */
        if (id === "live") {
            const res = await fetch(
                `${BASE_URL}/api/channel/by/filtres/3/0/0/${SW_KEY}/`,
                { headers: HEADERS }
            );
            const data = await res.json();

            const list = data.channels || [];

            return {
                metas: list.map(c => ({
                    id: `CH_${c.title.replace(/\s+/g, "_")}`,
                    type: "tv",
                    name: c.title,
                    poster: c.image
                }))
            };
        }

        /* MOVIE / SERIES → SADECE ID ÜRET */
        const res = await fetch(
            `${BASE_URL}/api/search/${encodeURIComponent(extra?.search || "popüler")}/${SW_KEY}/`,
            { headers: HEADERS }
        );

        const data = await res.json();

        const items = type === "series"
            ? (data.series || [])
            : (data.posters || []);

        return {
            metas: items.map(i => {

                const imdb = i.imdb || i.id || "tt000000";

                return {
                    id: type === "series"
                        ? `${imdb}:1:1`
                        : imdb,
                    type,
                    name: i.title || i.name,
                    poster: i.image
                };
            })
        };

    } catch {
        return { metas: [] };
    }
});

/* ---------------- META (BASİT) ---------------- */

builder.defineMetaHandler(async ({ id, type }) => {

    if (id.startsWith("CH_")) {
        return {
            meta: {
                id,
                type: "tv",
                name: id.replace("CH_", "").replace(/_/g, " ")
            }
        };
    }

    return {
        meta: {
            id,
            type,
            name: "Loading..."
        }
    };
});

/* ---------------- STREAM (ASIL SCRAPER) ---------------- */

async function resolveTitleFromTmdb(imdb, type) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdb}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();

        const obj = type === "series"
            ? data.tv_results?.[0]
            : data.movie_results?.[0];

        return obj?.title || obj?.name;
    } catch {
        return null;
    }
}

builder.defineStreamHandler(async ({ id, type }) => {

    /* ---------------- LIVE TV ---------------- */
    if (id.startsWith("CH_")) {

        const name = id.replace("CH_", "").replace(/_/g, " ");

        const res = await fetch(
            `${BASE_URL}/api/search/${encodeURIComponent(name)}/${SW_KEY}/`,
            { headers: HEADERS }
        );

        const data = await res.json();

        const ch = (data.channels || []).find(c =>
            c.title?.replace(/\s+/g, "_") === name
        );

        if (!ch) return { streams: [] };

        const r = await fetch(
            `${BASE_URL}/api/channel/${ch.id}/${SW_KEY}/`,
            { headers: HEADERS }
        );

        const d = await r.json();

        return {
            streams: (d.sources || []).map(s => ({
                name: "LIVE",
                title: s.title,
                url: s.url
            }))
        };
    }

    /* ---------------- MOVIE / SERIES SCRAPER ---------------- */

    const baseId = id.split(":")[0];
    const season = id.split(":")[1] || 1;
    const episode = id.split(":")[2] || 1;

    // 🔥 1. IMDB → TMDB → NAME
    const title = await resolveTitleFromTmdb(baseId, type);
    if (!title) return { streams: [] };

    // 🔥 2. NAME → NUVO / REC SEARCH
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

    // 🔥 3. DETAIL FETCH
    const detail = await fetch(
        `${BASE_URL}/api/${type === "series" ? "serie" : "movie"}/${match.id}/${SW_KEY}/`,
        { headers: HEADERS }
    );

    const d = await detail.json();

    if (type === "series") {
        const s = (d.seasons || []).find(x => x.season_number == season);
        const e = s?.episodes?.find(x => x.episode_number == episode);

        return {
            streams: (e?.sources || []).map(x => ({
                name: "NUVIO",
                title: x.title,
                url: x.url
            }))
        };
    }

    return {
        streams: (d.sources || []).map(x => ({
            name: "NUVIO",
            title: x.title,
            url: x.url
        }))
    };
});

/* ---------------- START ---------------- */

serveHTTP(builder.getInterface(), { port: PORT });

console.log("NUVIO HYBRID RUNNING:", PORT);
