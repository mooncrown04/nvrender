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

/* ---------------- HELPERS ---------------- */

function parseId(id) {
    const p = id.split(':');
    return {
        imdb: p[0],
        season: p[1] || 1,
        episode: p[2] || 1
    };
}

function normalizeChannel(name) {
    return name.replace("CH_", "").replace(/_/g, " ").toLowerCase();
}

async function tmdbToTitle(imdbId, type) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();

        const obj = type === "series"
            ? data.tv_results?.[0]
            : data.movie_results?.[0];

        return obj?.title || obj?.name || null;
    } catch {
        return null;
    }
}

/* ---------------- MANIFEST ---------------- */

const manifest = {
    id: "com.hybrid.full.scraper",
    version: "1.0.0",
    name: "Hybrid TV Scraper PRO",
    description: "Catalog + Meta + Stream + Scraper Bridge",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "CH_"],
    catalogs: [
        {
            id: "movies",
            type: "movie",
            name: "Movies",
            extra: [{ name: "search" }]
        },
        {
            id: "series",
            type: "series",
            name: "Series",
            extra: [{ name: "search" }]
        },
        {
            id: "live",
            type: "tv",
            name: "Live TV",
            extra: [{ name: "search" }]
        }
    ]
};

const builder = new addonBuilder(manifest);

/* ---------------- CATALOG ---------------- */

builder.defineCatalogHandler(async ({ id, type, extra }) => {

    // LIVE TV
    if (id === "live") {
        const url = extra?.search
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/channel/by/filtres/3/0/0/${SW_KEY}/`;

        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json();

        const list = data.channels || data || [];

        return {
            metas: list.map(c => ({
                id: `CH_${c.title}`,
                type: "tv",
                name: c.title || c.name
            }))
        };
    }

    // MOVIE / SERIES SEARCH
    const url = `${BASE_URL}/api/search/${encodeURIComponent(extra?.search || "")}/${SW_KEY}/`;
    const res = await fetch(url, { headers: HEADERS });
    const data = await res.json();

    const items = type === "series"
        ? (data.series || [])
        : (data.posters || []);

    return {
        metas: items.slice(0, 20).map(i => ({
            id: type === "series" ? `${i.imdb || "tt000000"}:1:1` : (i.imdb || "tt000000"),
            type,
            name: i.title || i.name,
            poster: i.image
        }))
    };
});

/* ---------------- META (ZORUNLU FIX) ---------------- */

builder.defineMetaHandler(async ({ id, type }) => {

    if (id.startsWith("CH_")) {
        return {
            meta: {
                id,
                type: "tv",
                name: normalizeChannel(id)
            }
        };
    }

    const { imdb } = parseId(id);

    const title = await tmdbToTitle(imdb, type);

    return {
        meta: {
            id,
            type,
            name: title || "Loading...",
            description: "Hybrid Meta Bridge"
        }
    };
});

/* ---------------- STREAM (SCRAPER CORE) ---------------- */

builder.defineStreamHandler(async ({ id, type }) => {

    /* LIVE TV */
    if (id.startsWith("CH_")) {

        const name = normalizeChannel(id);

        const res = await fetch(
            `${BASE_URL}/api/search/${encodeURIComponent(name)}/${SW_KEY}/`,
            { headers: HEADERS }
        );

        const data = await res.json();
        const ch = (data.channels || []).find(c =>
            normalizeChannel("CH_" + c.title) === name
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

    /* MOVIE / SERIES SCRAPER BRIDGE */

    const { imdb, season, episode } = parseId(id);

    const title = await tmdbToTitle(imdb, type);
    if (!title) return { streams: [] };

    // 🔥 KRİTİK: isim ile yeniden kazıma
    const search = await fetch(
        `${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`,
        { headers: HEADERS }
    );

    const data = await search.json();

    const pool = type === "series"
        ? (data.series || [])
        : (data.posters || []);

    const match = pool.find(p =>
        (p.title || p.name).toLowerCase().includes(title.toLowerCase().split(" ")[0])
    );

    if (!match) return { streams: [] };

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
                name: "SCRAPER",
                title: x.title,
                url: x.url
            }))
        };
    }

    return {
        streams: (d.sources || []).map(x => ({
            name: "SCRAPER",
            title: x.title,
            url: x.url
        }))
    };
});

/* ---------------- START ---------------- */

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });

console.log("Hybrid addon running on", PORT);
