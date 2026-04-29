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

const manifest = {
    id: "com.nuvio.rectv.v5.2.final",
    version: "5.2.0",
    name: "RECTV Pro Scraper",
    description: "Canlı TV (Logolu) + Film/Dizi Kazıyıcı",
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

// --- YARDIMCI MOTOR (İÇ MANTIK) ---

// Başlıktaki "HD" gibi ekleri temizler
const cleanTitle = (t) => t.replace(/HD|UHD|FHD/gi, "").trim();

// TMDB ID Dönüştürücüler
async function getImdbFromTitle(title, type) {
    try {
        const sType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(cleanTitle(title))}&language=tr-TR`;
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
        if (id === "rc_live") {
            const url = extra.search 
                ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
                : `${BASE_URL}/api/channel/by/filtres/3/0/0/${SW_KEY}/`;
            const data = await (await fetch(url, { headers: HEADERS })).json();
            const channels = extra.search ? (data.channels || []) : data;

            return {
                metas: channels.map(ch => ({
                    id: `CH_${cleanTitle(ch.title || ch.name).replace(/\s+/g, '_')}`,
                    type: "tv",
                    name: cleanTitle(ch.title || ch.name),
                    poster: ch.image, // Kanal logosu buradan geliyor
                    posterShape: "landscape"
                }))
            };
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
        } else {
            meta.videos.push({ id, title: obj.title });
        }
        return { meta };
    } catch (e) { return { meta: { id, type, name: "Yüklenemedi" } }; }
});

// --- STREAM HANDLER (KAZIYICI) ---
builder.defineStreamHandler(async ({ id, type }) => {
    try {
        // 1. CANLI TV KAZIYICI (İsmi al, RecTV'de ara, orijinal ID ile linki çek)
        if (id.startsWith("CH_")) {
            const searchName = id.replace("CH_", "").replace(/_/g, " ");
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(searchName)}/${SW_KEY}/`, { headers: HEADERS });
            const sData = await sRes.json();
            const ch = (sData.channels || []).find(c => cleanTitle(c.title || c.name) === searchName);
            
            if (ch) {
                const res = await fetch(`${BASE_URL}/api/channel/${ch.id}/${SW_KEY}/`, { headers: HEADERS });
                const data = await res.json();
                return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.quality || "HD", url: src.url })) };
            }
        }

        // 2. FİLM/DİZİ KAZIYICI (IMDb ID -> İsim -> RecTV Arama)
        const parts = id.split(':');
        const title = await getTitleFromImdb(parts[0]);
        
        if (title) {
            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`, { headers: HEADERS });
            const sData = await sRes.json();
            const pool = (type === 'series' ? sData.series : sData.posters) || [];
            const found = pool.find(p => cleanTitle(p.title || p.name).toLowerCase().includes(cleanTitle(title).toLowerCase()));

            if (found) {
                if (type === 'movie') {
                    const res = await fetch(`${BASE_URL}/api/movie/${found.id}/${SW_KEY}/`, { headers: HEADERS });
                    const data = await res.json();
                    return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.quality || "HD", url: src.url })) };
                } else {
                    const res = await fetch(`${BASE_URL}/api/season/by/serie/${found.id}/${SW_KEY}/`, { headers: HEADERS });
                    const seasons = await res.json();
                    const season = seasons.find(s => (s.title.match(/\d+/) || [])[0] == parts[1]);
                    const episode = (season?.episodes || []).find(e => (e.title.match(/\d+/) || [])[0] == parts[2]);
                    
                    if (episode?.sources) {
                        return { streams: episode.sources.map(src => ({ name: "RECTV", title: src.quality || "HD", url: src.url })) };
                    }
                }
            }
        }
    } catch (e) { console.error("Kazıyıcı Hatası:", e); }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: PORT });
