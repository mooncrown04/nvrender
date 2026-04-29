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

// ---------------- MANIFEST ----------------
const manifest = {
    id: "com.rectv.pro.full",
    version: "5.1.0",
    name: "RECTV PRO FULL FIX",
    description: "REC + TMDB + STREAM FULL SYSTEM",
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

// ---------------- TMDB → IMDB ----------------
async function getImdb(tmdbId, type) {
    const media = type === "series" ? "tv" : "movie";

    const r = await fetch(
        `https://api.themoviedb.org/3/${media}/${tmdbId}/external_ids?api_key=${TMDB_KEY}`
    );

    const d = await r.json();
    return d.imdb_id ? d.imdb_id.replace("tt", "") : null;
}

// ---------------- REC SEARCH ----------------
async function recSearch(title) {
    const res = await fetch(
        `${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`
    );
    return await res.json();
}

// ---------------- TMDB FIND ----------------
async function tmdbFind(title, type) {
    const media = type === "series" ? "tv" : "movie";

    const r = await fetch(
        `https://api.themoviedb.org/3/search/${media}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}`
    );

    const d = await r.json();
    return d.results?.[0] || null;
}

// ---------------- STREAM RESOLVER ----------------
async function getStreams(imdbId, type, season, episode) {

    const tmdb = await fetch(
        `https://api.themoviedb.org/3/find/tt${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`
    );

    const data = await tmdb.json();

    const obj = data.movie_results?.[0] || data.tv_results?.[0];
    if (!obj) return [];

    const title = obj.title || obj.name;

    const rec = await recSearch(title);

    const pool = rec.series || rec.posters || [];

    const found = pool.find(x =>
        (x.title || "").toLowerCase().includes(title.toLowerCase())
    );

    if (!found) return [];

    const detail = await fetch(
        `${BASE_URL}/api/${type === "series" ? "serie" : "movie"}/${found.id}/${SW_KEY}/`
    );

    const d = await detail.json();

    if (type === "series") {
        const s = d.seasons?.find(x => x.season_number == season);
        const e = s?.episodes?.find(x => x.episode_number == episode);
        return e?.sources || [];
    }

    return d.sources || [];
}

// ---------------- CATALOG ----------------
builder.defineCatalogHandler(async ({ type }) => {

    const rec = await recSearch("");

    const items = rec.series || rec.posters || [];

    const metas = [];

    for (const item of items.slice(0, 20)) {

        const tmdb = await tmdbFind(item.title, type);
        if (!tmdb) continue;

        const imdb = await getImdb(tmdb.id, type);
        if (!imdb) continue;

        metas.push({
            id: type === "series"
                ? `tt${imdb}:1:1`
                : `tt${imdb}`,

            type,
            name: item.title,
            poster: item.image
        });
    }

    return { metas };
});

// ---------------- META ----------------
builder.defineMetaHandler(async ({ id, type }) => {
    return {
        meta: {
            id,
            type,
            name: id,
            poster: "",
            description: "RECTV ITEM"
        }
    };
});

// ---------------- STREAM ----------------
builder.defineStreamHandler(async ({ id, type }) => {

    try {

        if (id.startsWith("CH_")) {
            const res = await fetch(`${BASE_URL}/api/channel/${id.replace("CH_", "")}/${SW_KEY}/`);
            const d = await res.json();

            return {
                streams: (d.sources || []).map(s => ({
                    title: "RECTV LIVE",
                    url: s.url
                }))
            };
        }

        let pure = id.split(":")[0].replace("tt", "");

        const season = id.split(":")[1];
        const episode = id.split(":")[2];

        const streams = await getStreams(pure, type, season, episode);

        return {
            streams: streams.map(s => ({
                title: s.title || "RECTV",
                url: s.url
            }))
        };

    } catch (e) {
        return { streams: [] };
    }
});

// ---------------- START ----------------
const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
