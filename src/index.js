import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

const manifest = {
    id: "com.nuvio.rectv.v10.final",
    version: "10.0.0",
    name: "RECTV Pro All-in-One",
    description: "Canlı TV (Logolu) + İsim Bazlı Kazıyıcı + Nuvio Sync",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "CH_"],
    catalogs: [
        { id: "rc_live", type: "tv", name: "📺 Canlı TV", extra: [{ name: "search" }] },
        { id: "rc_movie", type: "movie", name: "🎬 Filmler", extra: [{ name: "search" }] },
        { id: "rc_series", type: "series", name: "🍿 Diziler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR ---
const clean = (t) => t.replace(/HD|UHD|FHD|4K/gi, "").trim();

async function getImdb(title, type) {
    try {
        const sType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(clean(title))}&language=tr-TR`;
        const data = await (await fetch(url)).json();
        if (data.results?.[0]) {
            const ext = await (await fetch(`https://api.themoviedb.org/3/${sType}/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`)).json();
            return ext.imdb_id;
        }
    } catch (e) {} return null;
}

// --- 1. KATALOG VE META (GÖRSEL VE ARAMA) ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        let url = "";
        if (id === "rc_live") {
            url = extra.search ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` : `${BASE_URL}/api/channel/by/filtres/3/0/0/${SW_KEY}/`;
            const data = await (await fetch(url, { headers: FULL_HEADERS })).json();
            const channels = extra.search ? (data.channels || []) : data;
            return {
                metas: channels.map(ch => ({
                    id: `CH_${clean(ch.title || ch.name).replace(/\s+/g, '_')}`,
                    type: "tv",
                    name: clean(ch.title || ch.name),
                    poster: ch.image, // Canlı TV posteri aktif
                    posterShape: "landscape"
                }))
            };
        }

        const path = type === 'series' ? 'serie' : 'movie';
        url = extra.search ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` : `${BASE_URL}/api/${path}/by/filtres/0/created/0/${SW_KEY}/`;
        const data = await (await fetch(url, { headers: FULL_HEADERS })).json();
        const items = extra.search ? (type === 'series' ? data.series : data.posters) : (Array.isArray(data) ? data : data.posters || []);

        const metas = await Promise.all((items || []).slice(0, 15).map(async (item) => {
            const imdb = await getImdb(item.title || item.name, type);
            if (!imdb) return null;
            return {
                id: type === 'series' ? `${imdb}:1:1` : imdb,
                type: type,
                name: item.title || item.name,
                poster: item.image || item.thumbnail
            };
        }));
        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

builder.defineMetaHandler(async ({ type, id }) => {
    if (id.startsWith("CH_")) {
        const name = id.replace("CH_", "").replace(/_/g, " ");
        return { meta: { id, type: 'tv', name: name, posterShape: 'landscape' }};
    }
    try {
        const pureId = id.split(':')[0];
        const res = await fetch(`https://api.themoviedb.org/3/find/${pureId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
        const data = await res.json();
        const obj = type === 'series' ? data.tv_results?.[0] : data.movie_results?.[0];
        const meta = {
            id, type, name: obj.name || obj.title,
            poster: `https://image.tmdb.org/t/p/w500${obj.poster_path}`,
            background: `https://image.tmdb.org/t/p/original${obj.backdrop_path}`,
            description: obj.overview,
            videos: []
        };
        if (type === 'series') {
            const detail = await (await fetch(`https://api.themoviedb.org/3/tv/${obj.id}?api_key=${TMDB_KEY}&language=tr-TR`)).json();
            detail.seasons?.filter(s => s.season_number > 0).forEach(s => {
                for (let i = 1; i <= s.episode_count; i++) {
                    meta.videos.push({ id: `${pureId}:${s.season_number}:${i}`, title: `S${s.season_number} E${i}`, season: s.season_number, episode: i });
                }
            });
        } else { meta.videos.push({ id, title: obj.title }); }
        return { meta };
    } catch (e) { return { meta: { id, type, name: "Meta Hatası" } }; }
});

// --- 2. KAZIYICI (STREAM) VE NUVIO GETSTREAMS UYUMU ---
async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        const res = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_KEY}&language=tr-TR`);
        const data = await res.json();
        const searchTitle = data.title || data.name;
        if (!searchTitle) return [];

        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(searchTitle)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        const pool = (mediaType === 'tv' ? sData.series : sData.posters) || [];
        const found = pool.find(p => clean(p.title || p.name).toLowerCase().includes(clean(searchTitle).toLowerCase()));

        if (!found) return [];

        if (mediaType === 'movie') {
            const mRes = await fetch(`${BASE_URL}/api/movie/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const mData = await mRes.json();
            return (mData.sources || []).map(src => ({
                name: "RECTV",
                title: src.quality || "HD",
                url: src.url,
                quality: src.quality || "720p",
                headers: FULL_HEADERS
            }));
        } else {
            const snRes = await fetch(`${BASE_URL}/api/season/by/serie/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const seasons = await snRes.json();
            const targetS = seasons.find(s => (s.title.match(/\d+/) || [])[0] == season);
            const targetE = (targetS?.episodes || []).find(e => (e.title.match(/\d+/) || [])[0] == episode);
            if (targetE?.sources) {
                return targetE.sources.map(src => ({
                    name: "RECTV",
                    title: `S${season}E${episode} - ${src.quality}`,
                    url: src.url,
                    quality: src.quality || "720p",
                    headers: FULL_HEADERS
                }));
            }
        }
    } catch (e) { return []; }
    return [];
}

builder.defineStreamHandler(async ({ id, type }) => {
    if (id.startsWith("CH_")) {
        const name = id.replace("CH_", "").replace(/_/g, " ");
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(name)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        const ch = (sData.channels || []).find(c => clean(c.title || c.name).toLowerCase().includes(name.toLowerCase()));
        if (ch) {
            const res = await fetch(`${BASE_URL}/api/channel/${ch.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.quality || "LIVE", url: src.url, headers: FULL_HEADERS })) };
        }
    } else {
        const parts = id.split(':');
        const streams = await getStreams(parts[0], type === 'series' ? 'tv' : 'movie', parts[1] || null, parts[2] || null);
        return { streams };
    }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: PORT });
