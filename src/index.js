import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const builder = new addonBuilder({
    id: "rectv.fixed.catalog",
    version: "6.0.0",
    name: "RECTV FIX",
    resources: ["catalog", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "CH_"],
    catalogs: [
        { id: "movies", type: "movie", name: "Movies" },
        { id: "series", type: "series", name: "Series" },
        { id: "live", type: "tv", name: "Live TV" }
    ]
});

// ---------------- TMDB SEARCH ----------------
async function tmdbSearch(title, type) {
    const media = type === "series" ? "tv" : "movie";

    const r = await fetch(
        `https://api.themoviedb.org/3/search/${media}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}`
    );

    const d = await r.json();
    return d.results?.[0];
}

// ---------------- IMDB ----------------
async function imdbId(tmdbId, type) {
    const media = type === "series" ? "tv" : "movie";

    const r = await fetch(
        `https://api.themoviedb.org/3/${media}/${tmdbId}/external_ids?api_key=${TMDB_KEY}`
    );

    const d = await r.json();
    return d.imdb_id ? d.imdb_id.replace("tt", "") : null;
}

// ---------------- REC LIVE SOURCE ----------------
async function recLive() {
    const r = await fetch(`${BASE_URL}/api/channel/by/filtres/3/0/0/${SW_KEY}/`);
    return await r.json();
}

// ---------------- CATALOG FIX (ASIL SORUN BURADA) ----------------
builder.defineCatalogHandler(async ({ type, id }) => {

    let items = [];

    // 🔥 LIVE TV
    if (type === "tv") {
        const data = await recLive();

        return {
            metas: (data || []).slice(0, 50).map(ch => ({
                id: `CH_${ch.id}`,
                type: "tv",
                name: ch.title,
                poster: ch.image
            }))
        };
    }

    // 🔥 MOVIE / SERIES → REC SEARCH (BOŞ QUERY YOK!)
    const r = await fetch(
        `${BASE_URL}/api/search/action/${SW_KEY}/`
    );

    const data = await r.json();

    items = data.series || data.posters || [];

    const metas = [];

    for (const item of items.slice(0, 30)) {

        const title = item.title || item.name;
        if (!title) continue;

        const tmdb = await tmdbSearch(title, type);
        if (!tmdb) continue;

        const imdb = await imdbId(tmdb.id, type);
        if (!imdb) continue;

        metas.push({
            id: type === "series"
                ? `tt${imdb}:1:1`
                : `tt${imdb}`,
            type,
            name: title,
            poster: item.image
        });
    }

    return { metas };
});

// ---------------- STREAM (BASİT AMA ÇALIŞIR) ----------------
builder.defineStreamHandler(async ({ id, type }) => {

    try {

        if (id.startsWith("CH_")) {
            const r = await fetch(`${BASE_URL}/api/channel/${id.replace("CH_", "")}/${SW_KEY}/`);
            const d = await r.json();

            return {
                streams: (d.sources || []).map(s => ({
                    title: "RECTV",
                    url: s.url
                }))
            };
        }

        const imdb = id.split(":")[0].replace("tt", "");

        const tmdb = await fetch(
            `https://api.themoviedb.org/3/find/tt${imdb}?api_key=${TMDB_KEY}&external_source=imdb_id`
        );

        const t = await tmdb.json();

        const obj = t.movie_results?.[0] || t.tv_results?.[0];
        if (!obj) return { streams: [] };

        const title = obj.title || obj.name;

        const search = await fetch(
            `${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`
        );

        const s = await search.json();

        const pool = s.series || s.posters || [];

        const found = pool.find(x =>
            (x.title || "").toLowerCase().includes(title.toLowerCase())
        );

        if (!found) return { streams: [] };

        const detail = await fetch(
            `${BASE_URL}/api/${type === "series" ? "serie" : "movie"}/${found.id}/${SW_KEY}/`
        );

        const d = await detail.json();

        if (type === "series") {
            const [_, season, episode] = id.split(":");

            const s = d.seasons?.find(x => x.season_number == season);
            const e = s?.episodes?.find(x => x.episode_number == episode);

            return {
                streams: (e?.sources || []).map(x => ({
                    title: "RECTV",
                    url: x.url
                }))
            };
        }

        return {
            streams: (d.sources || []).map(x => ({
                title: "RECTV",
                url: x.url
            }))
        };

    } catch (e) {
        return { streams: [] };
    }
});

// ---------------- START ----------------
serveHTTP(builder.getInterface(), { port: PORT });
