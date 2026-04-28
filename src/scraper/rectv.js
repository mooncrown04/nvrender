const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const FULL_HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

export async function getStreams(type, id) {
    /* BILGI NOTU: Scraper baslatildi, ID ve Type analizi yapiliyor */
    console.error(`[SCRAPER_START] Gelen Veri -> ID: ${id}, TYPE: ${type}`);

    try {
        // 1. NONCE/TOKEN ALMA
        console.error("[DEBUG_1] Token isteniyor...");
        const nonceRes = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: FULL_HEADERS });
        const nonceText = await nonceRes.text();
        console.error(`[DEBUG_2] Siteden Gelen Ham Token Verisi: ${nonceText.substring(0, 100)}`);

        let token = "";
        try {
            token = JSON.parse(nonceText).accessToken || nonceText.trim();
        } catch(e) { token = nonceText.trim(); }

        const authHeaders = { 
            ...FULL_HEADERS, 
            'Authorization': `Bearer ${token}` 
        };

        // 2. ARAMA SORGUSU HAZIRLAMA
        let searchQuery = "";
        if (id.startsWith("CH_")) {
            searchQuery = id.replace("CH_", "").split('_').join(' ');
        } else if (id.startsWith("tt")) {
            // Film/Dizi ise TMDB'den isim bulma mantigi buraya girecek
            // Simdilik ID'yi sorgu yapalim (veya meta'dan gelen ismi kullan)
            searchQuery = id; 
        }

        console.error(`[DEBUG_3] Arama basliyor: "${searchQuery}"`);

        const searchUrl = `${BASE_URL}/api/search/${encodeURIComponent(searchQuery)}/${SW_KEY}/`;
        const sRes = await fetch(searchUrl, { headers: authHeaders });
        const sData = await sRes.json();

        /* BILGI NOTU: Siteden gelen tum ham arama sonuclari */
        console.error(`[DEBUG_4] Siteden Gelen Ham Arama Verisi: ${JSON.stringify(sData).substring(0, 300)}`);

        // 3. EŞLEŞEN KANALI/İÇERİĞİ BULMA
        const found = (sData.channels || []).find(c => (c.title || c.name || "").toLowerCase().includes(searchQuery.toLowerCase())) 
                    || (sData.posters || []).find(p => (p.title || p.name || "").toLowerCase().includes(searchQuery.toLowerCase()))
                    || (sData.series || []).find(s => (s.title || s.name || "").toLowerCase().includes(searchQuery.toLowerCase()));

        if (!found) {
            console.error(`[DEBUG_5] !!! ESLESME BULUNAMADI: "${searchQuery}" RecTV API'sinde yok.`);
            return [];
        }

        console.error(`[DEBUG_6] Eslesme Bulundu: ${found.title || found.name} (ID: ${found.id})`);

        // 4. KAYNAK (URL) CEKME
        const finalUrl = `${BASE_URL}/api/${found.type === 'serie' ? 'serie' : (type === 'tv' ? 'channel' : 'movie')}/${found.id}/${SW_KEY}/`;
        console.error(`[DEBUG_7] Kaynak Detay URL: ${finalUrl}`);

        const detRes = await fetch(finalUrl, { headers: authHeaders });
        const detData = await detRes.json();

        /* BILGI NOTU: Siteden gelen ham kaynak verisi */
        console.error(`[DEBUG_8] Siteden Gelen Ham Detay Verisi: ${JSON.stringify(detData).substring(0, 300)}`);

        const sources = detData.sources || detData || [];
        
        const results = (Array.isArray(sources) ? sources : []).map((src, idx) => ({
            name: "RECTV",
            title: `${found.title || found.name} - Kaynak ${idx + 1}`,
            url: src.url,
            behaviorHints: { notWebReady: true, bingeGroup: id }
        }));

        console.error(`[DEBUG_9] ISLEM TAMAM: ${results.length} adet stream bulundu.`);
        return results;

    } catch (err) {
        console.error(`[DEBUG_FATAL] KRITIK HATA: ${err.message}`);
        return [];
    }
}
