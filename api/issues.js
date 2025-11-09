export default async function handler(req, res) {
  // --- ENV ---
  const {
    KEEMOTION_API_BASE = 'https://pointguard.keemotion.com',
    KEEMOTION_AUTH_SCHEME = 'OAuth2',
    KEEMOTION_TOKEN = '',
    KEEMOTION_REFERER = 'https://sportshub.keemotion.com/',
    KEEMOTION_ORIGIN = 'https://sportshub.keemotion.com',
    KEEMOTION_ACCEPT_LANGUAGE = 'fr-CH,fr;q=0.9,de-DE;q=0.8,de;q=0.7,en-US;q=0.6,en;q=0.5,fr-FR;q=0.4',
  } = process.env;

  const debug = req.query.debug === '1';
  const force = req.query.force === '1';

  // Pas de cache côté Vercel
  res.setHeader('Cache-Control', 'no-store');

  // --- HEADERS copiés du Network Keemotion ---
  const H = {
    'Authorization': `${KEEMOTION_AUTH_SCHEME} ${KEEMOTION_TOKEN}`,
    'Keemotion-Agent': 'KeecastWeb 5.24.2', // reproduit l’agent du navigateur Sporthub
    'Origin': KEEMOTION_ORIGIN,
    'Referer': KEEMOTION_REFERER,
    'Accept': 'application/json',
    'Accept-Language': KEEMOTION_ACCEPT_LANGUAGE,
    'User-Agent': 'Mozilla/5.0', // peu importe ici
  };

  async function fetchJSON(path) {
    const url = `${KEEMOTION_API_BASE}${path}`;
    let bodyText = null;
    let json = null;
    let status = 0;
    try {
      const r = await fetch(url, { headers: H });
      status = r.status;
      bodyText = await r.text();
      try { json = JSON.parse(bodyText); } catch (_) {}
      return { ok: r.ok, status, url, json, bodyText };
    } catch (e) {
      return { ok: false, status: -1, url, json: null, bodyText: String(e) };
    }
  }

  // Endpoints qu’on a vu dans Network
  const arenasResp = await fetchJSON('/game/arenas?inactive=false&can_schedule=true&sort=name,asc&page=0,100');
  const bwInfoResp = await fetchJSON('/bandwidth-info');
  const bwMetricsResp = await fetchJSON('/bandwidth-metrics?from=3');

  // Helper pour récupérer un tableau quelle que soit la forme
  const toArray = (data) => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  };

  const arenas = toArray(arenasResp.json);
  const bwInfo = toArray(bwInfoResp.json);
  const bwMetrics = toArray(bwMetricsResp.json);

  // Heuristique sans “bad” (évite ‘Baden’)
  const BAD_WORDS = /(signal\s*unstable|unstable|no\s?ingest|no\s?data|encoder\s*offline|offline|freeze|freezed?|critical|alert)/i;

  const flatText = (obj, depth = 2) => {
    if (!obj || depth < 0) return '';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    if (Array.isArray(obj)) return obj.map(v => flatText(v, depth - 1)).join(' ');
    return Object.values(obj).map(v => flatText(v, depth - 1)).join(' ');
  };

  const pickName = (obj) =>
    obj?.name || obj?.arenaName || obj?.arena || obj?.title || obj?.id || 'Arena';

  const problems = [];

  // a) arenas
  arenas.forEach(a => {
    const text = flatText(a);
    if (BAD_WORDS.test(text)) {
      problems.push({
        arena: pickName(a),
        vendor: 'Keemotion',
        status: 'issue',
        note: text.slice(0, 160),
        source: 'arenas',
      });
    }
  });

  // b) bandwidth-info
  bwInfo.forEach(b => {
    const text = flatText(b);
    if (BAD_WORDS.test(text)) {
      problems.push({
        arena: pickName(b),
        vendor: 'Keemotion',
        status: 'issue',
        note: text.slice(0, 160),
        source: 'bandwidth-info',
      });
    }
  });

  // c) bandwidth-metrics
  bwMetrics.forEach(m => {
    const text = flatText(m);
    if (BAD_WORDS.test(text)) {
      problems.push({
        arena: pickName(m),
        vendor: 'Keemotion',
        status: 'issue',
        note: text.slice(0, 160),
        source: 'bandwidth-metrics',
      });
    }
  });

  // Mode “force” pour tester l’UI : on renvoie 3 premières arènes
  if (force && problems.length === 0) {
    arenas.slice(0, 3).forEach(a => {
      problems.push({
        arena: pickName(a),
        vendor: 'Keemotion',
        status: 'issue',
        note: flatText(a).slice(0, 160),
        source: 'force',
      });
    });
  }

  if (debug) {
    return res.status(200).json({
      items: problems,
      debug: {
        arenas: {
          status: arenasResp.status,
          url: arenasResp.url,
          count: arenas.length,
          sample: arenas.slice(0, 3),
        },
        bandwidthInfo: {
          status: bwInfoResp.status,
          url: bwInfoResp.url,
          count: bwInfo.length,
          sample: bwInfo.slice(0, 3),
        },
        bandwidthMetrics: {
          status: bwMetricsResp.status,
          url: bwMetricsResp.url,
          count: bwMetrics.length,
          sample: bwMetrics.slice(0, 3),
        },
        headersSent: {
          Authorization: `${KEEMOTION_AUTH_SCHEME} <redacted>`,
          'Keemotion-Agent': 'KeecastWeb 5.24.2',
          Origin: KEEMOTION_ORIGIN,
          Referer: KEEMOTION_REFERER,
        },
      },
    });
  }

  return res.status(200).json({ items: problems });
}