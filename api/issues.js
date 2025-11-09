export default async function handler(req, res) {
  const {
    KEEMOTION_API_BASE = 'https://pointguard.keemotion.com',
    KEEMOTION_AUTH_SCHEME = 'OAuth2',
    KEEMOTION_TOKEN = '',
    KEEMOTION_REFERER = 'https://sportshub.keemotion.com/',
    KEEMOTION_ORIGIN = 'https://sportshub.keemotion.com',
    KEEMOTION_ACCEPT_LANGUAGE = 'fr-CH,fr;q=0.9,de-DE;q=0.8,de;q=0.7,en-US;q=0.6,en;q=0.5,fr-FR;q=0.4',
  } = process.env;

  const debug = req.query.debug === '1';

  const H = {
    'Authorization': `${KEEMOTION_AUTH_SCHEME} ${KEEMOTION_TOKEN}`,
    'Keemotion-Agent': 'KeecastWeb 5.24.2',
    'Origin': KEEMOTION_ORIGIN,
    'Referer': KEEMOTION_REFERER,
    'Accept': 'application/json',
    'Accept-Language': KEEMOTION_ACCEPT_LANGUAGE,
    'User-Agent': 'Mozilla/5.0',
  };

  async function fetchAny(path) {
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

  // 1) Arenas (liste des salles)
  const arenasResp = await fetchAny('/game/arenas?inactive=false&can_schedule=true&sort=name,asc&page=0,100');

  // 2) Infos bande passante par arène
  const bwInfoResp = await fetchAny('/bandwidth-info');

  // 3) Métriques bande passante des N derniers jours (3 par défaut)
  const bwMetricsResp = await fetchAny('/bandwidth-metrics?from=3');

  // Utilitaires
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

  // Heuristique de détection des problèmes (à ajuster en fonction du debug réel)
  const BAD_WORDS = /(unstable|no\s?ingest|no\s?data|offline|freeze|bad)/i;

  function flatText(obj, depth = 2) {
    if (!obj || depth < 0) return '';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    if (Array.isArray(obj)) return obj.map(v => flatText(v, depth - 1)).join(' ');
    return Object.values(obj).map(v => flatText(v, depth - 1)).join(' ');
  }

  function pickName(obj) {
    return obj?.name || obj?.arenaName || obj?.arena || obj?.title || obj?.id || 'Arena';
  }

  // On tente de fabriquer une liste "problèmes" en combinant les sources
  const problems = [];

  // a) depuis arenas
  arenas.forEach(a => {
    const text = flatText(a);
    if (BAD_WORDS.test(text)) {
      problems.push({
        arena: pickName(a),
        vendor: 'Keemotion',
        status: 'issue',
        note: text.slice(0, 160),
        source: 'arenas'
      });
    }
  });

  // b) depuis bandwidth-info
  bwInfo.forEach(b => {
    const text = flatText(b);
    if (BAD_WORDS.test(text)) {
      problems.push({
        arena: pickName(b),
        vendor: 'Keemotion',
        status: 'issue',
        note: text.slice(0, 160),
        source: 'bandwidth-info'
      });
    }
  });

  // c) depuis bandwidth-metrics (si métriques indiquent "no data" / "offline" / "unstable")
  bwMetrics.forEach(m => {
    const text = flatText(m);
    if (BAD_WORDS.test(text)) {
      problems.push({
        arena: pickName(m),
        vendor: 'Keemotion',
        status: 'issue',
        note: text.slice(0, 160),
        source: 'bandwidth-metrics'
      });
    }
  });

  if (debug) {
    return res.status(200).json({
      items: problems,
      debug: {
        arenas: {
          status: arenasResp.status,
          url: arenasResp.url,
          type: Array.isArray(arenasResp.json) ? 'array' : typeof arenasResp.json,
          count: arenas.length,
          sample: arenas.slice(0, 3),
        },
        bandwidthInfo: {
          status: bwInfoResp.status,
          url: bwInfoResp.url,
          type: Array.isArray(bwInfoResp.json) ? 'array' : typeof bwInfoResp.json,
          count: bwInfo.length,
          sample: bwInfo.slice(0, 3),
        },
        bandwidthMetrics: {
          status: bwMetricsResp.status,
          url: bwMetricsResp.url,
          type: Array.isArray(bwMetricsResp.json) ? 'array' : typeof bwMetricsResp.json,
          count: bwMetrics.length,
          sample: bwMetrics.slice(0, 3),
        },
        headersSent: {
          Authorization: `${KEEMOTION_AUTH_SCHEME} <redacted>`,
          'Keemotion-Agent': 'KeecastWeb 5.24.2',
          Origin: KEEMOTION_ORIGIN,
          Referer: KEEMOTION_REFERER,
        }
      }
    });
  }

  return res.status(200).json({ items: problems });
}