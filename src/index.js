const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { BASE_URL, getCatalog, getMeta, getStreams } = require('./scraper/hdfilmizle');

const ADDON_ID = process.env.ADDON_ID || 'org.hdfilmizle.scraper';
const ADDON_NAME = process.env.ADDON_NAME || 'HDfilmizle Scraper';
const PORT = Number(process.env.PORT || 7000);
const BASE_ENDPOINT = process.env.BASE_ENDPOINT || `http://127.0.0.1:${PORT}`;

const manifest = {
  id: ADDON_ID,
  version: '1.0.0',
  name: ADDON_NAME,
  description:
    'hdfilmizle.to üzerinden film ve dizi katalogu + stream sağlayan community eklentisi.',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['hdfilmizle:movie:', 'hdfilmizle:series:'],
  catalogs: [
    {
      type: 'movie',
      id: 'hdfilmizle-movies',
      name: 'HDfilmizle Filmler',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'series',
      id: 'hdfilmizle-series',
      name: 'HDfilmizle Diziler',
      extra: [{ name: 'search', isRequired: false }],
    },
  ],
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
  },
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra = {} }) => {
  if (!['movie', 'series'].includes(type)) {
    return { metas: [] };
  }

  if (!['hdfilmizle-movies', 'hdfilmizle-series'].includes(id)) {
    return { metas: [] };
  }

  try {
    const metas = await getCatalog(type, extra.search || '');
    return { metas };
  } catch (error) {
    console.error('Catalog handler error:', error.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (!id?.startsWith(`hdfilmizle:${type}:`)) {
    return { meta: null };
  }

  try {
    const meta = await getMeta(type, id);
    return { meta };
  } catch (error) {
    console.error('Meta handler error:', error.message);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (!id?.startsWith(`hdfilmizle:${type}:`)) {
    return { streams: [] };
  }

  try {
    const streams = await getStreams(type, id);
    return { streams };
  } catch (error) {
    console.error('Stream handler error:', error.message);
    return { streams: [] };
  }
});

serveHTTP(builder.getInterface(), { port: PORT });

console.log(`✅ ${ADDON_NAME} çalışıyor: ${BASE_ENDPOINT}/manifest.json`);
console.log(`🌍 Kaynak: ${BASE_URL}`);
