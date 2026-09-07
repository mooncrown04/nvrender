/* --- scraper/rectv.js --- */
import crypto from 'crypto';

console.error("[SCRAPER_TEST] RECTV dosyasi yuklendi ve baslatiliyor!");

var BASE_URL = "https://a.prectv70.lol";
var SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
var HMAC_KEY = "3508611138826751fdf77beaa6f93eb93fd27e6a5acb910e7aad22665513dd6e";
var APP_VERSION = "141";
var CLIENT_ID = "rectv-android";
var TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

var HEADERS = {
    'User-Agent': 'googleusercontent',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

var cachedToken = null;

async function getAuthToken() {
    if (cachedToken) {
        console.error("[SCRAPER_AUTH] Onbellekten token kullaniliyor.");
        return cachedToken;
    }
    try {
        console.error("[SCRAPER_AUTH] Yeni nonc/token isteniyor: " + BASE_URL + "/api/attest/nonce");
        const res = await fetch(BASE_URL + "/api/attest/nonce", { headers: HEADERS });
        const text = await res.text();
        console.error("[SCRAPER_AUTH] Nonce ham yanit: " + text);
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

// ---- HMAC İmzalama ----
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

    console.error(`[SCRAPER_SIGN] İmzalandı -> Yol: ${path} | TS: ${ts}`);
    return headers;
}

function analyzeStream(url, index, itemLabel) {
    const lowUrl = url.toLowerCase();
    const lowLabel = (itemLabel || "").toLowerCase();
    let info = { icon: "🌐", text: "Altyazı" };

    const isTurkish = 
        lowLabel.includes("dublaj") || lowLabel.includes("tr dub") || 
        lowLabel.includes("türkçe") || lowUrl.includes("dublaj") || 
        lowUrl.includes("/tr/");

    if (isTurkish) {
        info.icon = "🇹🇷";
        info.text = "Dublaj";
    }
    return info;
}

export async function getStreams(mediaType, id) {
    console.error(`[SCRAPER_START] Gelen ham ID: ${id} | Medya Tipi: ${mediaType}`);

    // 1. ÖZEL ID FORMATINI ÇÖZME
    let directRecId = null;
    let isDirectMovie = false;
    let isDirectSerie = false;

    if (id && id.startsWith("rectv_")) {
        const cleanParts = id.replace("rectv_", "").split('_');
        isDirectMovie = cleanParts[0] === "movie";
        isDirectSerie = cleanParts[0] === "serie";
        directRecId = cleanParts[1];
        console.error(`[SCRAPER_PARSE] Özel RecTV ID algılandı -> Tip: ${cleanParts[0]} | ID: ${directRecId}`);
    }

    // TmdbService hatasını engellemek için özel ID ise geçici dummy IMDB ata
    const workingId = (id && id.startsWith("rectv_")) ? "tt0000000" : id;

    const parts = workingId.split(':');
    const imdbId = parts[0];
    const seasonNum = parts[1] || null;
    const episodeNum = parts[2] || null;
    const isSerie = !!seasonNum || isDirectSerie;

    console.error(`[SCRAPER_STATE] İşlenen IMDB: ${imdbId} | Sezon: ${seasonNum} | Bölüm: ${episodeNum} | Dizi mi?: ${isSerie}`);

    try {
        let finalResults = [];

        // 2. DOĞRUDAN RECTV ID İSE İSTEK AT
        if (directRecId) {
            if (isDirectMovie) {
                const detPath = `/api/movie/${directRecId}/${SW_KEY}/`;
                console.error(`[SCRAPER_FETCH] Film detayı isteniyor: ${detPath}`);
                
                const detHeaders = await signedHeaders("GET", detPath);
                const detRes = await fetch(`${BASE_URL}${detPath}`, { headers: detHeaders });
                const detData = await detRes.json();
                const sources = detData.sources || (Array.isArray(detData) ? detData : []);

                console.error(`[SCRAPER_RESULT] Bulunan film kaynak sayısı: ${sources.length}`);
                sources.forEach((src, idx) => {
                    const info = analyzeStream(src.url, idx, "");
                    finalResults.push({
                        name: "RECTV",
                        title: `Film Kaynağı ${idx + 1} | ${info.icon} ${info.text}`,
                        url: src.url
                    });
                });
            } else if (isDirectSerie) {
                const seasonPath = `/api/season/by/serie/${directRecId}/${SW_KEY}/`;
                console.error(`[SCRAPER_FETCH] Dizi sezonları isteniyor: ${seasonPath}`);

                const seasonHeaders = await signedHeaders("GET", seasonPath);
                const seasonRes = await fetch(`${BASE_URL}${seasonPath}`, { headers: seasonHeaders });
                const seasons = await seasonRes.json();
                
                console.error(`[SCRAPER_RESULT] Sezon listesi alındı. Toplam Sezon: ${seasons.length}`);
                for (let s of seasons) {
                    const sNo = parseInt(s.title.match(/\d+/) || 0);
                    if (seasonNum && sNo != seasonNum) continue;

                    for (let ep of (s.episodes || [])) {
                        const epNo = parseInt(ep.title.match(/\d+/) || 0);
                        if (episodeNum && epNo != episodeNum) continue;
                        
                        (ep.sources || []).forEach((src, idx) => {
                            const info = analyzeStream(src.url, idx, ep.label || s.title);
                            finalResults.push({
                                name: "RECTV",
                                title: `[S${s.title}E${ep.title}] Kaynak ${idx + 1} | ${info.icon} ${info.text}`,
                                url: src.url
                            });
                        });
                    }
                }
            }

            if (finalResults.length > 0) {
                console.error(`[SCRAPER_SUCCESS] Doğrudan ID ile toplam ${finalResults.length} kaynak döndürülüyor.`);
                return finalResults.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);
            } else {
                console.error(`[SCRAPER_WARN] Doğrudan ID ile arandı ancak kaynak bulunamadı!`);
            }
        }

        // 3. STANDART TMDB VE ARAMA AKIŞI
        console.error(`[SCRAPER_TMDB] TMDB üzerinden aranıyor: ${imdbId}`);
        const tmdbUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        
        const meta = (tmdbData.movie_results && tmdbData.movie_results[0]) || 
                     (tmdbData.tv_results && tmdbData.tv_results[0]);

        if (!meta) {
            console.error(`[SCRAPER_ERROR] TMDB'de kayıt bulunamadı: ${imdbId}`);
            return [];
        }

        const title = meta.title || meta.name;
        console.error(`[SCRAPER_TMDB] Eşleşen Film/Dizi İsmi: ${title}`);

        const searchPath = `/api/search/${encodeURIComponent(title)}/${SW_KEY}/`;
        console.error(`[SCRAPER_FETCH] RecTV Arama Yolu: ${searchPath}`);

        const searchHeaders = await signedHeaders("GET", searchPath);
        const sRes = await fetch(`${BASE_URL}${searchPath}`, { headers: searchHeaders });
        const sData = await sRes.json();
        
        const allItems = (sData.channels || []).concat(sData.posters || []);
        console.error(`[SCRAPER_SEARCH] Arama sonuç toplam öğe: ${allItems.length}`);

        for (let target of allItems) {
            const targetTitle = (target.title || "").toLowerCase();
            const searchTitle = title.toLowerCase();

            if (!targetTitle.includes(searchTitle) && !searchTitle.includes(targetTitle)) continue;

            console.error(`[SCRAPER_MATCH] Eşleşme sağlandı -> Başlık: ${target.title} | ID: ${target.id} | Tip: ${target.type}`);

            if (isSerie && target.type === "serie") {
                const seasonPath = `/api/season/by/serie/${target.id}/${SW_KEY}/`;
                const seasonHeaders = await signedHeaders("GET", seasonPath);
                const seasonRes = await fetch(`${BASE_URL}${seasonPath}`, { headers: seasonHeaders });
                const seasons = await seasonRes.json();
                
                for (let s of seasons) {
                    if (parseInt(s.title.match(/\d+/) || 0) == seasonNum) {
                        for (let ep of (s.episodes || [])) {
                            if (parseInt(ep.title.match(/\d+/) || 0) == episodeNum) {
                                (ep.sources || []).forEach((src, idx) => {
                                    const info = analyzeStream(src.url, idx, ep.label || s.title);
                                    finalResults.push({
                                        name: "RECTV",
                                        title: `[S${seasonNum}E${episodeNum}] Kaynak ${idx + 1} | ${info.icon} ${info.text}`,
                                        url: src.url
                                    });
                                });
                            }
                        }
                    }
                }
            } else if (!isSerie) {
                const detPath = `/api/movie/${target.id}/${SW_KEY}/`;
                const detHeaders = await signedHeaders("GET", detPath);
                const detRes = await fetch(`${BASE_URL}${detPath}`, { headers: detHeaders });
                const detData = await detRes.json();
                const sources = detData.sources || (Array.isArray(detData) ? detData : []);

                sources.forEach((src, idx) => {
                    const info = analyzeStream(src.url, idx, target.label || "");
                    finalResults.push({
                        name: "RECTV",
                        title: `Film Kaynağı ${idx + 1} | ${info.icon} ${info.text}`,
                        url: src.url
                    });
                });
            }
        }

        console.error(`[SCRAPER_END] İşlem tamamlandı. Bulunan benzersiz kaynak: ${finalResults.length}`);
        return finalResults.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);

    } catch (err) {
        console.error(`[SCRAPER_CRITICAL_ERROR] İstek sırasında hata yakalandı: ${err.message} | Stack: ${err.stack}`);
        return [];
    }
}
