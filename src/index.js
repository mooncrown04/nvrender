import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

// ---------------- MANIFEST ----------------
const manifest = {
    id: "com.rectv.smart.pro",
    version: "1.0.0",
    name: "RECTV Smart Pro",
    description: "Stable RECTV Addon (Search-based streaming)",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv", "CH_"],

    catalogs: [
        { id: "live", type: "tv", name: "📺 Canlı TV" },
        { id: "movies", type: "movie", name: "🎬 Filmler", extra: [{ name: "search" }] },
        { id: "series", type: "series", name: "🍿 Diziler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

// ---------------- HELPERS ----------------
function cleanQuery(id) {
    return id
        .replace("rectv_movie_", "")
        .replace("rectv_series_", "")
        .replace(/_/g, " ");
}

// ---------------- CATALOG ----------------
builder.defineCatalogHandler(async ({ id, type, extra }) => {
    try {

        // LIVE TV
        if (id === "live") {
            const res = await fetch(`${BASE_URL}/api/channel/by/category/1/${SW_KEY}/`, { headers: HEADERS });
            const data = await res.json();

            const items = data.channels || data.data || data || [];

            return {
                metas: items.map(ch => ({
                    id: `CH_${ch.id}`,
                    type: "tv",
                    name: ch.title || ch.name,
                    poster: ch.image,
                    posterShape: "landscape"
                }))
            };
        }

        // MOVIE / SERIES
        const path = type === "series" ? "serie" : "movie";

        const url = extra?.search
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${path}/by/filtres/0/created/0/${SW_KEY}/`;

        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json();

        const items =
            data.channels ||
            data.series ||
            data.posters ||
            data.data ||
            (Array.isArray(data) ? data : []);

        return {
            metas: (items || []).slice(0, 25).map(item => ({
                id: `rectv_${type}_${item.title || item.name}`,
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
            description: "Smart loaded content"
        }
    };
});

// ---------------- STREAM (CRITICAL FIX) ----------------
builder.defineStreamHandler(async ({ id, type }) => {

    try {

        // ---------------- LIVE TV ----------------
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

        // ---------------- SEARCH BASED STREAM ----------------
        const query = cleanQuery(id);

        const searchRes = await fetch(
            `${BASE_URL}/api/search/${encodeURIComponent(query)}/${SW_KEY}/`,
            { headers: HEADERS }
        );

        const searchData = await searchRes.json();

        const items =
            searchData.channels ||
            searchData.series ||
            searchData.posters ||
            searchData.data ||
            [];

        if (!items.length) return { streams: [] };

        const match = items[0];

        const detailUrl =
            type === "series"
                ? `${BASE_URL}/api/serie/${match.id}/${SW_KEY}/`
                : `${BASE_URL}/api/movie/${match.id}/${SW_KEY}/`;

        const detailRes = await fetch(detailUrl, { headers: HEADERS });
        const detail = await detailRes.json();

        return {
            streams: (detail.sources || []).map(s => ({
                name: "RECTV",
                title: s.title || "PLAY",
                url: s.url
            }))
        };

    } catch (e) {
        return { streams: [] };
    }
});

// ---------------- SERVER ----------------
serveHTTP(builder.getInterface(), { port: PORT });
