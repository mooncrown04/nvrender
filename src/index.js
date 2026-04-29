import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;
import fetch from "node-fetch";

const PORT = process.env.PORT || 7010;

const BASE_URL = "https://a.prectv70.lol";
cconst SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "68e094699525b18a70bab2f86b1fa706";

const FULL_HEADERS = {
    "User-Agent": "okhttp/4.12.0",
    "Accept": "application/json"
};

/* =========================
   MANIFEST (HATASIZ)
========================= */
const manifest = {
    id: "com.rectv.pro.full",
    version: "5.0.0",
    name: "RECTV PRO",
    description: "Catalog + Scraper Hybrid System",
    types: ["movie", "series", "tv"],
    resources: ["catalog", "meta", "stream"],
    idPrefixes: ["tt", "CH_"],

    catalogs: [
        {
            id: "live_tv",
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
   IMDb → TMDB TITLE
========================= */
async function imdbToTitle(imdbId, type) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&language=tr-TR&external_source=imdb_id`;
        const res = await fetch(url);
        const data = await res.json();

        if (type === "movie") return data.movie_results?.[0]?.title;
        if (type === "series") return data.tv_results?.[0]?.name;
    } catch (e) {}
    return null;
}

/* =========================
   META
========================= */
builder.defineMetaHandler(async ({ id, type }) => {

    if (id.startsWith("CH_")) {
        const name = id.replace("CH_", "").replace(/_/g, " ");
        return {
            meta: {
                id,
                type: "tv",
                name,
                description: "Canlı Kanal"
            }
        };
    }

    return {
        meta: {
            id,
            type,
            name: id,
        }
    };
});

/* =========================
   CATALOG
   → tt id üretir
========================= */
builder.defineCatalogHandler(async ({ id, type, extra }) => {

    const search = extra?.search || "";

    // TV
    if (id === "live_tv") {
        const res = await fetch(`${BASE_URL}/api/search/${search}/${SW_KEY}/`);
        const data = await res.json();

        return {
            metas: (data.channels || []).map(c => ({
                id: "CH_" + c.title.replace(/\s/g, "_"),
                type: "tv",
                name: c.title
            }))
        };
    }

    // MOVIE / SERIES → IMDb ID üret
    const url = `${BASE_URL}/api/search/${search}/${SW_KEY}/`;
    const res = await fetch(url);
    const data = await res.json();

    const list = data.posters || data.series || [];

    const metas = await Promise.all(list.slice(0, 20).map(async (item) => {

        const imdb = await findFakeImdb(item.title); 
        // yukarıyı aşağıda açıklıyorum

        if (!imdb) return null;

        return {
            id: type === "series" ? `${imdb}:1:1` : imdb,
            type,
            name: item.title
        };
    }));

    return { metas: metas.filter(Boolean) };
});

/* =========================
   FAKE IMDb FINDER
   (senin scraper köprün)
========================= */
async function findFakeImdb(title) {
    // burada TMDB yerine direkt search yapıyoruz
    try {
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}`;
        const res = await fetch(url);
        const data = await res.json();

        const r = data.results?.[0];
        if (!r) return null;

        return r.id ? "tt" + r.id.toString().padStart(7, "0") : null;
    } catch (e) {
        return null;
    }
}

/* =========================
   STREAM (ASIL SCRAPER)
========================= */
builder.defineStreamHandler(async ({ id, type }) => {

    // TV CHANNEL
    if (id.startsWith("CH_")) {
        const name = id.replace("CH_", "").replace(/_/g, " ");

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

    // MOVIE / SERIES
    const pureId = id.split(":")[0]; // tt123

    const title = await imdbToTitle(pureId, type);
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
                            title: src.title,
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
   RUN SERVER
========================= */
const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
