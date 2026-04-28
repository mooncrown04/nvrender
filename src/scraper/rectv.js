/* --- scraper/rectv.js --- */
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

// --- AUTH TOKEN ALICI ---
async function getAuthToken() {
    try {
        const res = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        const text = await res.text();
        let token = "";
        try {
            const json = JSON.parse(text);
            token = json.accessToken || text.trim();
        } catch(e) { token = text.trim(); }
        return token;
    } catch (e) {
        console.error("[DEBUG] !!! TOKEN ALINAMADI:", e.message);
        return null;
    }
}

export async function getStreams(type, id) {
    const token = await getAuthToken();
    if (!token) return [];

    const authHeaders = { ...FULL_HEADERS, 'Authorization': `Bearer ${token}` };

    // --- DURUM 1: CANLI TV (Statik veya Dinamik CH_ ID) ---
    if (id.startsWith("CH_") || type === 'tv') {
        const channelQuery = id.replace("CH_", "").split('_').join(' ').trim();
        console.error(`[DEBUG] TV ARAMASI BAŞLATILDI: "${channelQuery}"`);

        try {
            const searchRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(channelQuery)}/${SW_KEY}/`, { headers: authHeaders });
            const sData = await searchRes.json();
            
            // Konsolda gelen veriyi gör
            console.error(`[DEBUG] SITE'DEN GELEN HAM VERI (TV):`, JSON.stringify(sData).substring(0, 150));

            const channel = (sData.channels || []).find(c => 
                (c.title || c.name || "").toLowerCase().includes(channelQuery.toLowerCase())
            ) || (sData.channels?.[0]);

            if (channel) {
                console.error(`[DEBUG] KANAL BULUNDU: ${channel.title} (ID: ${channel.id})`);
                const detRes = await fetch(`${BASE_URL}/api/channel/${channel.id}/${SW_KEY}/`, { headers: authHeaders });
                const detData = await detRes.json();

                return (detData.sources || []).map((src, idx) => ({
                    name: "RECTV",
                    title: `${channel.title} - Kaynak ${idx + 1}`,
                    url: src.url,
                    behaviorHints: { notWebReady: true, bingeGroup: id }
                }));
            }
        } catch (e) { console.error("[DEBUG] TV Kazıma Hatası:", e.message); }
    }

    // --- DURUM 2: FILM VE DIZI (tt... ID) ---
    if (id.startsWith("tt")) {
        const pureId = id.split(':')[0]; // tt1234567
        const season = id.split(':')[1] || null;
        const episode = id.split(':')[2] || null;

        console.error(`[DEBUG] FILM/DIZI ISTEGI: ID=${pureId} S=${season} E=${episode}`);

        try {
            // 1. TMDB'den Türkçe İsmini Bul
            const tmdbUrl = `https://api.themoviedb.org/3/find/${pureId}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=tr-TR`;
            const tmdbRes = await fetch(tmdbUrl);
            const tmdbData = await tmdbRes.json();
            const media = (tmdbData.movie_results?.[0] || tmdbData.tv_results?.[0]);

            if (!media) return [];
            const trTitle = (media.title || media.name);
            console.error(`[DEBUG] TMDB'DEN ISIM ALINDI: "${trTitle}"`);

            // 2. RecTV'de Ara
            const searchRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(trTitle)}/${SW_KEY}/`, { headers: authHeaders });
            const sData = await searchRes.json();
            console.error(`[DEBUG] SITE'DEN GELEN HAM VERI (FILM):`, JSON.stringify(sData).substring(0, 150));

            const target = (sData.posters || []).concat(sData.series || []).find(item => 
                (item.title || item.name || "").toLowerCase().includes(trTitle.toLowerCase())
            );

            if (target) {
                // Film ise direkt çek, dizi ise sezon/bölüm bul
                let finalUrl = `${BASE_URL}/api/${target.type === 'serie' ? 'season/by/serie' : 'movie'}/${target.id}/${SW_KEY}/`;
                const detRes = await fetch(finalUrl, { headers: authHeaders });
                const detData = await detRes.json();

                let sources = [];
                if (target.type === 'serie' && season) {
                    const selSeason = detData.find(s => s.title.includes(season));
                    const selEp = selSeason?.episodes.find(e => e.title.includes(episode));
                    sources = selEp?.sources || [];
                } else {
                    sources = detData.sources || [];
                }

                return sources.map((src, idx) => ({
                    name: "RECTV",
                    title: `🎬 ${trTitle} - Kaynak ${idx + 1}`,
                    url: src.url,
                    behaviorHints: { bingeGroup: pureId }
                }));
            }
        } catch (e) { console.error("[DEBUG] Film/Dizi Kazıma Hatası:", e.message); }
    }

    return [];
}
