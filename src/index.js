/* --- 1. ADIM: BAĞIMLILIKLAR --- */
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { getCatalog, getMeta, getStreams } = require('./scraper/hdfilmizle');

/* --- 2. ADIM: AYARLAR VE PORT --- */
const ADDON_ID = process.env.ADDON_ID || 'org.hdfilmizle.scraper';
const ADDON_NAME = process.env.ADDON_NAME || 'HDfilmizle Scraper';
const PORT = Number(process.env.PORT || 7000);

/* --- 3. ADIM: MANIFEST --- */
const manifest = {
  id: ADDON_ID,
  version: '1.0.0',
  name: ADDON_NAME,
  description: 'hdfilmizle.to üzerinden film ve dizi katalogu sağlar.',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['hdfilmizle:movie:', 'hdfilmizle:series:'],
  catalogs: [
    { type: 'movie', id: 'hdfilmizle-movies', name: 'HDfilmizle Filmler', extra: [{ name: 'search', isRequired: false }] },
    { type: 'series', id: 'hdfilmizle-series', name: 'HDfilmizle Diziler', extra: [{ name: 'search', isRequired: false }] },
  ],
  behaviorHints: { configurable: false, configurationRequired: false },
};

/* --- 4. ADIM: BUILDER OLUŞTURMA (Hatanın Çözümü Burası) --- */
// Bilgi: Builder'ı handlerlardan ve serveHTTP'den ÖNCE tanımlıyoruz.
const builder = new addonBuilder(manifest);

/* --- 5. ADIM: HANDLER TANIMLAMALARI --- */
builder.defineCatalogHandler(async ({ type, id, extra = {} }) => {
  try {
    const metas = await getCatalog(type, extra.search || '');
    return { metas };
  } catch (error) {
    console.error('Catalog hatası:', error.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const meta = await getMeta(type, id);
    return { meta };
  } catch (error) {
    console.error('Meta hatası:', error.message);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ type, id }) => {
  try {
    const streams = await getStreams(type, id);
    return { streams };
  } catch (error) {
    console.error('Stream hatası:', error.message);
    return { streams: [] };
  }
});

/* --- 6. ADIM: SUNUCUYU BAŞLATMA (EN SONDA OLMALI) --- */
// Bilgi: hostname '0.0.0.0' Render'ın dışarıya açılması için şarttır.
serveHTTP(builder.getInterface(), { 
    port: PORT, 
    hostname: '0.0.0.0' 
});

console.log(`✅ ${ADDON_NAME} yayında! Port: ${PORT}`);
