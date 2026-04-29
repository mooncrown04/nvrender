import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const builder = new addonBuilder({
    id: "rectv.stable",
    version: "1.0.0",
    name: "RECTV STABLE",
    resources: ["catalog", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "CH_"],
    catalogs: [
        { id: "live", type: "tv", name: "Live TV" },
        { id: "movies", type: "movie", name: "Movies" },
        { id: "series", type: "series", name: "Series" }
    ]
});

// ---------------- LIVE TV (BOZULMAYACAK) ----------------
builder.defineCatalogHandler(async ({ type }) => {

    if (type === "tv") {
        const res = await fetch(`${BASE_URL}/api/channel/by/filtres/3/0/0/${SW_KEY}/`);
        const data = await res.json();

        return {
            metas: (data || []).map(ch => ({
                id: `CH_${ch.id}`,
                type: "tv",
                name: ch.title,
                poster: ch.image
            }))
        };
    }

    // ---------------- MOVIE / SERIES (SIMPLE) ----------------
    const res = await fetch(`${BASE_URL}/api/search/action/${SW_KEY}/`);
    const data = await res.json();

    const items = data.series || data.posters || [];

    return {
        metas: items.slice(0, 30).map(item => ({
            id: type === "series"
                ? `tt${item.id || Math.floor(Math.random()*999999)}:1:1`
                : `tt${item.id || Math.floor(Math.random()*999999)}`,

            type,
            name: item.title,
            poster: item.image
        }))
    };
});

// ---------------- STREAM (STABLE LOGIC) ----------------
builder.defineStreamHandler(async ({ id, type }) => {

    // ---------------- LIVE ----------------
    if (id.startsWith("CH_")) {
        const res = await fetch(`${BASE_URL}/api/channel/${id.replace("CH_", "")}/${SW_KEY}/`);
        const data = await res.json();

        return {
            streams: (data.sources || []).map(s => ({
                title: "RECTV LIVE",
                url: s.url
            }))
        };
    }

    // ---------------- MOVIE / SERIES ----------------
    const titleGuess = id.split(":")[0];

    const search = await fetch(
        `${BASE_URL}/api/search/${encodeURIComponent(titleGuess)}/${SW_KEY}/`
    );

    const data = await search.json();

    const pool = data.series || data.posters || [];

    const found = pool[0];

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
});

// ---------------- START ----------------
serveHTTP(builder.getInterface(), { port: 7010 });
