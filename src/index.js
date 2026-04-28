/* --- index.js --- */
import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import { getStreams } from './scraper/rectv.js'; 

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

// ... (Katalog Map'leri aynı kalabilir) ...
const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", "Sinema": "6" };
const MOVIE_MAP = {"Aksiyon": "1", "Dram": "2" /* ... diğerleri ... */};
const SERIES_MAP = {"Netflix": "57", "HBO": "62" /* ... diğerleri ... */};
const YEARS = Array.from({ length: 30 }, (_, i) => (2026 - i).toString());

export const manifest = {
    id: "com.nuvio.rectv.v481.moon",
    version: "4.8.1",
    name: "RECTV Pro Ultimate-moon",
    description: "Canlı TV, Film ve Diziler - Kazıyıcı Debug Modu",
    logo : "https://st5.depositphotos.com/1041725/67731/v/380/depositphotos_677319750-stock-illustration-ararat-mountain-illustration-vector-white.jpg",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["CH_", "tt"],
    catalogs: [
        { id: "rc_live", type: "tv", name: "📺 RECTV Canlı TV", extra: [{ name: "search" }, { name: "genre", options: Object.keys(TV_MAP) }] },
        { id: "rc_movie", type: "movie", name: "🎬 RECTV Filmler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(MOVIE_MAP) }] },
        { id: "rc_series", type: "series", name: "🍿 RECTV Diziler", extra: [{ name: "search" }, { name: "genre", options: Object.keys(SERIES_MAP) }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI: TMDB Üzerinden IMDb ID Bulucu ---
async function findPureImdbId(title, type) {
    try {
        const sType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results?.[0]) {
            const ext = await fetch(`https://api.themoviedb.org/3/${sType}/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
            const extData = await ext.json();
            return extData.imdb_id ? extData.imdb_id.replace("tt", "") : null;
        }
    } catch (e) { return null; }
    return null;
}

// --- KATALOG VE META HANDLER ---
// (Buradaki kodların çalışıyor olduğunu varsayıyorum, asıl sorun Stream'de)

builder.defineCatalogHandler(async (args) => {
    // ... Mevcut Katalog Kodun ...
    return { metas: [] }; // (Senin kodunu buraya yapıştır)
});

builder.defineMetaHandler(async ({ id, type }) => {
    // ... Mevcut Meta Kodun ...
    return { meta: {} }; // (Senin kodunu buraya yapıştır)
});

// --- STREAM HANDLER (KRİTİK BÖLÜM) ---
builder.defineStreamHandler(async ({ id, type }) => {
    console.error(`\n[DEBUG] STREAM ISTEGI TETIKLENDI! -> ID: ${id} | TYPE: ${type}`);
    
    try {
        // Kazıyıcıya gönder
        const streams = await getStreams(type, id);
        
        if (!streams || streams.length === 0) {
            console.error(`[DEBUG] !!! KAZIYICI BOS DONDU: ${id} için kaynak bulunamadı.`);
            return { streams: [] };
        }

        console.error(`[DEBUG] ✅ BASARILI: ${id} için ${streams.length} kaynak sağlandı.`);
        return { streams: streams };
        
    } catch (e) {
        console.error("[DEBUG] !!! STREAM HANDLER HATASI:", e.message);
        return { streams: [] };
    }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT, hostname: '0.0.0.0' });
console.log(`✅ RECTV Pro Yayında: Port ${PORT}`);
