/* --- scraper/rectv.js --- */
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";

const HEADERS = {
    'User-Agent': 'okhttp/4.12.0',
    'Accept': 'application/json',
    'hash256': '711bff4afeb47f07ab08a0b07e85d3835e739295e8a6361db77eebd93d96306b'
};

export async function getStreams(type, id) {
    /* BILGI NOTU: Scraper tetiklendi. */
    console.error(`[SCRAPER] İŞLEM BAŞLADI -> ID: ${id}`);

    try {
        // 1. NONCE (TOKEN) ALMA
        const nRes = await fetch(`${BASE_URL}/api/attest/nonce`, { headers: HEADERS });
        const nText = await nRes.text();
        let token = "";
        try { token = JSON.parse(nText).accessToken || nText.trim(); } catch(e) { token = nText.trim(); }

        console.error(`[SCRAPER] TOKEN ALINDI: ${token.substring(0, 15)}...`);

        const authHeaders = { ...HEADERS, 'Authorization': `Bearer ${token}` };

        // 2. ARAMA YAPMA (ID'den temiz isim çıkart)
        const searchQuery = id.startsWith("CH_") ? id.replace("CH_", "").split('_').join(' ') : id;
        console.error(`[SCRAPER] Arama Sorgusu: "${searchQuery}"`);

        const sRes = await fetch(`${BASE_URL}/api/search/${encodeURIComponent(searchQuery)}/${SW_KEY}/`, { headers: authHeaders });
        const sData = await sRes.json();
        
        /* BILGI NOTU: Arama sonucunda gelen ham veriye bakıyoruz */
        console.error(`[SCRAPER] SİTEDEN GELEN ARAMA YANITI: ${JSON.stringify(sData).substring(0, 200)}`);

        const found = (sData.channels || []).find(c => (c.title || c.name || "").toLowerCase().includes(searchQuery.toLowerCase()))
                    || (sData.posters || sData.series || [])[0];

        if (!found) {
            console.error(`[SCRAPER] !!! HATA: "${searchQuery}" için sitede sonuç bulunamadı.`);
            return [];
        }

        // 3. DETAYLARI VE LİNKLERİ ÇEKME
        const finalUrl = `${BASE_URL}/api/${type === 'tv' ? 'channel' : (found.type === 'serie' ? 'serie' : 'movie')}/${found.id}/${SW_KEY}/`;
        console.error(`[SCRAPER] Detaylar Çekiliyor: ${finalUrl}`);

        const dRes = await fetch(finalUrl, { headers: authHeaders });
        const dData = await dRes.json();

        /* BILGI NOTU: Linklerin olduğu ham veriye bakıyoruz */
        console.error(`[SCRAPER] SİTEDEN GELEN KAYNAK VERİSİ: ${JSON.stringify(dData).substring(0, 200)}`);

        const sources = dData.sources || (Array.isArray(dData) ? dData : []);
        
        const streams = sources.map((s, i) => ({
            name: "RECTV",
            title: `Kaynak ${i + 1}`,
            url: s.url,
            behaviorHints: { notWebReady: true, bingeGroup: id }
        }));

        console.error(`[SCRAPER] ✅ İŞLEM TAMAM: ${streams.length} adet link bulundu.`);
        return streams;

    } catch (e) {
        console.error(`[SCRAPER] !!! KRİTİK HATA: ${e.message}`);
        return [];
    }
}
