import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import fetch from 'node-fetch';

const PORT = process.env.PORT || 7010;
const BASE_URL = "https://a.prectv70.lol";
const SW_KEY = "4F5A9C3D9A86FA54EACEDDD635185/c3c5bd17-e37b-4b94-a944-8a3688a30452";
const TMDB_KEY = "4ef0d7355d9ffb5151e987764708ce96";

const HEADERS = {
  'User-Agent': 'okhttp',
  'Accept': 'application/json'
};

/* ---------------- ID PARSER ---------------- */
function parseId(id) {
  if (id.startsWith("CH_")) {
    return {
      type: "tv",
      query: id.replace("CH_", "").replace(/_/g, " ")
    };
  }

  if (id.includes(":")) {
    const [imdb, s, e] = id.split(":");
    return {
      type: "series",
      imdb,
      season: Number(s),
      episode: Number(e)
    };
  }

  return {
    type: "movie",
    imdb: id
  };
}

/* ---------------- TMDB → NAME ---------------- */
async function idToName(id) {
  if (id.startsWith("CH_")) {
    return id.replace("CH_", "").replace(/_/g, " ");
  }

  const imdb = id.split(":")[0];

  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/find/tt${imdb}?api_key=${TMDB_KEY}&external_source=imdb_id`
    );
    const data = await res.json();

    const obj = data.movie_results?.[0] || data.tv_results?.[0];

    return obj?.title || obj?.name || imdb;
  } catch {
    return imdb;
  }
}

/* ---------------- RECTV SEARCH ---------------- */
async function searchRECTV(query) {
  const res = await fetch(
    `${BASE_URL}/api/search/${encodeURIComponent(query)}/${SW_KEY}/`,
    { headers: HEADERS }
  );
  const data = await res.json();
  return data.channels || data.series || data.posters || [];
}

/* ---------------- MANIFEST ---------------- */
const manifest = {
  id: "com.rectv.hybrid.pro",
  version: "1.0.0",
  name: "RECTV Hybrid Pro",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series", "tv"],
  idPrefixes: ["rectv_", "CH_", "tt"]
};

const builder = new addonBuilder(manifest);

/* ---------------- CATALOG ---------------- */
builder.defineCatalogHandler(async ({ id, type, extra }) => {

  if (id === "rc_live") {
    const q = extra?.search || "kanal";
    const items = await searchRECTV(q);

    return {
      metas: items.map(i => ({
        id: `CH_${(i.title || i.name).replace(/\s+/g, "_")}`,
        type: "tv",
        name: i.title || i.name,
        poster: i.image,
        posterShape: "landscape"
      }))
    };
  }

  const q = extra?.search || id.replace("rectv_", "");
  const items = await searchRECTV(q);

  return {
    metas: items.map(i => {
      const name = i.title || i.name;

      return {
        id: `rectv_${name.replace(/\s+/g, "_")}`,
        type,
        name,
        poster: i.image
      };
    })
  };
});

/* ---------------- META ---------------- */
builder.defineMetaHandler(async ({ id, type }) => {

  const parsed = parseId(id);

  if (parsed.type === "tv") {
    return {
      meta: {
        id,
        type: "tv",
        name: parsed.query,
        description: "Live TV"
      }
    };
  }

  const name = await idToName(id);

  return {
    meta: {
      id,
      type,
      name,
      description: "RECTV Content"
    }
  };
});

/* ---------------- STREAM ---------------- */
builder.defineStreamHandler(async ({ id, type }) => {

  const parsed = parseId(id);

  /* ---------------- TV STREAM ---------------- */
  if (parsed.type === "tv") {

    const items = await searchRECTV(parsed.query);
    const ch = items[0];

    if (!ch?.id) return { streams: [] };

    const res = await fetch(
      `${BASE_URL}/api/channel/${ch.id}/${SW_KEY}/`,
      { headers: HEADERS }
    );

    const data = await res.json();

    return {
      streams: (data.sources || []).map(s => ({
        name: "RECTV",
        title: s.title,
        url: s.url
      }))
    };
  }

  /* ---------------- MOVIE / SERIES STREAM ---------------- */

  const name = await idToName(id);

  const items = await searchRECTV(name);
  const item = items[0];

  if (!item?.id) return { streams: [] };

  const path = parsed.type === "series" ? "serie" : "movie";

  const res = await fetch(
    `${BASE_URL}/api/${path}/${item.id}/${SW_KEY}/`,
    { headers: HEADERS }
  );

  const data = await res.json();

  /* SERIES */
  if (parsed.type === "series") {

    const season = (data.seasons || [])
      .find(s => s.season_number == parsed.season);

    const ep = (season?.episodes || [])
      .find(e => e.episode_number == parsed.episode);

    return {
      streams: (ep?.sources || []).map(s => ({
        name: "RECTV",
        title: s.title,
        url: s.url
      }))
    };
  }

  /* MOVIE */
  return {
    streams: (data.sources || []).map(s => ({
      name: "RECTV",
      title: s.title,
      url: s.url
    }))
  };
});

/* ---------------- SERVER ---------------- */
serveHTTP(builder.getInterface(), { port: PORT });
