export default async function handler(req, res) {
  const {
    KEEMOTION_API_BASE = 'https://pointguard.keemotion.com',
    KEEMOTION_AUTH_SCHEME = 'OAuth2',
    KEEMOTION_TOKEN = '',
    KEEMOTION_REFERER = 'https://sportshub.keemotion.com/',
    KEEMOTION_ORIGIN = 'https://sportshub.keemotion.com',
    KEEMOTION_ACCEPT_LANGUAGE = 'fr-CH,fr;q=0.9,de-DE;q=0.8,de;q=0.7,en-US;q=0.6,en;q=0.5,fr-FR;q=0.4',
  } = process.env;

  res.setHeader('Cache-Control', 'no-store');

  if (!KEEMOTION_TOKEN) {
    return res.status(200).json({ items: [] });
  }

  const H = {
    'Authorization': `${KEEMOTION_AUTH_SCHEME} ${KEEMOTION_TOKEN}`,
    'Keemotion-Agent': 'KeecastWeb 5.24.2',
    'Origin': KEEMOTION_ORIGIN,
    'Referer': KEEMOTION_REFERER,
    'Accept': 'application/json',
    'Accept-Language': KEEMOTION_ACCEPT_LANGUAGE,
    'User-Agent': 'Mozilla/5.0',
  };

  async function fetchJSON(path) {
    const url = `${KEEMOTION_API_BASE}${path}`;
    const r = await fetch(url, { headers: H, cache: 'no-store' });
    if (!r.ok) return null;
    try { return await r.json(); } catch { return null; }
  }

  const arenas = await fetchJSON('/game/arenas?inactive=false&can_schedule=true&sort=name,asc&page=0,100');
  const bwInfo = await fetchJSON('/bandwidth-info');

  function toArray(d) {
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (Array.isArray(d.items)) return d.items;
    if (Array.isArray(d.data)) return d.data;
    return [];
  }

  const arenasArr = toArray(arenas);
  const infoArr = toArray(bwInfo);

  function pickName(o) {
    return o?.name || o?.arenaName || o?.arena || o?.title || o?.id || 'Arena';
  }

  function classify(text) {
    const t = (text || '').toLowerCase();
    if (t.includes('offline') || t.includes('no data') || t.includes('no ingest') || t.includes('encoder offline') || t.includes('not connected')) {
      return { code: 'offline', label: 'Offline' };
    }
    if (t.includes('insufficient') || t.includes('insuffisant') || t.includes('low') || t.includes('unstable') || t.includes('poor')) {
      return { code: 'insufficient', label: 'Insuffisant' };
    }
    if (t.includes('sufficient') || t.includes('good') || t.includes('ok') || t.includes('stable')) {
      return { code: 'sufficient', label: 'Suffisant' };
    }
    return { code: 'unknown', label: 'Inconnu' };
  }

  function flat(o, depth = 2) {
    if (!o || depth < 0) return '';
    if (typeof o === 'string') return o;
    if (typeof o === 'number' || typeof o === 'boolean') return String(o);
    if (Array.isArray(o)) return o.map(v => flat(v, depth - 1)).join(' ');
    return Object.values(o).map(v => flat(v, depth - 1)).join(' ');
  }

  const byName = {};
  arenasArr.forEach(a => {
    const k = pickName(a);
    if (!byName[k]) byName[k] = { arena: k, vendor: 'Keemotion', statusCode: 'unknown', statusLabel: 'Inconnu', note: '', source: 'arenas' };
  });

  infoArr.forEach(b => {
    const k = pickName(b);
    const text = flat(b);
    const cls = classify(text);
    if (!byName[k]) byName[k] = { arena: k, vendor: 'Keemotion', statusCode: cls.code, statusLabel: cls.label, note: text.slice(0, 160), source: 'bandwidth-info' };
    else {
      byName[k].statusCode = cls.code;
      byName[k].statusLabel = cls.label;
      byName[k].note = text.slice(0, 160);
      byName[k].source = 'bandwidth-info';
    }
  });

  const all = Object.values(byName);
  const onlyProblems = all.filter(x => x.statusCode === 'insufficient' || x.statusCode === 'offline');

  const items = onlyProblems.map(x => ({
    arena: x.arena,
    vendor: x.vendor,
    status: x.statusLabel,
    statusCode: x.statusCode,
    note: x.note
  }));

  return res.status(200).json({ items });
}