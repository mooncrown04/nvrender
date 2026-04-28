/* --- 1. AYARLAR --- */
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
    } catch (e) { 
        console.error("!!! AUTH TOKEN HATASI:", e);
        return null; 
    }
}

function analyzeStream(url, index, itemLabel) {
    const lowUrl = url.toLowerCase();
    const lowLabel = (itemLabel || "").toLowerCase();
    let info = { icon: "🌐", text: "Altyazı" };
    const isTurkish = lowLabel.includes("dublaj") || lowLabel.includes("yerli") || lowLabel.includes("tr dub") || lowUrl.includes("dublaj");
    if (isTurkish) {
        info = (lowLabel.includes("altyazı") && index === 1) ? { icon: "🌐", text: "Altyazı" } : { icon: "🇹🇷", text: "Dublaj" };
    }
    return info;
}

/* --- 3. ANA SCRAPER (getStreams) --- */

export async function getStreams(type, id) {
    try {
        const token = await getAuthToken();
        const searchHeaders = Object.assign({}, HEADERS, { 'Authorization': 'Bearer ' + token });

        /* --- CANLI TV KONTROLÜ --- */
        if (id.startsWith("CH_") || type === 'tv') {
            const cleanName = id.replace("CH_", "").split('_').join(' ').trim();
            console.error("--- CANLI TV İSTEĞİ: " + cleanName + " ---");

            const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(cleanName)}/${SW_KEY}/`, { headers: searchHeaders });
            const sData = await sRes.json();
            
            // HAM VERİ KONTROLÜ
            console.error("HAM ARAMA VERİSİ:", JSON.stringify(sData).substring(0, 200));

            const found = (sData.channels || []).find(c => 
                (c.title || c.name).toLowerCase().trim() === cleanName.toLowerCase()
            ) || (sData.channels ? sData.channels[0] : null);

            if (found) {
                const res = await fetch(`${BASE_URL}/api/channel/${found.id}/${SW_KEY}/`, { headers: searchHeaders });
                const data = await res.json();
                console.error("KANAL DETAY VERİSİ:", JSON.stringify(data));

                return (data.sources || []).map((src, idx) => ({
                    name: `RECTV ${found.title}`,
                    title: `${found.title} | Kaynak ${idx + 1}`,
                    url: src.url,
                    behaviorHints: { 
                        notWebReady: true,
                        bingeGroup: id 
                    }
                }));
            }
            console.error("!!! KANAL BULUNAMADI: " + cleanName);
            return [];
        }

        /* --- FİLM VE DİZİ KONTROLÜ --- */
        const isMovie = (type === 'movie');
        const tmdbImdbId = id.split(':')[0]; 
        const seasonNum = id.split(':')[1] || 1;
        const episodeNum = id.split(':')[2] || 1;

        console.error(`--- İÇERİK İSTEĞİ: ${tmdbImdbId} (S:${seasonNum} E:${episodeNum}) ---`);

        const tmdbUrl = `https://api.themoviedb.org/3/find/tt${tmdbImdbId.replace("tt","")}?external_source=imdb_id&language=tr-TR&api_key=${TMDB_API_KEY}`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        const result = isMovie ? tmdbData.movie_results?.[0] : tmdbData.tv_results?.[0];

        if (!result) {
            console.error("!!! TMDB VERİSİ BULUNAMADI");
            return [];
        }

        const trTitle = (result.title || result.name || "").trim();
        const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(trTitle)}/${SW_KEY}/`;
        const sRes = await fetch(searchUrl, { headers: searchHeaders });
        const sData = await sRes.json();

        let allItems = (sData.series || []).concat(sData.posters || []);
        let finalResults = [];

        for (let target of allItems) {
            const isActuallySerie = target.type === "serie" || (target.label && target.label.toLowerCase().includes("dizi"));
            if (isMovie && isActuallySerie) continue;

            if (isActuallySerie && !isMovie) {
                const seasonRes = await fetch(`${BASE_URL}/api/season/by/serie/${target.id}/${SW_KEY}/`, { headers: searchHeaders });
                const seasons = await seasonRes.json();
                for (let s of seasons) {
                    if (parseInt(s.title.match(/\d+/) || 0) == seasonNum) {
                        for (let ep of s.episodes) {
                            if (parseInt(ep.title.match(/\d+/) || 0) == episodeNum) {
                                (ep.sources || []).forEach((src, idx) => {
                                    const info = analyzeStream(src.url, idx, ep.label);
                                    finalResults.push({
                                        name: "RECTV",
                                        title: `${info.icon} ${info.text} - K${idx+1}`,
                                        url: src.url,
                                        behaviorHints: { bingeGroup: tmdbImdbId }
                                    });
                                });
                            }
                        }
                    }
                }
            } else if (isMovie) {
                const detRes = await fetch(`${BASE_URL}/api/movie/${target.id}/${SW_KEY}/`, { headers: searchHeaders });
                const detData = await detRes.json();
                (detData.sources || []).forEach((src, idx) => {
                    const info = analyzeStream(src.url, idx, detData.label);
                    finalResults.push({
                        name: "RECTV",
                        title: `${info.icon} ${info.text} - K${idx+1}`,
                        url: src.url,
                        behaviorHints: { bingeGroup: tmdbImdbId }
                    });
                });
            }
        }

        console.error(`TOPLAM BULUNAN KAYNAK: ${finalResults.length}`);
        return finalResults.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);

    } catch (err) {
        console.error("!!! KRİTİK SCRAPER HATASI:", err);
        return [];
    }
}
