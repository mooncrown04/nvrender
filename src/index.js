import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

// --- MANIFEST ---
const manifest = {
    id: "com.nuvio.rectv.ultimate.fix",
    version: "5.1.0",
    name: "RECTV Ultimate Scraper",
    description: "IMDb ID Üzerinden Tam Kazıyıcı (Film, Dizi, TV)",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["tt", "CH_"],
    catalogs: [
        { id: "rc_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }] },
        { id: "rc_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }] },
        { id: "rc_live", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR (KAZIYICI MOTORU) ---

async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        return await res.text();
    } catch (e) { return null; }
}

async function getImdbFromTitle(title, type) {
    try {
        const sType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`;
        const data = await (await fetch(url)).json();
        if (data.results?.[0]) {
            const ext = await (await fetch(`https://api.themoviedb.org/3/${sType}/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`)).json();
            return ext.imdb_id;
        }
    } catch (e) { return null; }
}

async function getTitleFromImdb(imdbId) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const data = await (await fetch(url)).json();
        const meta = data.movie_results?.[0] || data.tv_results?.[0];
        return meta ? (meta.title || meta.name) : null;
    } catch (e) { return null; }
}

// --- KATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        let items = [];
        if (id === "rc_live") {
            const tvUrl = extra.search 
                ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` 
                : `${BASE_URL}/api/channel/by/filtres/3/0/0/${SW_KEY}/`;
            const data = await (await fetch(tvUrl, { headers: HEADERS })).json();
            items = extra.search ? (data.channels || []) : data;
            return { metas: items.map(ch => ({
                id: `CH_${ch.id}`, type: "tv", name: ch.title || ch.name, poster: ch.image, posterShape: "landscape"
            }))};
        }

        const path = type === 'series' ? 'serie' : 'movie';
        const url = extra.search 
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${path}/by/filtres/0/created/0/${SW_KEY}/`;

        const data = await (await fetch(url, { headers: HEADERS })).json();
        const rawItems = extra.search ? (type === 'series' ? data.series : data.posters) : (Array.isArray(data) ? data : data.posters || []);

        const metas = await Promise.all((rawItems || []).slice(0, 15).map(async (item) => {
            const imdb = await getImdbFromTitle(item.title || item.name, type);
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

// --- META HANDLER ---
builder.defineMetaHandler(async ({ type, id }) => {
    if (id.startsWith("CH_")) return { meta: { id, type: 'tv', name: "Canlı Kanal", posterShape: 'landscape' }};
    
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
            for (const s of detail.seasons || []) {
                if (s.season_number > 0) {
                    for (let i = 1; i <= s.episode_count; i++) {
                        meta.videos.push({ id: `${pureId}:${s.season_number}:${i}`, title: `S${s.season_number} E${i}`, season: s.season_number, episode: i });
                    }
                }
            }
        } else {
            meta.videos.push({ id, title: obj.title });
        }
        return { meta };
    } catch (e) { return { meta: { id, type, name: "Yüklenemedi" } }; }
});

// --- STREAM HANDLER (KAZIYICI) ---
builder.defineStreamHandler(async ({ id, type }) => {
    try {
        // 1. CANLI TV KAZIMA
        if (id.startsWith("CH_")) {
            const chId = id.split('_')[1];
            const res = await fetch(`${BASE_URL}/api/channel/${chId}/${SW_KEY}/`, { headers: HEADERS });
            const data = await res.json();
            return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.quality || "HD", url: src.url })) };
        }

        // 2. FİLM/DİZİ KAZIMA (IMDb -> İsim -> RecTV)
        const parts = id.split(':');
        const imdbId = parts[0];
        const title = await getTitleFromImdb(imdbId);
        
        if (title) {
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: HEADERS });
            const sData = await sRes.json();
            const pool = (type === 'series' ? sData.series : sData.posters) || [];
            const target = pool.find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase().split(':')[0]));

            if (target) {
                if (type === 'movie') {
                    const res = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
                    const data = await res.json();
                    return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.quality || "HD", url: src.url })) };
                } else {
                    const sNum = parts[1];
                    const eNum = parts[2];
                    const res = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: HEADERS });
                    const seasons = await res.json();
                    const season = seasons.find(s => (s.title.match(/\d+/) || [])[0] == sNum);
                    const episode = (season?.episodes || []).find(e => (e.title.match(/\d+/) || [])[0] == eNum);
                    
                    if (episode?.sources) {
                        return { streams: episode.sources.map(src => ({ name: "RECTV", title: src.quality || "HD", url: src.url })) };
                    }
                }
            }
        }
    } catch (e) { console.error("Hata:", e); }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: PORT });
