const { load } = require('cheerio');

/* --- 1. AYARLAR VE API TANIMLARI --- */
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

let cachedToken = null;

/* --- 2. YARDIMCI FONKSİYONLAR (Önceki Dosyandan Gelen Standartlar) --- */

async function getAuthToken() {
    if (cachedToken) return cachedToken;
    try {
        const res = await fetch(BASE_URL + "/api/attest/nonce", { headers: HEADERS });
        const text = await res.text();
        try {
            const json = JSON.parse(text);
            cachedToken = json.accessToken || text.trim();
        } catch (e) { cachedToken = text.trim(); }
        return cachedToken;
    } catch (e) { return null; }
}

function encodeB64Url(input) {
    return Buffer.from(String(input), 'utf8').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeB64Url(input) {
    const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4;
    const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
    return Buffer.from(padded, 'base64').toString('utf8');
}

function buildMetaId(type, id, title) {
    return `hdfilmizle:${type}:${id}:${encodeB64Url(title)}`;
}

function parseMetaId(metaId) {
    const parts = String(metaId || '').split(':');
    if (parts.length < 4) return null;
    return { type: parts[1], targetId: parts[2], title: decodeB64Url(parts[3]) };
}

function analyzeStream(url, index, itemLabel) {
    const lowUrl = url.toLowerCase();
    const lowLabel = (itemLabel || "").toLowerCase();
    let info = { icon: "🌐", text: "Altyazı" };

    const isTurkish = lowLabel.includes("dublaj") || lowLabel.includes("tr dub") || lowLabel.includes("türkçe") || lowUrl.includes("/tr/");
    if (isTurkish) {
        info.icon = "🇹🇷";
        info.text = "Dublaj";
    }
    return info;
}

/* --- 3. ANA FONKSİYONLAR (STREMIO UYUMLU) --- */

async function getCatalog(type, search = '') {
    if (!search) return []; // RecTV API genellikle arama odaklıdır, boş aramada popülerleri dönebilirsiniz

    const token = await getAuthToken();
    const searchHeaders = Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + token });
    const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(search)}/${SW_KEY}/`;
    
    try {
        const sRes = await fetch(searchUrl, { headers: searchHeaders });
        const sData = await sRes.json();
        const found = (sData.series || []).concat(sData.posters || []);

        return found.map(item => {
            const isSerie = item.type === "serie" || (item.label && item.label.toLowerCase().includes("dizi"));
            const currentType = isSerie ? "series" : "movie";
            
            // Sadece istenen kategoriye ait olanları göster
            if (currentType !== type) return null;

            return {
                id: buildMetaId(currentType, item.id, item.title),
                type: currentType,
                name: item.title,
                poster: item.image || item.poster,
                background: item.image || item.poster,
                releaseInfo: item.year || null
            };
        }).filter(Boolean);
    } catch (e) { return []; }
}

async function getMeta(type, id) {
    const parsed = parseMetaId(id);
    if (!parsed) return null;

    // RecTV detay API'si genellikle Stream aşamasında kullanıldığı için 
    // Katalogdan gelen veriyi basitçe meta olarak dönebiliriz.
    return {
        id: id,
        type: type,
        name: parsed.title,
        poster: null, // Detay sayfasından çekilebilir
        description: `${parsed.title} içeriğini izlemek için kaynakları kontrol edin.`
    };
}

async function getStreams(type, id) {
    const parsed = parseMetaId(id);
    if (!parsed) return [];

    const isMovie = (type === 'movie');
    const token = await getAuthToken();
    const searchHeaders = Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + token });
    let finalResults = [];

    try {
        if (isMovie) {
            const detRes = await fetch(`${BASE_URL}/api/movie/${parsed.targetId}/${SW_KEY}/`, { headers: searchHeaders });
            const detData = await detRes.json();
            (detData.sources || []).forEach((src, idx) => {
                const streamInfo = analyzeStream(src.url, idx, detData.label);
                finalResults.push({
                    title: `RECTV | Kaynak ${idx + 1} | ${streamInfo.icon} ${streamInfo.text}`,
                    url: src.url,
                    behaviorHints: { notWebReady: true }
                });
            });
        } else {
            // Dizi için Sezon/Bölüm mantığı (Stremio'dan gelen ek bilgi gerektirir)
            // Not: Stremio meta id içinden sezon/bölüm bilgisini çekmek için index.js'den 
            // gelen ek parametreleri kullanmak daha sağlıklıdır.
            const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${parsed.targetId}/${SW_KEY}/`, { headers: searchHeaders });
            const seasons = await seasonRes.json();
            
            // Örnek: İlk sezonun ilk bölümünü döner (Basitleştirilmiş)
            if (seasons[0] && seasons[0].episodes[0]) {
                const ep = seasons[0].episodes[0];
                (ep.sources || []).forEach((src, idx) => {
                    const streamInfo = analyzeStream(src.url, idx, ep.label);
                    finalResults.push({
                        title: `RECTV Dizi | Kaynak ${idx + 1} | ${streamInfo.icon} ${streamInfo.text}`,
                        url: src.url,
                        behaviorHints: { notWebReady: true }
                    });
                });
            }
        }
        return finalResults;
    } catch (e) { return []; }
}

module.exports = {
    BASE_URL,
    getCatalog,
    getMeta,
    getStreams
};
