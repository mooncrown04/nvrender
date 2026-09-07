/* --- scraper/rectv.js --- */

var BASE_URL = "https://a.prectv70.lol";
var SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
var HMAC_KEY = "3508611138826751fdf77beaa6f93eb93fd27e6a5acb910e7aad22665513dd6e";
var APP_VERSION = "141";
var CLIENT_ID = "rectv-android";
var TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

var HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://twitter.com/',
    'Accept': 'application/json'
};

var cachedToken = null;

async function getAuthToken() {
    if (cachedToken) return cachedToken;
    try {
        const res = await fetch(BASE_URL + "/api/attest/nonce", { headers: HEADERS });
        const text = await res.text();
        try {
            const json = JSON.parse(text);
            cachedToken = json.nonce || json.accessToken || text.trim();
        } catch (e) { cachedToken = text.trim(); }
        return cachedToken;
    } catch (e) { return null; }
}

// ---- Web Crypto API (Tarayıcı / Android Uyumlu HMAC İmzalama) ----
async function sha256Hex(data) {
    const msgBuffer = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(key, message) {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        enc.encode(key),
        { name: "HMAC", hash: { name: "SHA-256" } },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signedHeaders(method, path, body = "") {
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
    const bodyHash = await sha256Hex(body);
    const message = `${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`;
    const signature = await hmacSha256Hex(HMAC_KEY, message);

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
    const parts = id.split(':');
    let imdbId = parts[0];
    const seasonNum = parts[1] || null;
    const episodeNum = parts[2] || null;
    const isSerie = !!seasonNum;

    try {
        let title = "";
        let directNumericId = null;

        if (imdbId.startsWith("rectv_")) {
            directNumericId = imdbId.split('_').pop();
        } else {
            const tmdbUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
            const tmdbRes = await fetch(tmdbUrl);
            const tmdbData = await tmdbRes.json();
            
            const meta = (tmdbData.movie_results && tmdbData.movie_results[0]) || 
                         (tmdbData.tv_results && tmdbData.tv_results[0]);

            if (!meta) {
                return [{
                    name: "RECTV",
                    title: `HATA: TMDB'de kayıt bulunamadı (${imdbId})`,
                    url: "https://hata.alindi"
                }];
            }

            title = meta.title || meta.name;
        }

        let finalResults = [];

        if (directNumericId) {
            if (isSerie) {
                const seasonPath = `/api/season/by/serie/${directNumericId}/${SW_KEY}/`;
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
            } else {
                const detPath = `/api/movie/${directNumericId}/${SW_KEY}/`;
                const detHeaders = await signedHeaders("GET", detPath);
                const detRes = await fetch(`${BASE_URL}${detPath}`, { headers: detHeaders });
                const detData = await detRes.json();
                const sources = detData.sources || (Array.isArray(detData) ? detData : []);

                sources.forEach((src, idx) => {
                    const info = analyzeStream(src.url, idx, "");
                    finalResults.push({
                        name: "RECTV",
                        title: `Film Kaynağı ${idx + 1} | ${info.icon} ${info.text}`,
                        url: src.url
                    });
                });
            }
        } else {
            const searchPath = `/api/search/${encodeURIComponent(title)}/${SW_KEY}/`;
            const searchHeaders = await signedHeaders("GET", searchPath);
            const sRes = await fetch(`${BASE_URL}${searchPath}`, { headers: searchHeaders });
            const sData = await sRes.json();
            
            const allItems = (sData.series || []).concat(sData.posters || []).concat(sData.channels || []);

            for (let target of allItems) {
                const targetTitle = (target.title || "").toLowerCase();
                const searchTitle = title.toLowerCase();

                if (!targetTitle.includes(searchTitle) && !searchTitle.includes(targetTitle)) continue;

                if (isSerie && (target.type === "serie" || target.type === "series")) {
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
        }
        
        if (finalResults.length === 0) {
            return [{
                name: "RECTV",
                title: `HATA: İçerik bulunamadı veya eşleşmedi (${title})`,
                url: "https://hata.alindi"
            }];
        }

        return finalResults.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);

    } catch (err) {
        return [{
            name: "RECTV",
            title: `HATA: ${err.message}`,
            url: "https://hata.alindi"
        }];
    }
}
