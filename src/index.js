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
    id: "com.nuvio.rectv.dual.id",
    version: "6.0.0",
    name: "RECTV Dual-ID Scraper",
    description: "Cihaz için IMDb, Kazıyıcı için Rec-ID Sistemi",
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

// --- KAZIYICI MOTORU (SCRAPER ENGINE) ---

// İsmi temizle (HD/UHD ve gereksiz boşluklar)
const clean = (t) => t.replace(/HD|UHD|FHD|4K/gi, "").trim();

async function getImdb(title, type) {
    try {
        const sType = type === 'series' ? 'tv' : 'movie';
        const res = await fetch(`https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(clean(title))}&language=tr-TR`);
        const data = await res.json();
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
            
            const data = await (await fetch(url, { headers: HEADERS })).json();
            const channels = extra.search ? (data.channels || []) : data;

            return {
                metas: channels.map(ch => ({
                    // ÇİFT ID: CH_ + Kanal Adı + ___ + Gerçek ID (Scraper için saklıyoruz)
                    id: `CH_${clean(ch.title || ch.name).replace(/\s+/g, '_')}___${ch.id}`,
                    type: "tv",
                    name: clean(ch.title || ch.name),
                    poster: ch.image, // Nuvio poster arar
                    logo: ch.image,   // Bazı cihazlar logo arar
                    background: ch.image,
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
            const imdb = await getImdb(item.title || item.name, type);
            if (!imdb) return null;
            // ÇİFT ID: tt... + ___ + Gerçek ID
            const dualId = type === 'series' ? `${imdb}:1:1___${item.id}` : `${imdb}___${item.id}`;
            return {
                id: dualId,
                type: type,
                name: item.title || item.name,
                poster: item.image || item.thumbnail,
                background: item.image || item.thumbnail
            };
        }));
        return { metas: metas.filter(m => m !== null) };
    } catch (e) { return { metas: [] }; }
});

// --- META HANDLER ---
builder.defineMetaHandler(async ({ type, id }) => {
    // ID'yi parçala (Cihaz tarafı ___ öncesini görür, biz tamamını kullanırız)
    const [stremioId, realId] = id.split('___');

    if (stremioId.startsWith("CH_")) {
        const name = stremioId.replace("CH_", "").replace(/_/g, " ");
        return { meta: { id, type: 'tv', name: name, posterShape: 'landscape' }};
    }
    
    try {
        const imdbId = stremioId.split(':')[0];
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
                    // Videolarda da Dual-ID yapısını koruyoruz
                    meta.videos.push({ 
                        id: `${imdbId}:${s.season_number}:${i}___${realId}`, 
                        title: `S${s.season_number} E${i}`, 
                        season: s.season_number, 
                        episode: i 
                    });
                }
            });
        } else {
            meta.videos.push({ id, title: obj.title });
        }
        return { meta };
    } catch (e) { return { meta: { id, type, name: "Yüklenemedi" } }; }
});

// --- STREAM HANDLER (ASIL KAZIYICI) ---
builder.defineStreamHandler(async ({ id, type }) => {
    try {
        // ID'den Gerçek RecTV ID'sini çekiyoruz
        const [stremioId, realId] = id.split('___');
        
        if (!realId) return { streams: [] };

        // 1. CANLI TV KAZIMA (Doğrudan realId ile)
        if (stremioId.startsWith("CH_")) {
            const res = await fetch(`${BASE_URL}/api/channel/${realId}/${SW_KEY}/`, { headers: HEADERS });
            const data = await res.json();
            return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.quality || "LIVE", url: src.url })) };
        }

        // 2. FİLM/DİZİ KAZIMA (RealId ile doğrudan nokta atışı)
        if (type === 'movie') {
            const res = await fetch(`${BASE_URL}/api/movie/${realId}/${SW_KEY}/`, { headers: HEADERS });
            const data = await res.json();
            return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.quality || "Film", url: src.url })) };
        } else {
            // Dizi için sezon/bölüm bulma
            const parts = stremioId.split(':');
            const sNum = parts[1];
            const eNum = parts[2];
            
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${realId}/${SW_KEY}/`, { headers: HEADERS });
            const seasons = await res.json();
            const season = seasons.find(s => (s.title.match(/\d+/) || [])[0] == sNum);
            const episode = (season?.episodes || []).find(e => (e.title.match(/\d+/) || [])[0] == eNum);
            
            if (episode?.sources) {
                return { streams: episode.sources.map(src => ({ name: "RECTV", title: src.quality || "Dizi", url: src.url })) };
            }
        }
    } catch (e) { console.error("Kazıma Hatası:", e); }
    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: PORT });
