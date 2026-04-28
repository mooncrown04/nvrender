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

/* --- 2. YARDIMCI FONKSİYONLAR --- */

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

function analyzeStream(url, index, itemLabel) {
    const lowUrl = url.toLowerCase();
    const lowLabel = (itemLabel || "").toLowerCase();
    let info = { icon: "🌐", text: "Altyazı" };

    const isTurkish = 
        lowLabel.includes("dublaj") || 
        lowLabel.includes("yerli") || 
        lowLabel.includes("tr dub") || 
        lowLabel.includes("türkçe") ||
        lowUrl.includes("dublaj") || 
        lowUrl.includes("/tr/");

    if (isTurkish) {
        if (lowLabel.includes("altyazı") && index === 1) {
            info.icon = "🌐";
            info.text = "Altyazı";
        } else {
            info.icon = "🇹🇷";
            info.text = "Dublaj";
        }
    }
    return info;
}

/* --- 3. ANA SCRAPER FONKSİYONU (getStreams) --- */

export async function getStreams(type, id) {
    try {
        const isMovie = (type === 'movie');
        // id formatı tt12345 veya tt12345:1:1 olabilir. Sadece tt kısmını alalım.
        const tmdbImdbId = id.split(':')[0]; 
        const seasonNum = id.split(':')[1] || 1;
        const episodeNum = id.split(':')[2] || 1;

        // 1. TMDB'den Orjinal ve Türkçe İsimleri Al
        const tmdbUrl = `https://api.themoviedb.org/3/find/${tmdbImdbId}?external_source=imdb_id&language=tr-TR&api_key=${TMDB_API_KEY}`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        
        const result = isMovie ? tmdbData.movie_results?.[0] : tmdbData.tv_results?.[0];
        if (!result) return [];

        const trTitle = (result.title || result.name || "").trim();
        const orgTitle = (result.original_title || result.original_name || "").trim();

        const token = await getAuthToken();
        const searchHeaders = Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + token });
        
        // 2. Arama Sorgularını Hazırla
        let searchQueries = [trTitle];
        if (orgTitle && orgTitle !== trTitle) searchQueries.push(orgTitle);

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
            const targetTitleLower = target.title.toLowerCase().trim();
            const searchTitleLower = trTitle.toLowerCase().trim();
            const orgTitleLower = orgTitle.toLowerCase().trim();
            let isMatch = false;

            // Eşleşme Kontrolü
            if (isMovie) {
                const isLengthOk = targetTitleLower.length <= searchTitleLower.length + 5; 
                const isExact = targetTitleLower === searchTitleLower || targetTitleLower === orgTitleLower;
                isMatch = isExact || (targetTitleLower.includes(searchTitleLower) && isLengthOk);
            } else {
                isMatch = targetTitleLower.includes(searchTitleLower) || targetTitleLower.includes(orgTitleLower);
            }

            if (!isMatch) continue;

            // Tip Kontrolü
            const isActuallySerie = target.type === "serie" || (target.label && target.label.toLowerCase().includes("dizi"));
            if (isMovie && isActuallySerie) continue;
            if (!isMovie && !isActuallySerie) continue;

            // 3. İçerik Kaynaklarını Çek
            if (isActuallySerie) {
                const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: searchHeaders });
                const seasons = await seasonRes.json();
                for (let s of seasons) {
                    let sNumber = parseInt(s.title.match(/\d+/) || 0);
                    if (sNumber == seasonNum) {
                        for (let ep of s.episodes) {
                            let epNumber = parseInt(ep.title.match(/\d+/) || 0);
                            if (epNumber == episodeNum) {
                                (ep.sources || []).forEach((src, idx) => {
                                    const streamInfo = analyzeStream(src.url, idx, ep.label || s.title);
                                    finalResults.push({
                                        name: `RECTV`,
                                        title: `Kaynak ${idx + 1} | ${streamInfo.icon} ${streamInfo.text}`,
                                        url: src.url
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
                        name: `RECTV`,
                        title: `Kaynak ${idx + 1} | ${streamInfo.icon} ${streamInfo.text}`,
                        url: src.url
                    });
                });
            }
        }

        // Tekrar eden URL'leri temizle ve döndür
        return finalResults.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);

    } catch (err) { 
        console.error("Scraper Hatası:", err);
        return []; 
    }
}
