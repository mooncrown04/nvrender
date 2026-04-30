import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

// --- YAPILANDIRMA AYARLARI ---
// Port ayarı: Çevresel değişken yoksa varsayılan olarak 7010 portunu kullanır.
const PORT = process.env.PORT || 7010;
// API Sunucu Adresi
const BASE_URL = "https://a.prectv70.lol";
// Uygulama için gerekli olan özel anahtar (Software Key)
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

// --- HTTP BAŞLIKLARI (HEADERS) ---
// API istekleri için kullanılacak kimlik bilgileri ve tarayıcı taklidi
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

// Video oynatıcı (Player) için gereken özel başlıklar (Proxy Headers)
const PLAYER_HEADERS = {
    'User-Agent': 'googleusercontent',
    'Referer': 'https://twitter.com/',
    'Accept-Encoding': 'identity'
};

// --- ADDON MANİFESTOSU ---
// Stremio'nun eklentiyi tanıması için gerekli olan kimlik kartı
const manifest = {
    id: "com.mooncrown.rectv.v23",
    version: "8.0.0",
    name: "RECTV Fix Final",
    description: "Canlı TV Katalog & TMDB/CH_ ID Fix",
    resources: ["catalog", "meta", "stream"],
    // Desteklenen içerik türleri
    types: ["movie", "series", "tv"],
    // Eklentinin hangi ID yapılarını tanıyacağı
    idPrefixes: ["rectv_", "tt", "CH_", "tmdb:"],
    // Arayüzde görünecek olan ana kategoriler
    catalogs: [
        { 
            id: "rc_live", 
            type: "tv", // Stremio TV sekmesinde görünmesini sağlar
            name: "RECTV Canlı TV" 
        },
        { id: "rc_movie", type: "movie", name: "RECTV Filmler", extra: [{ name: "search" }, { name: "skip" }] },
        { id: "rc_series", type: "series", name: "RECTV Diziler", extra: [{ name: "search" }, { name: "skip" }] }
    ]
};

const builder = new addonBuilder(manifest);

// --- YARDIMCI FONKSİYONLAR ---

/**
 * API'den geçici erişim tokenı (accessToken) alır.
 */
async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const json = await res.json();
        return json.accessToken || (await res.text()).trim();
    } catch (e) { return null; }
}

/**
 * Karmaşık Stremio ID'lerini temizleyerek sadece saf veritabanı ID'sini döndürür.
 * Örn: "CH_123" -> "123", "tmdb:456" -> "456"
 */
function getCleanId(id) {
    if (!id) return "";
    return id.split(':').shift()
             .replace('rectv_movie_', '')   // Film prefixini siler
             .replace('rectv_series_', '')  // Dizi prefixini siler
			 .replace('tmdb:', '')
            // .replace('CH_', '')
             .replace('tt', '')
             .split('_').pop();
}

// --- 1. KATALOG İŞLEYİCİ (Catalog Handler) ---
// Kullanıcı eklenti ana sayfasına girdiğinde listeleri çeker.

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const token = await getAuthToken();
        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };
        
        let url;
        // Canlı TV kanallarını çekmek için özel endpoint
        if (id === "rc_live") {
            url = `${BASE_URL}/api/channel/by/filtres/6/0/0/${SW_KEY}/`;
        } else {
            // Arama yapılıyorsa arama API'sini, yapılmıyorsa filtreli içerik API'sini kullan
            url = extra?.search 
                ? `${BASE_URL}/api/search/${encodeURIComponent(extra.search)}/${SW_KEY}/`
                : `${BASE_URL}/api/${type === 'movie' ? 'movie' : 'serie'}/by/filtres/0/created/${extra?.skip || 0}/${SW_KEY}/`;
        }
        
        const res = await fetch(url, { headers: authHeaders });
        const data = await res.json();
        
        // API'den gelen veriyi normalize et
        const items = data.channels || data.posters || data.series || (Array.isArray(data) ? data : []);
        
        return { 
            metas: items.map(item => {
                // TÜR BELİRLEME: 
                // Eğer TV kategorisindeysek zaten 'tv'dir. 
                // Arama yapılıyorsa, objenin içindeki 'is_serie' gibi alanlara bakarak gerçek türü bulmalıyız.
                let actualType = type; 

                if (type !== "tv" && extra?.search) {
                    // API'den gelen objede genellikle diziler için ayırıcı bir veri bulunur
                    // Eğer 'serie' kelimesi geçiyorsa veya posters dışında bir alandaysa series yap
                    if (item.is_series === 1 || item.type === 'serie' || (data.series && data.series.includes(item))) {
                        actualType = "series";
                    } else {
                        actualType = "movie";
                    }
                }

                return { 
                    // ID: TV ise CH_id, değilse rectv_tür_id (rectv_movie_123 veya rectv_series_123)
                    id: (actualType === "tv") ? `CH_${item.id}` : `rectv_${actualType}_${item.id}`, 
                    type: actualType, 
                    name: item.title || item.name, 
                    poster: item.image || item.thumbnail,
                    // Görünüm: Kanallar için yatay (landscape), filmler/diziler için dikey (poster)
                    posterShape: (actualType === "tv") ? "landscape" : "poster" 
                };
            }) 
        };
    } catch (e) { 
        console.error("Katalog Hatası:", e);
        return { metas: [] }; 
    }
});

// --- 2. META VERİ İŞLEYİCİ (Meta Handler) ---
// Bir içeriğe tıklandığında detaylarını (açıklama, sezonlar, bölümler) getirir.
builder.defineMetaHandler(async ({ type, id }) => {
    const cleanId = getCleanId(id);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let url;
        // 1. ADIM: Doğru API URL'sini belirle
        if (id.startsWith('CH_')) {
            url = `${BASE_URL}/api/channel/by/${cleanId}/${SW_KEY}/`;
        } else if (type === 'movie') {
            url = `${BASE_URL}/api/movie/by/${cleanId}/${SW_KEY}/`;
        } else {
            url = `${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`;
        }

        const res = await fetch(url, { headers });
        const data = await res.json();

        // --- MANTIK AYIRMA BURADA BAŞLIYOR ---

        // 1. CANLI TV METASI
        if (id.startsWith('CH_') || type === 'tv') {
            return {
                meta: {
                    id: id,
                    type: 'tv',
                    name: data.name || data.title || "Canlı Kanal",
                    poster: data.thumbnail || data.image,
                    background: data.image || data.thumbnail,
                    description: data.description || "Kesintisiz Canlı Yayın",
                    posterShape: "landscape" // Kanallar genelde yatay daha iyi durur
                }
            };
        }

        // 2. FİLM METASI
        if (type === 'movie') {
            return {
                meta: {
                    id: id,
                    type: 'movie',
                    name: data.title || data.name || "Film",
                    poster: data.image || data.thumbnail,
                    background: data.backdrop || data.image, // Varsa backdrop kullan
                    description: data.description || "Film detayı yükleniyor...",
                    releaseInfo: data.year || ""
                }
            };
        }

        // 3. DİZİ METASI (Else durumu)
        const videos = [];
        if (Array.isArray(data)) {
            data.forEach(s => {
                const sNum = parseInt(s.title.match(/\d+/) || 1);
                s.episodes.forEach(ep => {
                    const eNum = parseInt(ep.title.match(/\d+/) || 1);
                    videos.push({
                        id: `${id}:${sNum}:${eNum}`,
                        title: ep.title,
                        season: sNum,
                        episode: eNum
                    });
                });
            } );
        }
        
        return { 
            meta: { 
                id: id, 
                type: 'series', 
                name: data[0]?.title || "Dizi", 
                videos: videos 
            } 
        };

    } catch (e) { 
        console.error("Meta Error:", e);
        return { meta: {} }; 
    }
});

// --- 3. YAYIN İŞLEYİCİ (Stream Handler) ---
// "Oynat" butonuna basıldığında asıl video linkini (m3u8/mp4) döndürür.
builder.defineStreamHandler(async ({ id }) => {
    const parts = id.split(':');
    const cleanId = getCleanId(parts[0]);
    const token = await getAuthToken();
    const headers = { ...HEADERS, 'Authorization': `Bearer ${token}` };

    try {
        let sources = [];
        // ID türüne göre kaynak video linkini API'den sorgula
        if (id.startsWith('CH_')) {
            const res = await fetch(`${BASE_URL}/api/channel/by/${cleanId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || (data.url ? [{ url: data.url }] : []);
        } else if (!id.includes(':')) {
            const res = await fetch(`${BASE_URL}/api/movie/by/${cleanId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            sources = data.sources || [];
        } else {
            // Dizi bölümleri için ilgili sezon ve bölümü bul
            const res = await fetch(`${BASE_URL}/api/season/by/serie/${cleanId}/${SW_KEY}/`, { headers });
            const data = await res.json();
            const season = data.find(s => (s.title.match(/\d+/) || [])[0] == parts[1]);
            const episode = season?.episodes.find(e => (e.title.match(/\d+/) || [])[0] == parts[2]);
            sources = episode?.sources || [];
        }

        // Stremio'nun anlayacağı formatta yayın listesini döndür
        return {
            streams: sources.map(src => ({
                name: "RECTV",
                title: id.startsWith('CH_') ? "CANLI YAYIN" : "AHD",
                url: src.url,
                // Proxy ve Player ayarları
                behaviorHints: { 
                    notWebReady: true, 
                    proxyHeaders: { "request": PLAYER_HEADERS } 
                }
            }))
        };
    } catch (e) { return { streams: [] }; }
});

// --- SUNUCUYU BAŞLAT ---
// Eklentiyi belirtilen port üzerinden yayına sokar.
serveHTTP(builder.getInterface(), { port: PORT });
