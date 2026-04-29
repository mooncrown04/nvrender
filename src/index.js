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

// ================= ID =================
function buildId(type, id) {
    return `rectv_${type}_${id}`;
}

function parseId(id) {
    if (id.startsWith("CH_")) return { type: "channel", id: id.replace("CH_", "") };

    const p = id.split("_");
    return {
        type: p[1],
        id: p[2],
        season: p[3],
        episode: p[4]
    };
}

// ================= TMDB =================
async function getTMDB(title, type) {
    try {
        const t = type === "series" ? "tv" : "movie";

        const res = await fetch(`https://api.themoviedb.org/3/search/${t}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`);
        const data = await res.json();

        return data.results?.[0];
    } catch {
        return null;
    }
}

// ================= MANIFEST =================
const manifest = {
    id: "com.rectv.hybrid",
    version: "2.0.0",
    name: "RECTV Hybrid",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "channel"],
    idPrefixes: ["rectv", "CH_"],
    catalogs: [
        { id: "live", type: "channel", name: "📺 Canlı TV" },
        { id: "movies", type: "movie", name: "🎬 Filmler", extra: [{ name: "search" }] },
        { id: "series", type: "series", name: "🍿 Diziler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

// ================= CATALOG =================
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        let url;

        if (id === "live") {
            url = `${BASE_URL}/api/channel/by/category/1/${SW_KEY}/`;
        } else if (extra?.search) {
            url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else {
            url = `${BASE_URL}/api/${type === "movie" ? "movie" : "serie"}/by/filtres/0/created/0/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json();

        const items = data.channels || data.posters || data.series || [];

        return {
            metas: items.map(i => ({
                id: id === "live" ? `CH_${i.id}` : buildId(type, i.id),
                type: id === "live" ? "channel" : type,
                name: i.title || i.name,
                poster: i.image || i.thumbnail,
                posterShape: id === "live" ? "landscape" : "poster"
            }))
        };

    } catch {
        return { metas: [] };
    }
});

// ================= META =================
builder.defineMetaHandler(async ({ type, id }) => {
    try {
        const parsed = parseId(id);

        if (parsed.type === "channel") {
            const res = await fetch(`${BASE_URL}/api/channel/${parsed.id}/${SW_KEY}/`, { headers: HEADERS });
            const data = await res.json();

            return {
                meta: {
                    id,
                    type: "channel",
                    name: data.name,
                    poster: data.image,
                    background: data.image
                }
            };
        }

        // RECTV’den title al
        const url = parsed.type === "movie"
            ? `${BASE_URL}/api/movie/${parsed.id}/${SW_KEY}/`
            : `${BASE_URL}/api/season/by/serie/${parsed.id}/${SW_KEY}/`;

        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json();

        const title = parsed.type === "movie"
            ? data.title
            : data?.[0]?.episodes?.[0]?.title || "Dizi";

        const tmdb = await getTMDB(title, parsed.type);

        if (!tmdb) {
            return { meta: { id, type, name: title } };
        }

        const meta = {
            id,
            type,
            name: tmdb.name || tmdb.title,
            poster: `https://image.tmdb.org/t/p/w500${tmdb.poster_path}`,
            background: `https://image.tmdb.org/t/p/original${tmdb.backdrop_path}`,
            description: tmdb.overview,
            videos: []
        };

        if (parsed.type === "series") {
            const det = await fetch(`https://api.themoviedb.org/3/tv/${tmdb.id}?api_key=${TMDB_KEY}`);
            const detData = await det.json();

            for (const s of detData.seasons || []) {
                if (s.season_number === 0) continue;

                const sr = await fetch(`https://api.themoviedb.org/3/tv/${tmdb.id}/season/${s.season_number}?api_key=${TMDB_KEY}`);
                const sd = await sr.json();

                (sd.episodes || []).forEach(ep => {
                    meta.videos.push({
                        id: `rectv_series_${parsed.id}_${ep.season_number}_${ep.episode_number}`,
                        title: ep.name,
                        season: ep.season_number,
                        episode: ep.episode_number
                    });
                });
            }
        }

        return { meta };

    } catch {
        return { meta: {} };
    }
});

// ================= STREAM =================
builder.defineStreamHandler(async ({ id }) => {
    try {
        const parsed = parseId(id);

        if (parsed.type === "channel") {
            const res = await fetch(`${BASE_URL}/api/channel/${parsed.id}/${SW_KEY}/`, { headers: HEADERS });
            const data = await res.json();

            return {
                streams: data.sources.map(s => ({ name: "RECTV", url: s.url }))
            };
        }

        if (parsed.type === "movie") {
            const res = await fetch(`${BASE_URL}/api/movie/${parsed.id}/${SW_KEY}/`, { headers: HEADERS });
            const data = await res.json();

            return {
                streams: data.sources.map(s => ({ name: "RECTV", url: s.url }))
            };
        }

        if (parsed.type === "series") {
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${parsed.id}/${SW_KEY}/`, { headers: HEADERS });
            const data = await res.json();

            const season = data.find(s => s.title.includes(parsed.season));
            const episode = season?.episodes.find(e => e.title.includes(parsed.episode));

            return {
                streams: (episode?.sources || []).map(s => ({
                    name: "RECTV",
                    url: s.url
                }))
            };
        }

    } catch {}

    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: PORT });
