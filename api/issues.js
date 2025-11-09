// api/issues.js
export default async function handler(req, res) {
  const { debug, force } = req.query;

  const ORIGIN  = process.env.KEEMOTION_ORIGIN  || 'https://sportshub.keemotion.com';
  const REFERER = process.env.KEEMOTION_REFERER || 'https://sportshub.keemotion.com/';
  const AGENT   = process.env.KEEMOTION_AGENT   || 'KeecastWeb 5.24.2';
  const COOKIE  = process.env.KEEMOTION_COOKIE  || '';

  const endpoint = 'https://pointguard.keemotion.com/bandwidth-info';

  if (!COOKIE) {
    return res.status(200).json({
      items: [],
      error: 'Missing KEEMOTION_COOKIE (get it from PUT /auth/token)',
    });
  }

  try {
    const headers = {
      'Authorization': `OAuth2 ${COOKIE}`,
      'Keemotion-Agent': AGENT,
      'Origin': ORIGIN,
      'Referer': REFERER,
      'Accept': 'application/json',
    };

    const r = await fetch(endpoint, { headers, cache: 'no-store' });
    const text = await r.text();

    if (!r.ok) {
      return res.status(200).json({
        items: [],
        error: `Keemotion fetch failed (${r.status})`,
        debug: debug ? { status: r.status, body: text.slice(0,400) } : undefined
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    // Exemple de parsing simplifié : Keemotion renvoie un tableau de salles avec un champ `message` ou `status`
    const parseStatus = (msg = '') => {
      const s = msg.toLowerCase();
      if (s.includes('not sufficient') || s.includes('dropped below') || s.includes('below the minimum')) return 'insufficient';
      if (s.includes('offline')) return 'offline';
      if (s.includes('sufficient')) return 'ok';
      return 'unknown';
    };

    const items = (data.items || data.content || [])
      .map(a => {
        const statusText = a.message || a.status || a.bandwidth_status || '';
        const parsed = parseStatus(statusText);
        return {
          arena: a.name || a.arena || 'Unknown arena',
          vendor: 'Keemotion',
          status: parsed,
          note: statusText,
        };
      })
      .filter(a => a.status !== 'ok' && a.status !== 'unknown'); // garde seulement les problèmes

    return res.status(200).json({
      items,
      debug: debug ? { count: items.length, sample: items.slice(0,3), rawKeys: Object.keys(data || {}) } : undefined
    });
  } catch (err) {
    return res.status(200).json({
      items: [],
      error: 'Keemotion fetch error',
      debug: debug ? { message: String(err) } : undefined
    });
  }
}