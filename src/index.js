import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

// Eksiksiz Header Seti (RecTV güvenliğini aşmak için)
const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b',
    'Connection': 'Keep-Alive',
    'Accept-Encoding': 'gzip'
};

const manifest = {
    id: "com.nuvio.rectv.v7.final",
    version: "7.0.0",
    name: "RECTV Scraper Pro",
    description: "İsim Bazlı Tam Kazıyıcı Sistem",
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

// --- YARDIMCI ARAÇLAR ---

const cleanName = (t) => t.replace(/HD|UHD|FHD|4K/gi, "").trim();

// IMDb ID'den İsim Bulma (Kazıyıcı için en kritik adım)
async function getTitleFromImdb(imdbId) {
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();
        const meta = data.movie_results?.[0] || data.tv_results?.[0];
        return meta ? (meta.title || meta.name) : null;
    } catch (e) { return null; }
}

// Katalog için IMDb ID Bulma
async function getImdb(title, type) {
    try {
        const sType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(cleanName(title))}&language=tr-TR`;
        const data = await (await fetch(url)).json();
        if (data.results?.[0]) {
            const ext = await (await fetch(`https://api.themoviedb.org/3/${sType}/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`)).json();
            return ext.imdb_id;
        }
    } catch (e) { return null; }
}

// --- KATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        if (id === "rc_live") {
            const url = extra.search 
                ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
                : `${BASE_URL}/api/channel/by/filtres/3/0/0/${SW_KEY}/`;
            const data = await (await fetch(url, { headers: FULL_HEADERS })).json();
            const channels = extra.search ? (data.channels || []) : data;

            return {
                metas: channels.map(ch => ({
                    id: `CH_${cleanName(ch.title || ch.name).replace(/\s+/g, '_')}`,
                    type: "tv",
                    name: cleanName(ch.title || ch.name),
                    poster: ch.image, // CANLI TV POSTERİ UNUTULMADI
                    posterShape: "landscape"
                }))
            };
        }

        const path = type === 'series' ? 'serie' : 'movie';
        const url = extra.search 
            ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
            : `${BASE_URL}/api/${path}/by/filtres/0/created/0/${SW_KEY}/`;

        const data = await (await fetch(url, { headers: FULL_HEADERS })).json();
        const rawItems = extra.search ? (type === 'series' ? data.series : data.posters) : (Array.isArray(data) ? data : data.posters || []);

        const metas = await Promise.all((rawItems || []).slice(0, 10).map(async (item) => {
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

// --- META HANDLER ---
builder.defineMetaHandler(async ({ type, id }) => {
    if (id.startsWith("CH_")) {
        const name = id.replace("CH_", "").replace(/_/g, " ");
        return { meta: { id, type: 'tv', name: name, posterShape: 'landscape' }};
    }
    
    try {
        const imdbId = id.split(':')[0];
        const res = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`);
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
                    meta.videos.push({ id: `${imdbId}:${s.season_number}:${i}`, title: `S${s.season_number} E${i}`, season: s.season_number, episode: i });
                }
            });
        } else {
            meta.videos.push({ id, title: obj.title });
        }
        return { meta };
    } catch (e) { return { meta: { id, type, name: "Yüklenemedi" } }; }
});

// --- STREAM HANDLER (SAKLI KAZIYICI MANTIĞI) ---
builder.defineStreamHandler(async ({ id, type }) => {
    try {
        let searchTitle = "";

        // 1. CANLI TV İÇİN İSİM BELİRLE
        if (id.startsWith("CH_")) {
            searchTitle = id.replace("CH_", "").replace(/_/g, " ");
        } else {
            // 2. FİLM/DİZİ İÇİN IMDb'DEN İSİM ÇEK
            searchTitle = await getTitleFromImdb(id.split(':')[0]);
        }

        if (!searchTitle) return { streams: [] };

        // 3. RECTV ARAMA (KAZIYICI BURADA DEVREYE GİRER)
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(searchTitle)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        
        if (id.startsWith("CH_")) {
            const ch = (sData.channels || []).find(c => cleanName(c.title || c.name).toLowerCase().includes(searchTitle.toLowerCase()));
            if (ch) {
                const res = await fetch(`${BASE_URL}/api/channel/${ch.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                const data = await res.json();
                return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.quality || "LIVE", url: src.url })) };
            }
        } else {
            const pool = (type === 'series' ? sData.series : sData.posters) || [];
            const found = pool.find(p => cleanName(p.title || p.name).toLowerCase().includes(cleanName(searchTitle).toLowerCase()));

            if (found) {
                if (type === 'movie') {
                    const res = await fetch(`${BASE_URL}/api/movie/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                    const data = await res.json();
                    return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.quality || "Film", url: src.url })) };
                } else {
                    const [, sNum, eNum] = id.split(':');
                    const res = await fetch(`${BASE_URL}/api/season/by/serie/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
                    const seasons = await res.json();
                    const season = seasons.find(s => (s.title.match(/\d+/) || [])[0] == sNum);
                    const episode = (season?.episodes || []).find(e => (e.title.match(/\d+/) || [])[0] == eNum);
                    
                    if (episode?.sources) {
                        return { streams: episode.sources.map(src => ({ name: "RECTV", title: src.quality || "Dizi", url: src.url })) };
                    }
                }
            }
        }
    } catch (e) { console.error("Scraper Hatası:", e); }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: PORT });
