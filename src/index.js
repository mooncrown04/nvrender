import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';
import crypto from 'crypto';

console.error("[ADDON_INIT] RECTV Ultimate Addon baslatiliyor...");

// --- SABİT VERİLER ---
const MOVIE_MAP = {"Aksiyon": "1","Aile": "14","Animasyon": "13","Belgesel": "19","Bilim Kurgu": "4","Bilim-Kurgu": "28","Dram": "2","Fantastik": "10",
  "Gerilim": "9","Gizem": "15","Komedi": "3","Korku": "8","Macera": "17","Polisiye - Suç": "7","Romantik": "5","Savaş": "32","Seri Filmler": "43","Suç": "22",
  "Şarj Bitiren İçerikler": "42","Tarih": "21","Tarihi ve Savaş": "12","TV film": "29","Türkçe Altyazı": "27","Türkçe Dublaj": "26","Vahşi Batı": "35","Yerli Dizi / Film": "23"};

const SERIES_MAP = {"ABC": "59","Aksiyon": "1","Aksiyon & Macera": "31","Adult Swim": "49","Aile": "14","Animasyon": "13","Apple TV+": "51","BBC One": "54",
  "Belgesel": "19","bilibili": "74","Bilim Kurgu": "4","Bilim-Kurgu": "28","Bilim Kurgu & Fantazi": "30","Cartoon Network": "68","CBS": "52","Cinemax": "56",
  "Çocuklar": "34","Disney+": "67","Disney Channel": "65","Dram": "2","Fantastik": "10","FOX": "53","Fuji TV": "72","Gerçeklik": "36","Gerilim": "9",
  "Gizem": "15","Hallmark Channel": "50","HBO": "62","HBO Brasil": "66","Komedi": "3","Korku": "8","Macera": "17","NBC": "55","Netflix": "57",
  "NHK Educational TV": "60","NIPPON TV": "63","Pembe Dizi": "37","Polisiye - Suç": "7","Romantik": "5","Savaş": "32","Savaş & Politik": "33","Showtime": "58",
  "Suç": "22","Syfy": "61","Şarj Bitiren İçerikler": "42","Talk": "39","Tarih": "21","Tarihi ve Savaş": "12","TSC": "69","TV Tokyo": "71","Vahşi Batı": "35","Western": "25","Yerli Dizi / Film": "23"};  

const TV_MAP = { "Spor": "1", "Belgesel": "2", "Ulusal": "3", "Haber": "4", "Sinema": "6" };

const YEARS = Array.from({ length: 30 }, (_, i) => (2026 - i).toString());

// --- YAPILANDIRMA AYARLARI ---
const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const HMAC_KEY = "3508611138826751fdf77beaa6f93eb93fd27e6a5acb910e7aad22665513dd6e";
const APP_VERSION = "141";
const CLIENT_ID = "rectv-android";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

const PLAYER_HEADERS = {
    'User-Agent': 'googleusercontent',
    'Referer': 'https://twitter.com/',
    'Accept-Encoding': 'identity'
};

// --- ADDON MANİFESTOSU ---
const manifest = {
    id: "com.mooncrown.rectv.v23",
    version: "8.6.0",
    name: "RECTV Ultimate",
    description: "dizi-film",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv_", "tt", "CH_", "tmdb:"],
    catalogs: [
        { 
            id: "rc_live", 
            type: "tv", 
            name: "RECTV Canlı TV",
            extra: [
                { name: "search" },
                { name: "genre", options: Object.keys(TV_MAP) }
            ]
        },
        { 
            id: "rc_movie", 
            type: "movie", 
            name: "RECTV Filmler", 
            extra: [
                { name: "search" }, 
                { name: "skip" },
                { name: "genre", options: Object.keys(MOVIE_MAP) }
            ] 
        },
        { 
            id: "rc_series", 
            type: "series", 
            name: "RECTV Diziler", 
            extra: [
                { name: "search" }, 
                { name: "skip" },
                { name: "genre", options: Object.keys(SERIES_MAP) }
            ] 
        }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI & HMAC FONKSİYONLARI ---

var cachedToken = null;

async function getAuthToken() {
    if (cachedToken) {
        return cachedToken;
    }
    try {
        console.error("[SCRAPER_AUTH] Token isteniyor...");
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const text = await res.text();
        try {
            const json = JSON.parse(text);
            cachedToken = json.nonce || json.accessToken || text.trim();
        } catch (e) { 
            cachedToken = text.trim(); 
        }
        console.error("[SCRAPER_AUTH] Token basariyla alindi.");
        return cachedToken;
    } catch (e) { 
        console.error("[SCRAPER_ERROR] Token alma hatasi: " + e.message);
        return null; 
    }
}

function sha256Hex(data) {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256Hex(key, message) {
    return crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(message, 'utf8').digest('hex');
}

async function signedHeaders(method, path, body = "") {
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomUUID();
    const bodyHash = sha256Hex(body);
    const message = `${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`;
    const signature = hmacSha256Hex(HMAC_KEY, message);

    const token = await getAuthToken();

    const headers = {
        ...HEADERS,
        'X-Timestamp': ts,
        'X-Nonce': nonce,
        'X-Signature': signature,
        'X-App-Version': APP_VERSION,
        'X-Client-Id': CLIENT_ID
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    console.error(`[SCRAPER_SIGN] İmzalandı -> Yol: ${path}`);
    return headers;
}

function getCleanId(id) {
    if (!id) return "";
    return id.split(':').shift()
             .replace('rectv_movie_', '')
             .replace('rectv_series_', '')
             .replace('tmdb:', '')
             .replace('tt', '')
             .split('_').pop();
}

// --- 1. KATALOG İŞLEYİCİ (Catalog Handler) ---

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.error(`[CATALOG_START] Tip: ${type} | ID: ${id} | Arama: ${extra?.search || 'Yok'}`);
    try {
        let urlPath;
        
        if (id === "rc_live" || type === "tv") {
            if (extra?.search) {
                urlPath = `/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            } else if (extra?.genre) {
                const genreId = TV_MAP[extra.genre] || "6";
                urlPath = `/api/channel/by/filtres/${genreId}/0/0/${SW_KEY}/`;
            } else {
                urlPath = `/api/channel/by/filtres/6/0/0/${SW_KEY}/`;
            }
        } 
        else if (extra?.search) {
            urlPath = `/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else {
            let rectvType = (type === 'series') ? 'serie' : 'movie';
            let genreId = "0";
            
            if (extra?.genre) {
                if (type === 'movie') genreId = MOVIE_MAP[extra.genre] || "0";
                else if (type === 'series') genreId = SERIES_MAP[extra.genre] || "0";
            }

            urlPath = `/api/${rectvType}/by/filtres/${genreId}/created/${extra?.skip || 0}/${SW_KEY}/`;
        }
        
        const reqHeaders = await signedHeaders("GET", urlPath);
        const res = await fetch(`${BASE_URL}${urlPath}`, { headers: reqHeaders });
        const data = await res.json();
        
        const items = [];
        if (data.channels) data.channels.forEach(i => items.push({ ...i, _origin: 'tv' }));
        if (data.posters) data.posters.forEach(i => items.push({ ...i, _origin: 'movie' }));
        if (data.series) data.series.forEach(i => items.push({ ...i, _origin: 'series' }));
        
        if (items.length === 0 && Array.isArray(data)) {
            data.forEach(i => items.push({ ...i, _origin: type }));
        }

        let filteredItems = items.filter(item => {
            const apiType = item.type; 
            if (id === "rc_live" || type === "tv") {
                return (apiType === "channel" || apiType === "m3u8" || item._origin === 'tv');
            }
            if (type === "movie") {
                return (apiType === "movie" || item._origin === 'movie') && item.is_series !== 1;
            }
            if (type === "series") {
                return (apiType === "serie" || item._origin === 'series');
            }
            return true;
        });

        console.error(`[CATALOG_RESULT] Bulunan toplam öğe: ${filteredItems.length}`);
        return { 
            metas: filteredItems.map(item => {
                let actualType;
                if (item.type === "movie") {
                    actualType = "movie";
                } else if (item.type === "serie" || item.is_series === 1 || item._origin === 'series') {
                    actualType = "series";
                } else if (item.type === "channel" || item.type === "m3u8" || item._origin === 'tv') {
                    actualType = "tv";
                } else {
                    actualType = type;
                }

                return { 
                    id: (actualType === "tv") ? `CH_${item.id}` : `rectv_${actualType}_${item.id}`, 
                    type: actualType, 
                    name: item.title, 
                    poster: item.image,
                    background: item.image,                     
                    description: (item.categories && item.categories.length > 0) 
                    ? `Kategori: ${item.categories.map(c => c.title).join(', ')}` 
                    : (extra?.genre || "Genel"),
                    posterShape: (actualType === "tv") ? "landscape" : "poster" 
                };
            }) 
        };
    } catch (e) { 
        console.error("[CATALOG_ERROR] Katalog Hatası: " + e.message);
        return { metas: [] }; 
    }
});

// --- 2. META VERİ İŞLEYİCİ (Meta Handler) ---

builder.defineMetaHandler(async ({ type, id }) => {
    console.error(`[META_START] Tip: ${type} | ID: ${id}`);
    const cleanId = getCleanId(id);

    try {
        let urlPath;
        if (id.startsWith('CH_')) {
            urlPath = `/api/channel/by/${cleanId}/${SW_KEY}/`;
        } else if (type === 'movie') {
            urlPath = `/api/movie/by/${cleanId}/${SW_KEY}/`;
        } else {
            urlPath = `/api/season/by/serie/${cleanId}/${SW_KEY}/`;
        }

        const reqHeaders = await signedHeaders("GET", urlPath);
        const res = await fetch(`${BASE_URL}${urlPath}`, { headers: reqHeaders });
        const data = await res.json();

        if (id.startsWith('CH_') || type === 'tv') {
            return {
                meta: {
                    id: id,
                    type: 'tv',
                    name: data.title || "Canlı Kanal",
                    poster: data.image,
                    background: data.image,
                    description: data.description || `${data.title || ""} Kesintisiz Canlı Yayın`,
                    posterShape: "landscape"
                }
            };
        }

        if (type === 'movie') {
            return {
                meta: {
                    id: id,
                    type: 'movie',
                    name: data.title,
                    poster: data.image,
                    background: data.cover || data.image,
                    description: data.description || "Film detayı bulunamadı.",
                    releaseInfo: data.year ? data.year.toString() : ""
                }
            };
        }

        const videos = [];
        const mainData = Array.isArray(data) ? data[0] : data;

        if (Array.isArray(data)) {
            data.forEach(s => {
                const sMatch = s.title ? s.title.match(/\d+/) : null;
                const sNum = sMatch ? parseInt(sMatch[0]) : (s.position || 1);

                if (s.episodes && Array.isArray(s.episodes)) {
                    s.episodes.forEach(ep => {
                        const eMatch = ep.title ? ep.title.match(/\d+/) : null;
                        const eNum = eMatch ? parseInt(eMatch[0]) : (ep.position || 1);

                        videos.push({
                            id: `${id}:${sNum}:${eNum}`,
                            title: ep.title || `${eNum}. Bölüm`,
                            description: mainData?.description || "Bölüm açıklaması bulunmuyor.",
                            poster: ep.image || mainData?.image,
                            background: ep.cover || ep.image || mainData?.cover,
                            season: sNum,
                            episode: eNum,
                            released: new Date().toISOString()
                        });
                    });
                }
            });
        }

        return { 
            meta: { 
                id: id, 
                type: 'series', 
                name: mainData?.title || "Dizi İçeriği", 
                poster: mainData?.image || "",
                background: mainData?.cover || mainData?.image || "",
                logo: mainData?.logo || mainData?.image || "",
                videos: videos, 
                description: mainData?.description || "Dizi açıklaması yüklenemedi.",
                releaseInfo: mainData?.year ? mainData.year.toString() : "",
                genres: (mainData?.genres || []).map(g => g.title || g)
            } 
        };

    } catch (e) { 
        console.error("[META_ERROR] Meta Hatası: " + e.message);
        return { meta: {} }; 
    }
});

// --- 3. YAYIN İŞLEYİCİ (Stream Handler) ---

builder.defineStreamHandler(async ({ id }) => {
    console.error(`[STREAM_START] İstek gelen ID: ${id}`);
    const parts = id.split(':');
    const cleanId = getCleanId(parts[0]);

    try {
        let sources = [];
        let contentTitle = "";
        let urlPath = "";

        if (id.startsWith('CH_')) {
            urlPath = `/api/channel/by/${cleanId}/${SW_KEY}/`;
        } else if (!id.includes(':')) {
            urlPath = `/api/movie/by/${cleanId}/${SW_KEY}/`;
        } else {
            urlPath = `/api/season/by/serie/${cleanId}/${SW_KEY}/`;
        }

        const reqHeaders = await signedHeaders("GET", urlPath);
        const res = await fetch(`${BASE_URL}${urlPath}`, { headers: reqHeaders });
        const data = await res.json();

        if (id.startsWith('CH_')) {
            contentTitle = data.title || "Canlı TV";
            sources = data.sources || (data.url ? [{ url: data.url }] : []);
        } else if (!id.includes(':')) {
            contentTitle = data.title || "Film";
            sources = data.sources || [];
        } else {
            const season = Array.isArray(data) ? data.find(s => (s.title.match(/\d+/) || [])[0] == parts[1]) : null;
            const episode = season?.episodes?.find(e => (e.title.match(/\d+/) || [])[0] == parts[2]);
            contentTitle = episode?.title || "Dizi";
            sources = episode?.sources || [];
        }

        console.error(`[STREAM_RESULT] Bulunan kaynak sayısı: ${sources.length}`);
        return {
            streams: sources.map(src => {
                let languageIcon = "";
                const srcTitle = (src.title || "").toLowerCase();
                
                if (srcTitle.includes("dublaj") || srcTitle.includes("tr")) {
                    languageIcon = "🇹🇷 "; 
                } else if (srcTitle.includes("altyazı") || srcTitle.includes("sub")) {
                    languageIcon = "🌐 "; 
                }

                return {
                    name: contentTitle, 
                    title: `RECTV | ${src.size || "HD"} | ${languageIcon}${src.title || ""}`,
                    url: src.url,
                    behaviorHints: { 
                        notWebReady: true, 
                        proxyHeaders: { "request": PLAYER_HEADERS } 
                    }
                };
            })
        };
    } catch (e) { 
        console.error("[STREAM_ERROR] Stream Hatası: " + e.message);
        return { streams: [] }; 
    }
});

serveHTTP(builder.getInterface(), { port: PORT });
