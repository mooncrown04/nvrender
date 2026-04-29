import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';
import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;

const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    "User-Agent": "okhttp/4.12.0",
    "Accept": "application/json"
};

const MOVIE_MAP = { "Aksiyon": "1", "Dram": "2", "Komedi": "3", "Korku": "8" };
const SERIES_MAP = { "Aksiyon": "1", "Dram": "2", "Komedi": "3", "Korku": "8" };
const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3" };

const YEARS = Array.from({ length: 30 }, (_, i) => (2026 - i).toString());

// ---------------- MANIFEST ----------------
const manifest = {
    id: "rectv.fix.full",
    version: "5.0.0",
    name: "RECTV FIX FULL",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["CH_", "tt"],

    catalogs: [
        { id: "live", type: "tv", name: "Live TV", extra: [{ name: "search" }] },
        { id: "movies", type: "movie", name: "Movies", extra: [{ name: "search" }, { name: "genre", options: Object.keys(MOVIE_MAP) }] },
        { id: "series", type: "series", name: "Series", extra: [{ name: "search" }, { name: "genre", options: Object.keys(SERIES_MAP) }] }
    ]
};

const builder = new addonBuilder(manifest);

// ---------------- TMDB -> IMDB ----------------
async function getImdbId(title, type) {
    try {
        const sType = type === "series" ? "tv" : "movie";

        const res = await fetch(
            `https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`
        );
        const data = await res.json();

        if (!data.results?.length) return null;

        const id = data.results[0].id;

        const ext = await fetch(
            `https://api.themoviedb.org/3/${sType}/${id}/external_ids?api_key=${TMDB_KEY}`
        );
        const extData = await ext.json();

        return extData.imdb_id ? extData.imdb_id.replace("tt", "") : null;
    } catch {
        return null;
    }
}

// ---------------- CATALOG ----------------
builder.defineCatalogHandler(async (args) => {
    const { id, type, extra } = args;

    try {

        // ---------------- LIVE TV ----------------
        if (id === "live") {
            const url = extra?.search
                ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
                : `${BASE_URL}/api/channel/by/filtres/3/0/0/${SW_KEY}/`;

            const res = await fetch(url, { headers: HEADERS });
            const data = await res.json();

            const channels = data.channels || data || [];

            return {
                metas: channels.map(c => ({
                    id: `CH_${(c.title || c.name).replace(/\s+/g, "_")}`,
                    type: "tv",
                    name: c.title || c.name,
                    poster: c.image,
                    posterShape: "landscape"
                }))
            };
        }

        // ---------------- MOVIE / SERIES ----------------
        const path = type === "series" ? "serie" : "movie";

        let url = extra?.search
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${path}/by/filtres/0/created/0/${SW_KEY}/`;

        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json();

        const items = data.series || data.posters || data || [];

        const metas = [];

        for (let item of items.slice(0, 25)) {

            const title = item.title || item.name;
            if (!title) continue;

            let imdb = await getImdbId(title, type);

            // 🔥 CRITICAL FIX: IMDB yoksa da göster
            const finalId = imdb
                ? (type === "series" ? `${imdb}:1:1` : imdb)
                : `${title.replace(/\s+/g, "_")}`;

            metas.push({
                id: finalId,
                type,
                name: title,
                poster: item.image || item.thumbnail
            });
        }

        return { metas };

    } catch (e) {
        return { metas: [] };
    }
});

// ---------------- META ----------------
builder.defineMetaHandler(async ({ id, type }) => {

    if (id.startsWith("CH_")) {
        return {
            meta: {
                id,
                type: "tv",
                name: id.replace("CH_", "").replace(/_/g, " "),
                posterShape: "landscape"
            }
        };
    }

    return {
        meta: {
            id,
            type,
            name: id,
            poster: "",
            description: "Loading..."
        }
    };
});

// ---------------- STREAM ----------------
builder.defineStreamHandler(async ({ id, type }) => {

    try {

        // ---------------- LIVE ----------------
        if (id.startsWith("CH_")) {

            const name = id.replace("CH_", "").replace(/_/g, " ");

            const res = await fetch(
                `${BASE_URL}/api/search/${encodeURIComponent(name)}/${SW_KEY}/`,
                { headers: HEADERS }
            );

            const data = await res.json();
            const ch = (data.channels || []).find(c =>
                (c.title || c.name).replace(/\s+/g, "_") === id.replace("CH_", "")
            );

            if (!ch) return { streams: [] };

            const s = await fetch(
                `${BASE_URL}/api/channel/${ch.id}/${SW_KEY}/`,
                { headers: HEADERS }
            );

            const sd = await s.json();

            return {
                streams: (sd.sources || []).map(x => ({
                    name: "RECTV",
                    title: x.title,
                    url: x.url
                }))
            };
        }

        // ---------------- MOVIE / SERIES ----------------
        const pureTitle = id.split(":")[0].replace(/_/g, " ");

        const res = await fetch(
            `${BASE_URL}/api/search/${encodeURIComponent(pureTitle)}/${SW_KEY}/`,
            { headers: HEADERS }
        );

        const data = await res.json();

        const pool = data.series || data.posters || [];

        const found = pool.find(x =>
            (x.title || x.name || "").toLowerCase().includes(pureTitle.toLowerCase())
        );

        if (!found) return { streams: [] };

        const detail = await fetch(
            `${BASE_URL}/api/${type === "series" ? "serie" : "movie"}/${found.id}/${SW_KEY}/`,
            { headers: HEADERS }
        );

        const d = await detail.json();

        return {
            streams: (d.sources || []).map(x => ({
                name: "RECTV",
                title: x.title,
                url: x.url
            }))
        };

    } catch (e) {
        return { streams: [] };
    }
});

const addonInterface = builder.getInterface();

// 🔥 KRİTİK FIX: EXPORT DEFAULT
export default addonInterface;

serveHTTP(addonInterface, { port: PORT });
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
