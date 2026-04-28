/* --- index.js --- */
/* BİLGİ NOTU: Gerekli modüller ve kazıyıcı (scraper) içeri aktarılıyor. */
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

const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", "Sinema": "6" };
const MOVIE_MAP = {"Aksiyon": "1", "Dram": "2", "Komedi": "3", "Korku": "8", "Bilim Kurgu": "4"};
const SERIES_MAP = {"Netflix": "57", "HBO": "62", "Disney+": "67", "Aksiyon": "1"};
const YEARS = Array.from({ length: 30 }, (_, i) => (2026 - i).toString());

export const manifest = {
    id: "com.mooncrown.rectv.ultimate",
    version: "4.8.2",
    name: "MOONCROWN RECTV Pro",
    description: "Canlı TV, Film ve Diziler - Debug Modu Aktif",
    logo: "https://st5.depositphotos.com/1041725/67731/v/380/depositphotos_677319750-stock-illustration-ararat-mountain-illustration-vector-white.jpg",
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

/* BİLGİ NOTU: TMDB üzerinden başlığa göre IMDb ID (tt...) bulan yardımcı fonksiyon. */
async function findPureImdbId(title, type) {
    try {
        const sType = type === 'series' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/search/${sType}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results?.[0]) {
            const ext = await fetch(`https://api.themoviedb.org/3/${sType}/${data.results[0].id}/external_ids?api_key=${TMDB_KEY}`);
            const extData = await ext.json();
            return extData.imdb_id ? extData.imdb_id : null;
        }
    } catch (e) { 
        console.error("TMDB ID Bulma Hatası:", e.message);
        return null; 
    }
    return null;
}

/* --- KATALOG HANDLER --- */
builder.defineCatalogHandler(async (args) => {
    const { id, type, extra } = args;
    console.error(`[KATALOG] İstek: ${id} | Tür: ${type}`);

    try {
        let fetchUrl = "";
        if (id === "rc_live") {
            const gid = (extra?.genre) ? (TV_MAP[extra.genre] || "3") : "3";
            fetchUrl = extra?.search ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` : `${BASE_URL}/api/channel/by/filtres/${gid}/0/0/${SW_KEY}/`;
        } else {
            const path = type === 'series' ? 'serie' : 'movie';
            const map = type === 'series' ? SERIES_MAP : MOVIE_MAP;
            const gid = (extra?.genre) ? (map[extra.genre] || "0") : "0";
            fetchUrl = extra?.search ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/` : `${BASE_URL}/api/${path}/by/filtres/${gid}/created/0/${SW_KEY}/`;
        }

        const res = await fetch(fetchUrl, { headers: FULL_HEADERS });
        if (!res.ok) throw new Error(`Site Yanıt Vermedi: ${res.status}`);

        const data = await res.json();
        /* BİLGİ NOTU: Siteden gelen ham verinin doğruluğunu kontrol ediyoruz. */
        console.error(`[KATALOG] Ham Veri Alındı. Karakter Sayısı: ${JSON.stringify(data).length}`);

        let rawItems = [];
        if (id === "rc_live") {
            rawItems = extra?.search ? (data.channels || []) : (Array.isArray(data) ? data : []);
        } else {
            rawItems = extra?.search ? (type === 'series' ? data.series : data.posters) : (Array.isArray(data) ? data : data.posters || []);
        }

        const metas = await Promise.all((rawItems || []).slice(0, 30).map(async (item) => {
            const title = item.title || item.name;
            if (id === "rc_live") {
                return {
                    id: `CH_${title.split(' ').join('_')}`,
                    type: "tv",
                    name: title,
                    poster: item.image || item.thumbnail,
                    posterShape: "landscape"
                };
            }
            const imdbId = await findPureImdbId(title, type);
            return {
                id: imdbId || `rc_${item.id}`,
                type: type,
                name: title,
                poster: item.image || item.thumbnail
            };
        }));

        console.error(`[KATALOG] Başarılı: ${metas.length} içerik yüklendi.`);
        return { metas: metas.filter(m => m !== null) };
    } catch (e) {
        console.error(`[KATALOG_HATA] Kritik: ${e.message}`);
        return { metas: [] };
    }
});

/* --- META HANDLER --- */
builder.defineMetaHandler(async ({ id, type }) => {
    console.error(`[META] İstek Geri: ${id}`);
    // Film/Dizi metası TMDB üzerinden çekilir, TV metası sabit döner.
    try {
        if (id.startsWith("CH_")) {
            return { meta: { id, type: "tv", name: id.replace("CH_", "").split('_').join(' '), posterShape: "landscape" }};
        }
        // Basit meta dönüşü (Geliştirmek için TMDB detay sorgusu eklenebilir)
        return { meta: { id, type, name: "Yükleniyor..." }};
    } catch (e) { return { meta: {} }; }
});

/* --- STREAM HANDLER --- */
builder.defineStreamHandler(async ({ id, type }) => {
    /* BİLGİ NOTU: Kazıyıcı tetikleniyor. Gelen veriler console.error ile izlenmeli. */
    console.error(`[STREAM] Tetiklendi! ID: ${id} | Tür: ${type}`);
    
    try {
        const streams = await getStreams(type, id);
        
        if (!streams || streams.length === 0) {
            console.error(`[STREAM] !!! KAZIYICI SONUÇ DÖNDÜRMEDİ: ${id}`);
            return { streams: [] };
        }

        console.error(`[STREAM] ✅ BAŞARI: ${streams.length} kaynak bulundu.`);
        return { streams: streams };
    } catch (e) {
        console.error(`[STREAM_HATA] Kazıyıcı Çalışırken Hata Oluştu: ${e.message}`);
        return { streams: [] };
    }
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT, hostname: '0.0.0.0' });
console.log(`✅ MOONCROWN Addon Hazır: Port ${PORT}`);
