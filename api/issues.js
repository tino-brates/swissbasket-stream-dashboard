export default async function handler(req, res) {
  const {
    KEEMOTION_API_BASE = 'https://pointguard.keemotion.com',
    KEEMOTION_ARENAS_BASEPATH = '/game/arenas',
    KEEMOTION_LIMIT = '100',
    KEEMOTION_OFFSET = '0',
    KEEMOTION_AUTH_SCHEME = 'OAuth2',
    KEEMOTION_TOKEN = '',
    KEEMOTION_REFERER = 'https://sportshub.keemotion.com/',
    KEEMOTION_ORIGIN = 'https://sportshub.keemotion.com',
    KEEMOTION_ACCEPT_LANGUAGE = 'fr-CH,fr;q=0.9,de-DE;q=0.8,de;q=0.7,en-US;q=0.6,en;q=0.5,fr-FR;q=0.4',
  } = process.env;

  const debug = req.query.debug === '1';

  const headers = {
    'Authorization': `${KEEMOTION_AUTH_SCHEME} ${KEEMOTION_TOKEN}`,
    'Keemotion-Agent': 'KeecastWeb 5.24.2',
    'Origin': KEEMOTION_ORIGIN,
    'Referer': KEEMOTION_REFERER,
    'Accept': 'application/json',
    'Accept-Language': KEEMOTION_ACCEPT_LANGUAGE,
    'User-Agent': 'Mozilla/5.0',
  };

  const url = `${KEEMOTION_API_BASE}${KEEMOTION_ARENAS_BASEPATH}?inactive=false&can_schedule=true&sort=name,asc&page=${KEEMOTION_OFFSET},${KEEMOTION_LIMIT}`;

  let arenasJson = null;
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const raw = await r.text();
      return res.status(200).json({
        items: [],
        error: `Keemotion fetch failed (${r.status})`,
        debug: debug ? { step: 'arenas', status: r.status, raw } : undefined,
      });
    }
    arenasJson = await r.json();
  } catch (e) {
    return res.status(200).json({
      items: [],
      error: `Keemotion fetch failed (network)`,
      debug: debug ? { step: 'arenas', err: String(e) } : undefined,
    });
  }

  const list = Array.isArray(arenasJson?.items) ? arenasJson.items : [];

  // Filtre “problèmes” minimal pour l’instant: on ne sait pas encore où Keemotion place les flags.
  // On renvoie vide par défaut jusqu’à ce qu’on voie les champs exacts en debug.
  const problems = [];

  if (debug) {
    // On retourne un échantillon pour qu’on voie la forme réelle des données.
    return res.status(200).json({
      items: problems,
      debug: {
        count: list.length,
        sample: list.slice(0, 5),
        usedUrl: url,
        sentHeaders: {
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