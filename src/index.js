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

// --- YARDIMCI FONKSİYONLAR ---

// Eğer bir token sistemin yoksa boş döner, varsa burayı doldurabilirsin
async function getAuthToken() {
    return null; 
}

function analyzeStream(url, index, label = "") {
    const text = label || "HLS Kaynağı";
    let icon = "🔗";
    if (text.toLowerCase().includes("dublaj")) icon = "🇹🇷";
    if (text.toLowerCase().includes("altyazı")) icon = "💬";
    return { icon, text };
}

// --- ANA AKIŞ FONKSİYONU (YENİ EKLEDİĞİN MANTIK) ---
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    try {
        const isMovie = (mediaType === 'movie');
        const tmdbUrl = `https://api.themoviedb.org/3/${isMovie ? 'movie' : 'tv'}/${tmdbId}?language=tr-TR&api_key=${TMDB_KEY}`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        
        const trTitle = (tmdbData.title || tmdbData.name || "").trim();
        const orgTitle = (tmdbData.original_title || tmdbData.original_name || "").trim();
        
        if (!trTitle) return [];

        const token = await getAuthToken();
        const searchHeaders = token ? { ...FULL_HEADERS, 'Authorization': 'Bearer ' + token } : FULL_HEADERS;
        
        let searchQueries = [trTitle];
        if (isMovie && orgTitle && orgTitle !== trTitle) searchQueries.push(orgTitle);

        let allItems = [];
        for (let q of searchQueries) {
            const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(q)}/${SW_KEY}/`;
            const sRes = await fetch(searchUrl, { headers: searchHeaders });
            const sData = await sRes.json();
            const found = (sData.series || []).concat(sData.posters || []);
            if (found.length > 0) {
                allItems = allItems.concat(found);
                if (isMovie) break; 
            }
        }

        let finalResults = [];

        for (let target of allItems) {
            const targetTitleLower = (target.title || target.name || "").toLowerCase().trim();
            const searchTitleLower = trTitle.toLowerCase().trim();
            const orgTitleLower = orgTitle.toLowerCase().trim();
            let isMatch = false;

            if (isMovie) {
                const isLengthOk = targetTitleLower.length <= searchTitleLower.length + 5; 
                const isExact = targetTitleLower === searchTitleLower || targetTitleLower === orgTitleLower;
                isMatch = isExact || (targetTitleLower.includes(searchTitleLower) && isLengthOk);
            } else {
                if (searchTitleLower === "from") {
                    isMatch = (targetTitleLower === "from" || targetTitleLower === "from dizi");
                } else {
                    isMatch = targetTitleLower.includes(searchTitleLower) || targetTitleLower.includes(orgTitleLower);
                }
            }

            if (!isMatch) continue;

            const isActuallySerie = target.type === "serie" || (target.label && target.label.toLowerCase().includes("dizi"));
            if (isMovie && isActuallySerie) continue;
            if (!isMovie && !isActuallySerie) continue;

            if (isActuallySerie) {
                const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: searchHeaders });
                const seasons = await seasonRes.json();
                for (let s of seasons) {
                    let sNumber = parseInt(s.title.match(/\d+/) || 0);
                    if (sNumber == seasonNum) {
                        for (let ep of (s.episodes || [])) {
                            let epNumber = parseInt(ep.title.match(/\d+/) || 0);
                            if (epNumber == episodeNum) {
                                (ep.sources || []).forEach((src, idx) => {
                                    const streamInfo = analyzeStream(src.url, idx, ep.label || s.title);
                                    finalResults.push({
                                        name: "RECTV", 
                                        title: `⌜ RECTV ⌟ | ${streamInfo.icon} ${streamInfo.text}\n${src.title || ''}`,
                                        url: src.url,
                                        headers: { 'User-Agent': 'googleusercontent', 'Referer': 'https://twitter.com/' }
                                    });
                                });
                            }
                        }
                    }
                }
            } else {
                const detRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: searchHeaders });
                const detData = await detRes.json();
                (detData.sources || []).forEach((src, idx) => {
                    const streamInfo = analyzeStream(src.url, idx, target.label);
                    finalResults.push({
                        name: "RECTV",
                        title: `⌜ RECTV ⌟ | ${streamInfo.icon} ${streamInfo.text}\n${src.title || ''}`,
                        url: src.url,
                        headers: { 'User-Agent': 'googleusercontent', 'Referer': 'https://twitter.com/' }
                    });
                });
            }
        }

        return finalResults.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);
    } catch (err) { 
        return []; 
    }
}

// --- MANIFEST VE KATALOGLAR (DEĞİŞMEDİ) ---
const MOVIE_MAP = {"Aksiyon": "1","Aile": "14","Animasyon": "13","Belgesel": "19","Bilim Kurgu": "4","Bilim-Kurgu": "28","Dram": "2","Fantastik": "10","Gerilim": "9","Gizem": "15","Komedi": "3","Korku": "8","Macera": "17","Polisiye - Suç": "7","Romantik": "5","Savaş": "32","Seri Filmler": "43","Suç": "22","Tarih": "21","Yerli Dizi / Film": "23"};
const SERIES_MAP = {"Aksiyon": "1","Animasyon": "13","Belgesel": "19","Bilim Kurgu": "4","Dram": "2","Komedi": "3","Korku": "8","Macera": "17","Netflix": "57","Yerli Dizi / Film": "23"};  
const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", "Sinema": "6" };

export const manifest = {
    id: "com.nuvio.rectv.v481.ultimate",
    version: "4.8.1",
    name: "RECTV Pro Ultimate",
    description: "Yeni Gelişmiş Arama Motoru ile RECTV İçerikleri",
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

// --- KATALOG VE META HANDLER (ESKİ YAPIN KALSIN) ---
builder.defineCatalogHandler(async (args) => {
    // Katalog kodun burada (kısalık için aynen korunduğunu varsayıyorum)
    return { metas: [] }; // Mevcut katalog kodunu buraya yapıştırabilirsin
});

builder.defineMetaHandler(async ({ id, type }) => {
    // Meta (TMDB Find) kodun burada
    return { meta: {} }; // Mevcut meta kodunu buraya yapıştırabilirsin
});

// --- YENİ STREAM HANDLER (ENTREGRASYON NOKTASI) ---
builder.defineStreamHandler(async (args) => {
    const { id, type } = args;

    // 1. Canlı TV Akışı
    if (id.startsWith("CH_")) {
        const channelName = id.replace("CH_", "").replace(/_/g, ' ');
        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(channelName)}/${SW_KEY}/`, { headers: FULL_HEADERS });
        const sData = await sRes.json();
        const found = (sData.channels || []).find(c => (c.title || c.name).replace(/\s+/g, '_') === id.replace("CH_", ""));
        if (found) {
            const res = await fetch(`${BASE_URL}/api/channel/${found.id}/${SW_KEY}/`, { headers: FULL_HEADERS });
            const data = await res.json();
            return { streams: (data.sources || []).map(src => ({ name: "RECTV", title: src.title, url: src.url })) };
        }
    } 
    
    // 2. Film ve Dizi Akışı (Senin Yeni getStreams Fonksiyonun)
    if (id.startsWith("tt")) {
        const parts = id.split(':');
        const tmdbId = parts[0].replace("tt", ""); // ID'yi temizle
        const season = parts[1] || 1;
        const episode = parts[2] || 1;

        const results = await getStreams(tmdbId, type, season, episode);
        return { streams: results };
    }

    return { streams: [] };
});

const addonInterface = builder.getInterface();
serveHTTP(addonInterface, { port: PORT });
