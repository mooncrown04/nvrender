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

// -------------------- MANIFEST --------------------
export const manifest = {
    id: "rectv.fix.ultimate",
    version: "5.0.0",
    name: "RECTV FIX",
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

// -------------------- TMDB (META ONLY) --------------------
async function tmdbMeta(id, type) {
    const url = `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
    const res = await fetch(url);
    const data = await res.json();

    const obj = type === "series"
        ? data.tv_results?.[0]
        : data.movie_results?.[0];

    if (!obj) return null;

    return {
        id,
        type,
        name: obj.name || obj.title,
        poster: obj.poster_path
            ? `https://image.tmdb.org/t/p/w500${obj.poster_path}`
            : null,
        description: obj.overview || ""
    };
}

// -------------------- CATALOG (SADECE ID) --------------------
builder.defineCatalogHandler(async (args) => {
    const { id, type, extra } = args;

    // LIVE TV
    if (id === "live") {
        const res = await fetch(`${BASE_URL}/api/channels`, { headers: HEADERS });
        const data = await res.json();

        return {
            metas: data.map(ch => ({
                id: `CH_${ch.name.replace(/\s/g,'_')}`,
                type: "tv",
                name: ch.name,
                posterShape: "landscape"
            }))
        };
    }

    // MOVIE / SERIES SEARCH
    const q = extra?.search;

    if (q) {
        const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(q)}/${SW_KEY}/`);
        const data = await res.json();

        const list = (data.series || data.posters || []);

        return {
            metas: list.slice(0, 30).map(i => {
                const isSeries = i.type === "serie";

                return {
                    id: isSeries
                        ? `tt${i.tmdb_id || i.id}:1:1`
                        : `tt${i.tmdb_id || i.id}`,
                    type: isSeries ? "series" : "movie",
                    name: i.title || i.name,
                    poster: i.image
                };
            })
        };
    }

    return { metas: [] };
});

// -------------------- META --------------------
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

    return { meta: await tmdbMeta(id, type) };
});

// -------------------- STREAM (ASIL SCRAPER BURASI) --------------------
builder.defineStreamHandler(async ({ id, type }) => {

    try {

        // LIVE TV
        if (id.startsWith("CH_")) {
            const name = id.replace("CH_", "").replace(/_/g, " ");

            const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(name)}/${SW_KEY}/`);
            const data = await res.json();

            const ch = (data.channels || []).find(c =>
                c.name.replace(/\s/g,'_') === id.replace("CH_", "")
            );

            if (!ch) return { streams: [] };

            const streamRes = await fetch(`${BASE_URL}/api/channel/${ch.id}/${SW_KEY}/`);
            const streamData = await streamRes.json();

            return {
                streams: (streamData.sources || []).map(s => ({
                    name: "RECTV",
                    url: s.url
                }))
            };
        }

        // MOVIE / SERIES
        const pureId = id.split(":")[0]; // ttXXXX

        const titleRes = await fetch(
            `https://api.themoviedb.org/3/find/${pureId}?api_key=${TMDB_KEY}&external_source=imdb_id`
        );
        const titleData = await titleRes.json();

        const obj = titleData.movie_results?.[0] || titleData.tv_results?.[0];

        if (!obj) return { streams: [] };

        const searchTitle = obj.title || obj.name;

        // SCRAPER SEARCH (KRİTİK NOKTA)
        const res = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(searchTitle)}/${SW_KEY}/`);
        const data = await res.json();

        const pool = (data.series || data.posters || []);

        const found = pool.find(i =>
            (i.title || i.name).toLowerCase().includes(searchTitle.toLowerCase())
        );

        if (!found) return { streams: [] };

        const detail = await fetch(
            `${BASE_URL}/api/${type === "series" ? "serie" : "movie"}/${found.id}/${SW_KEY}/`
        );

        const detailData = await detail.json();

        const sources = detailData.sources || [];

        return {
            streams: sources.map(s => ({
                name: "RECTV",
                url: s.url
            }))
        };

    } catch (e) {
        return { streams: [] };
    }
});

// --------------------
const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
