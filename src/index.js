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

const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", "Sinema": "6" };

const manifest = {
    id: "com.nuvio.rectv.v485.final",
    version: "4.8.5",
    name: "RECTV Pro Scraper-Mode",
    description: "IMDb ID -> İsim -> RecTV Kaynak Dönüştürücü",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["CH_", "tt"],
    catalogs: [
        { id: "rc_live", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "genre", options: Object.keys(TV_MAP) }, { name: "search" }] },
        { id: "rc_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }] },
        { id: "rc_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR ---

// Nuvio'ya göstermek için RecTV ismini IMDb ID'sine çevirir
async function nameToImdb(title, type) {
    try {
        const sType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results?.[0]) {
            const ext = await fetch(`https://api.themoviedb.org/3/${sType}/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
            const extData = await ext.json();
            return extData.imdb_id || null;
        }
    } catch (e) { return null; }
    return null;
}

// Scraper mantığı: IMDb ID'yi RecTV'de aratmak için isme çevirir
async function imdbToName(imdbId) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();
        const obj = data.movie_results?.[0] || data.tv_results?.[0];
        return obj ? (obj.title || obj.name) : null;
    } catch (e) { return null; }
}

// --- HANDLERS ---

builder.defineCatalogHandler(async ({ id, type, extra }) => {
    try {
        if (id === "rc_live") {
            const gid = (extra?.genre) ? (TV_MAP[extra.genre] || "3") : "3";
            const tvUrl = extra?.search 
                ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` 
                : `${BASE_URL}/api/channel/by/filtres/${gid}/0/0/${SW_KEY}/`;
            
            const res = await fetch(tvUrl, { headers: FULL_HEADERS });
            const data = await res.json();
            const channels = extra?.search ? (data.channels || []) : (Array.isArray(data) ? data : []);

            return {
                metas: channels.map(ch => ({
                    id: `CH_${(ch.title || ch.name).replace(/\s+/g, '_')}`,
                    type: "tv",
                    name: ch.title || ch.name,
                    poster: ch.image,
                    posterShape: "landscape"
                }))
            };
        }

        const path = type === 'series' ? 'serie' : 'movie';
        let fetchUrl = extra?.search 
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${path}/by/filtres/0/created/0/${SW_KEY}/`;

        const res = await fetch(fetchUrl, { headers: FULL_HEADERS });
        const data = await res.json();
        const rawItems = extra?.search ? (type === 'series' ? data.series : data.posters) : (Array.isArray(data) ? data : data.posters || []);

        const metas = await Promise.all((rawItems || []).slice(0, 15).map(async (item) => {
            const title = item.title || item.name;
            const imdbId = await nameToImdb(title, type);
            if (!imdbId) return null;
            return {
                id: type === 'series' ? `${imdbId}:1:1` : imdbId,
                type: type,
                name: title,
                poster: item.image || item.thumbnail
            };
        }));
        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

builder.defineMetaHandler(async ({ id, type }) => {
    if (id.startsWith("CH_")) {
        const name = id.replace("CH_", "").replace(/_/g, ' ');
        return { meta: { id, type: "tv", name, posterShape: "landscape", poster: "https://i.ibb.co/rt6L58P/tv.png" }};
    }
    // Nuvio'ya IMDb üzerinden meta datası göster
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

        if (type === 'movie') {
            meta.videos.push({ id, title: obj.title });
        } else {
            const detail = await (await fetch(`https://api.themoviedb.org/3/tv/${obj.id}?api_key=${TMDB_KEY}&language=tr-TR`)).json();
            detail.seasons?.forEach(s => {
                if (s.season_number > 0) {
                    for (let i = 1; i <= s.episode_count; i++) {
                        meta.videos.push({ id: `${pureId}:${s.season_number}:${i}`, title: `S${s.season_number}E${i}`, season: s.season_number, episode: i });
                    }
                }
            });
        }
        return { meta };
    } catch (e) { return { meta: { id, type, name: "Hata" } }; }
});

builder.defineStreamHandler(async ({ id, type }) => {
    try {
        // 1. CANLI TV
        if (id.startsWith("CH_")) {
            const channelName = id.replace("CH_", "").replace(/_/g, ' ');
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(channelName)}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const sData = await sRes.json();
            const ch = (sData.channels || []).find(c => (c.title || c.name).replace(/\s+/g, '_') === id.replace("CH_", ""));
            if (ch) {
                const res = await fetch(`${BASE_URL}/api/channel/${ch.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                const data = await res.json();
                return { streams: (data.sources || []).map(src => ({ name: "RECTV LIVE", title: src.quality || "HD", url: src.url })) };
            }
        }

        // 2. KAZIYICI MANTIGI (IMDb -> İsim -> RecTV Search)
        const pureId = id.split(':')[0];
        const title = await imdbToName(pureId);

        if (title) {
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const sData = await sRes.json();
            const pool = (type === 'series' ? sData.series : sData.posters) || [];
            
            // RecTV sonuçlarında isme göre eşleşen asıl içeriği bul
            const found = pool.find(p => (p.title || p.name).toLowerCase().includes(title.toLowerCase().split(':')[0]));

            if (found) {
                if (type === 'movie') {
                    const res = await fetch(`${BASE_URL}/api/movie/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                    const data = await res.json();
                    return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.quality || "HD", url: src.url })) };
                } else {
                    // Dizi için Sezon/Bölüm eşleştirme
                    const [, sNum, eNum] = id.split(':');
                    const res = await fetch(`${BASE_URL}/api/season/by/serie/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                    const seasons = await res.json();
                    const targetSeason = seasons.find(s => (s.title.match(/\d+/) || [])[0] == sNum);
                    const targetEpisode = (targetSeason?.episodes || []).find(e => (e.title.match(/\d+/) || [])[0] == eNum);

                    if (targetEpisode?.sources) {
                        return { streams: targetEpisode.sources.map(src => ({ name: "RECTV", title: src.quality || "HD", url: src.url })) };
                    }
                }
            }
        }
    } catch (e) { console.error("Stream Hatası:", e); }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: PORT });
