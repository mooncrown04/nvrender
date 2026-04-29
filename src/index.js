import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

// ================= NORMALIZE =================
function normalize(str) {
    return str
        ?.toLowerCase()
        .replace(/[:\-–—]/g, ' ')
        .replace(/\(.*?\)/g, '')
        .replace(/[^a-z0-9ğüşöçıİ\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim() || "";
}

// ================= FUZZY MATCH =================
function findBestMatch(title, pool) {
    const normTitle = normalize(title);

    let best = null;
    let bestScore = 0;

    for (const item of pool) {
        const itemTitle = normalize(item.title || item.name);

        let score = 0;

        if (itemTitle.includes(normTitle)) score += 5;

        const words = normTitle.split(' ');
        for (const w of words) {
            if (itemTitle.includes(w)) score += 1;
        }

        if (score > bestScore) {
            bestScore = score;
            best = item;
        }
    }

    return bestScore >= 3 ? best : null;
}

// ================= SEARCH CLEAN =================
function cleanSearchTitle(title) {
    return title
        .replace(/[:\-–—]/g, ' ')
        .split(' ')
        .slice(0, 3)
        .join(' ');
}

// ================= MANIFEST =================
const manifest = {
    id: "com.nuvio.rectv.ultra",
    version: "5.0.0",
    name: "RECTV ULTRA MATCH",
    description: "Ultra Matching System",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "channel"],
    idPrefixes: ["CH_", "tt"],
    catalogs: [
        { id: "rc_live", type: "channel", name: "📺 Canlı TV" },
        { id: "rc_movie", type: "movie", name: "🎬 Filmler", extra: [{ name: "search" }] },
        { id: "rc_series", type: "series", name: "🍿 Diziler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

// ================= IMDb FIND =================
async function findImdb(title, type) {
    try {
        const t = type === 'series' ? 'tv' : 'movie';
        const res = await fetch(`https://api.themoviedb.org/3/search/${t}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}`);
        const data = await res.json();
        if (data.results?.[0]) {
            const ext = await fetch(`https://api.themoviedb.org/3/${t}/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
            const extData = await ext.json();
            return extData.imdb_id?.replace("tt", "");
        }
    } catch {}
    return null;
}

// ================= CATALOG =================
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const url = extra?.search
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${type === 'series' ? 'serie' : 'movie'}/by/filtres/0/created/0/${SW_KEY}/`;

        const res = await fetch(url, { headers: FULL_HEADERS });
        const data = await res.json();

        const items = extra?.search
            ? (type === 'series' ? data.series : data.posters)
            : (data.posters || data.series || []);

        const metas = await Promise.all(items.slice(0, 50).map(async item => {
            const imdb = await findImdb(item.title || item.name, type);
            if (!imdb) return null;

            return {
                id: type === 'series' ? `${imdb}:1:1` : imdb,
                type,
                name: item.title || item.name,
                poster: item.image
            };
        }));

        return { metas: metas.filter(Boolean) };

    } catch {
        return { metas: [] };
    }
});

// ================= META =================
builder.defineMetaHandler(async ({ id, type }) => {
    try {
        const pure = id.split(':')[0];

        const res = await fetch(`https://api.themoviedb.org/3/find/tt${pure}?api_key=${TMDB_KEY}`);
        const data = await res.json();

        const obj = type === 'series' ? data.tv_results?.[0] : data.movie_results?.[0];
        if (!obj) return { meta: {} };

        const meta = {
            id,
            type,
            name: obj.name || obj.title,
            poster: `https://image.tmdb.org/t/p/w500${obj.poster_path}`,
            background: `https://image.tmdb.org/t/p/original${obj.backdrop_path}`,
            description: obj.overview,
            videos: []
        };

        if (type === 'series') {
            const det = await fetch(`https://api.themoviedb.org/3/tv/${obj.id}?api_key=${TMDB_KEY}`);
            const detData = await det.json();

            for (const s of detData.seasons || []) {
                if (s.season_number === 0) continue;

                const sr = await fetch(`https://api.themoviedb.org/3/tv/${obj.id}/season/${s.season_number}?api_key=${TMDB_KEY}`);
                const sd = await sr.json();

                (sd.episodes || []).forEach(ep => {
                    meta.videos.push({
                        id: `${pure}:${ep.season_number}:${ep.episode_number}`,
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
builder.defineStreamHandler(async ({ id, type }) => {
    try {
        const pure = id.split(':')[0];
        const season = id.split(':')[1];
        const episode = id.split(':')[2];

        const tmdbRes = await fetch(`https://api.themoviedb.org/3/find/tt${pure}?api_key=${TMDB_KEY}`);
        const tmdbData = await tmdbRes.json();
        const obj = tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0];

        if (!obj) return { streams: [] };

        const title = obj.title || obj.name;
        const clean = cleanSearchTitle(title);

        const searchRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(clean)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const searchData = await searchRes.json();

        const pool = (type === 'series' ? searchData.series : searchData.posters) || [];

        const found = findBestMatch(title, pool);
        if (!found) return { streams: [] };

        const res = await fetch(`${BASE_URL}/api/${type === 'series' ? 'serie' : 'movie'}/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const data = await res.json();

        if (type === 'series') {
            const s = data.seasons?.find(x => x.season_number == season);
            const e = s?.episodes?.find(x => x.episode_number == episode);
            return {
                streams: (e?.sources || []).map(src => ({
                    name: "RECTV",
                    url: src.url
                }))
            };
        }

        return {
            streams: (data.sources || []).map(src => ({
                name: "RECTV",
                url: src.url
            }))
        };

    } catch {
        return { streams: [] };
    }
});

// ================= START =================
serveHTTP(builder.getInterface(), { port: PORT });
