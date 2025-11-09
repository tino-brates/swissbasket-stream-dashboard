const SHEET_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJbAy9lLRUi22IZZTwuL0hpbMdekSoyFbL05_GaO2p9gbHJFQYVomMlKIM8zRKX0e42B9awnelGz5H/pub?gid=1442510586&single=true&output=csv";
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

async function getAccessToken() {
  const clientId = process.env.YT_PLAYGROUND_CLIENT_ID || process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_PLAYGROUND_CLIENT_SECRET || process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_PLAYGROUND_REFRESH_TOKEN || process.env.YT_REFRESH_TOKEN;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  if (!r.ok) throw new Error('token');
  const j = await r.json();
  return j.access_token;
}

function splitCSVLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else { cur += c; }
  }
  out.push(cur);
  return out.map(s => s.trim());
}
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).map(l => {
    const cols = splitCSVLine(l);
    const o = {};
    headers.forEach((h, i) => o[h] = cols[i] ?? '');
    return o;
  });
}
function toDateTimeCH(dateStr, timeStr) {
  const ds = (dateStr || '').trim();
  const ts = (timeStr || '').trim();
  let m = ds.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const dd = parseInt(m[1],10), mm = parseInt(m[2],10), yyyy = parseInt(m[3],10);
    const tt = ts.match(/^(\d{1,2}):(\d{2})$/);
    const hh = tt ? parseInt(tt[1],10) : 0;
    const mn = tt ? parseInt(tt[2],10) : 0;
    return new Date(Date.UTC(yyyy, mm-1, dd, hh, mn, 0));
  }
  const t = Date.parse(ds + (ts ? ` ${ts}` : ''));
  return Number.isNaN(t) ? null : new Date(t);
}
function normProd(s) {
  const v = (s || '').toUpperCase();
  if (v.includes('KEEMOTION')) return 'Keemotion';
  if (v.includes('SWISH')) return 'Swish Live';
  if (v.includes('MANUAL')) return 'Manual';
  if (v.trim() === 'TV') return 'TV';
  return '';
}

export default async function handler(req, res) {
  try {
    const r = await fetch(SHEET_CSV);
    if (!r.ok) throw new Error('sheet');
    const text = await r.text();
    const rows = parseCSV(text);

    const now = Date.now();
    const horizon = now + 30*24*60*60*1000;

    const sheetItems = rows.map(row => {
      const dateCol = row.Date || row.DATE || row.date || row['Date du match'] || '';
      const timeCol = row.Time || row.TIME || row.time || row.Heure || '';
      const teamA = row['Home Team'] || row.Home || row['Equipe A'] || row.TeamA || row.HomeTeam || '';
      const teamB = row['Away Team'] || row.Away || row['Equipe B'] || row.TeamB || row.AwayTeam || '';
      const arena = row.Arena || row.Hall || row.Salle || row.Venue || '';
      const production = row.Production || row['Production'] || row.Prod || row.Method || '';
      const yt = row['YouTube ID'] || row['YT ID'] || row['YouTube'] || row['youtubeEventId'] || '';
      const competition = row.Competition || row.League || row['Compétition'] || '';
      const dt = toDateTimeCH(dateCol, timeCol);
      return {
        datetime: dt ? dt.toISOString() : null,
        teamA,
        teamB,
        arena,
        production,
        youtubeEventId: yt,
        competition,
        source: 'sheet'
      };
    })
    .filter(x => x.datetime)
    .filter(x => {
      const t = new Date(x.datetime).getTime();
      return t >= now && t <= horizon;
    })
    .filter(x => !!normProd(x.production));

    let ytItems = [];
    try {
      const access = await getAccessToken();
      const u = new URL('https://www.googleapis.com/youtube/v3/liveBroadcasts');
      u.searchParams.set('part', 'snippet,contentDetails,status');
      u.searchParams.set('broadcastStatus', 'upcoming');
      u.searchParams.set('broadcastType', 'all');
      u.searchParams.set('mine', 'true');
      u.searchParams.set('maxResults', '50');

      const yr = await fetch(u.toString(), { headers: { Authorization: `Bearer ${access}` }});
      if (!yr.ok) throw new Error('yt');
      const yj = await yr.json();

      ytItems = (yj.items || []).map(b => {
        const start = b.snippet?.scheduledStartTime || b.snippet?.publishedAt || null;
        return {
          datetime: start,
          teamA: b.snippet?.title || '',
          teamB: '',
          arena: '',
          production: 'Manual',
          youtubeEventId: b.id,
          competition: '',
          source: 'youtube'
        };
      }).filter(x => x.datetime).filter(x => new Date(x.datetime).getTime() >= now && new Date(x.datetime).getTime() <= horizon);
    } catch {}

    const seen = new Set();
    const merged = [...sheetItems, ...ytItems].filter(it => {
      if (it.youtubeEventId) {
        if (seen.has(it.youtubeEventId)) return false;
        seen.add(it.youtubeEventId);
      }
      return true;
    });

    res.status(200).json({ items: merged });
  } catch {
    res.status(200).json({ items: [] });
  }
}