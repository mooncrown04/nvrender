/* --- scraper/rectv.js --- */
var BASE_URL = "https://a.prectv70.lol";
var SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
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
    /* BILGI NOTU: Gelen ID parçalanıyor (tt123:1:1 veya tt123) */
    const parts = id.split(':');
    const imdbId = parts[0];
    const seasonNum = parts[1] || null;
    const episodeNum = parts[2] || null;
    const isSerie = !!seasonNum; // Sezon numarası varsa dizidir

    console.error(`[SCRAPER] Tetiklendi: ${imdbId} | Tip: ${mediaType} | S:${seasonNum} E:${episodeNum}`);

    try {
        // 1. TMDB ÜZERİNDEN İSİM BULMA
        const tmdbUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id&language=tr-TR`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        
        const meta = (tmdbData.movie_results && tmdbData.movie_results[0]) || 
                     (tmdbData.tv_results && tmdbData.tv_results[0]);

        if (!meta) {
            console.error(`[SCRAPER] TMDB'de kayıt bulunamadı: ${imdbId}`);
            return [];
        }

        const title = meta.title || meta.name;
        console.error(`[SCRAPER] Aranan İsim: ${title}`);

        // 2. RECTV ARAMA VE TOKEN
        const token = await getAuthToken();
        const searchHeaders = { ...HEADERS, 'Authorization': 'Bearer ' + token };
        const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(title)}/${SW_KEY}/`;
        
        const sRes = await fetch(searchUrl, { headers: searchHeaders });
        const sData = await sRes.json();
        const allItems = (sData.series || []).concat(sData.posters || []);

        let finalResults = [];

        // 3. EŞLEŞEN İÇERİĞİ BUL VE LİNKLERİ AL
        for (let target of allItems) {
            const targetTitle = (target.title || "").toLowerCase();
            const searchTitle = title.toLowerCase();

            // Basit isim kontrolü
            if (!targetTitle.includes(searchTitle) && !searchTitle.includes(targetTitle)) continue;

            if (isSerie && target.type === "serie") {
                // DİZİ İÇİN SEZON/BÖLÜM TARAMASI
                const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: searchHeaders });
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
                // FİLM İÇİN DETAY ÇEKME
                const detRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: searchHeaders });
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

        console.error(`[SCRAPER] Tamamlandı. Bulunan Link: ${finalResults.length}`);
        return finalResults.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);

    } catch (err) {
        console.error(`[SCRAPER_ERROR] Hata: ${err.message}`);
        return [];
    }
}
