import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

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

// --- YAPILANDIRMA AYARLARI ---
const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

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
    version: "8.5.2",
    name: "RECTV Ultimate Fix",
    description: "dizi-film55",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "tv"],
    idPrefixes: ["rectv_", "tt", "CH_", "tmdb:"],
    catalogs: [
        { id: "rc_live", type: "tv", name: "RECTV Canlı TV", extra: [{ name: "search" }, { name: "genre", options: Object.keys(TV_MAP) }] },
        { id: "rc_movie", type: "movie", name: "RECTV Filmler", extra: [{ name: "search" }, { name: "skip" }, { name: "genre", options: Object.keys(MOVIE_MAP) }] },
        { id: "rc_series", type: "series", name: "RECTV Diziler", extra: [{ name: "search" }, { name: "skip" }, { name: "genre", options: Object.keys(SERIES_MAP) }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR ---
async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const json = await res.json();
        return json.accessToken || (await res.text()).trim();
    } catch (e) { return null; }
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

// --- 1. KATALOG İŞLEYİCİ ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        let url;
        
        if (id === "rc_live" || type === "tv") {
            if (extra?.search) url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
            else if (extra?.genre) url = `${BASE_URL}/api/channel/by/filtres/${TV_MAP[extra.genre] || "6"}/0/0/${SW_KEY}/`;
            else url = `${BASE_URL}/api/channel/by/filtres/6/0/0/${SW_KEY}/`;
        } else if (extra?.search) {
            url = `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`;
        } else {
            let rectvType = (type === 'series') ? 'serie' : 'movie';
            let genreId = type === 'movie' ? (MOVIE_MAP[extra?.genre] || "0") : (SERIES_MAP[extra?.genre] || "0");
            url = `${BASE_URL}/api/${rectvType}/by/filtres/${genreId}/created/${extra?.skip || 0}/${SW_KEY}/`;
        }
        
        const res = await fetch(url, { headers: authHeaders });
        const data = await res.json();
        const items = [];
        if (data.channels) data.channels.forEach(i => items.push({ ...i, _origin: 'tv' }));
        if (data.posters) data.posters.forEach(i => items.push({ ...i, _origin: 'movie' }));
        if (data.series) data.series.forEach(i => items.push({ ...i, _origin: 'series' }));
        if (items.length === 0 && Array.isArray(data)) data.forEach(i => items.push({ ...i, _origin: type }));

        return { 
            metas: items.map(item => ({
                id: (item.type === "channel" || item._origin === 'tv') ? `CH_${item.id}` : `rectv_${type}_${item.id}`,
                type: (item.type === "channel" || item._origin === 'tv') ? "tv" : type,
                name: item.title,
                poster: item.image,
                background: item.image,
                posterShape: (item.type === "channel" || item._origin === 'tv') ? "landscape" : "poster"
            })) 
        };
    } catch (e) { return { metas: [] }; }
});

// --- 2. META VERİ İŞLEYİCİ ---
builder.defineMetaHandler(async ({ type, id }) => {
    const cleanId = getCleanId(id);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let url;
        if (id.startsWith('CH_')) url = `${BASE_URL}/api/channel/by/${cleanId}/${SW_KEY}/`;
        else if (type === 'movie') url = `${BASE_URL}/api/movie/by/${cleanId}/${SW_KEY}/`;
        else url = `${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`;

        const res = await fetch(url, { headers });
        const data = await res.json();

        if (id.startsWith('CH_') || type === 'tv') {
            return { meta: { id, type: 'tv', name: data.title, poster: data.image, description: data.description || "Canlı Yayın", posterShape: "landscape" } };
        }

        if (type === 'movie') {
            return { meta: { id, type: 'movie', name: data.title, poster: data.image, description: data.description || "Film özeti bulunamadı.", releaseInfo: data.year?.toString() } };
        }

        // --- DİZİ (SERIES) DÜZELTİLMİŞ KISIM ---
        const videos = [];
        const isDataArray = Array.isArray(data);
        const mainData = isDataArray ? data[0] : data;

        // Sezon içinde description yoksa, RECTV API'sinde genellikle 'serie_description' anahtarında bulunur.
        const seriesDesc = mainData?.serie_description || mainData?.description || mainData?.resume || "Dizi açıklaması bulunmamaktadır.";
        const seriesTitle = mainData?.serie_title || mainData?.title || "Dizi";

        if (isDataArray) {
            data.forEach(s => {
                const sNum = parseInt((s.title?.match(/\d+/) || [1])[0]);
                if (s.episodes && Array.isArray(s.episodes)) {
                    s.episodes.forEach(ep => {
                        const eNum = parseInt((ep.title?.match(/\d+/) || [1])[0]);
                        videos.push({
                            id: `${id}:${sNum}:${eNum}`,
                            title: ep.title || `${eNum}. Bölüm`,
                            // Bölüm özeti yoksa ana dizi özetini basıyoruz
                            description: ep.description || seriesDesc,
                            season: sNum,
                            episode: eNum,
                            poster: ep.image || mainData?.image,
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
                name: seriesTitle,
                poster: mainData?.image || "",
                background: mainData?.cover || mainData?.image || "",
                logo: mainData?.image || "",
                videos: videos,
                description: seriesDesc,
                releaseInfo: mainData?.year?.toString() || "",
                genres: (mainData?.genres || []).map(g => g.title || g)
            }
        };
    } catch (e) { return { meta: {} }; }
});

// --- 3. YAYIN İŞLEYİCİ ---
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split(':');
    const cleanId = getCleanId(parts[0]);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let sources = [], contentTitle = "Yayın";
        if (id.startsWith('CH_')) {
            const data = await (await fetch(`${BASE_URL}/api/channel/by/${cleanId}/${SW_KEY}/`, { headers })).json();
            contentTitle = data.title;
            sources = data.sources || (data.url ? [{ url: data.url }] : []);
        } else if (!id.includes(':')) {
            const data = await (await fetch(`${BASE_URL}/api/movie/by/${cleanId}/${SW_KEY}/`, { headers })).json();
            contentTitle = data.title;
            sources = data.sources || [];
        } else {
            const data = await (await fetch(`${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`, { headers })).json();
            const season = data.find(s => (s.title?.match(/\d+/) || [])[0] == parts[1]);
            const episode = season?.episodes.find(e => (e.title?.match(/\d+/) || [])[0] == parts[2]);
            contentTitle = episode?.title;
            sources = episode?.sources || [];
        }

        return {
            streams: sources.map(src => ({
                name: contentTitle,
                title: `RECTV | ${src.size || "HD"} | ${(src.title || "").toLowerCase().includes("dublaj") ? "🇹🇷" : "🌐"} ${src.title || ""}`,
                url: src.url,
                behaviorHints: { notWebReady: true, proxyHeaders: { "request": PLAYER_HEADERS } }
            }))
        };
    } catch (e) { return { streams: [] }; }
});

serveHTTP(builder.getInterface(), { port: PORT });
