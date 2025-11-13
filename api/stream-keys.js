const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_BROADCASTS = "https://www.googleapis.com/youtube/v3/liveBroadcasts";
const YT_STREAMS = "https://www.googleapis.com/youtube/v3/liveStreams";

// même sheet que /api/upcoming
const SHEET_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJbAy9lLRUi22IZZTwuL0hpbMdekSoyFbL05_GaO2p9gbHJFQYVomMlKIM8zRKX0e42B9awnelGz5H/pub?gid=1442510586&single=true&output=csv";

function pickCreds() {
  const P = {
    client_id: process.env.YT_PLAYGROUND_CLIENT_ID,
    client_secret: process.env.YT_PLAYGROUND_CLIENT_SECRET,
    refresh_token: process.env.YT_PLAYGROUND_REFRESH_TOKEN
  };
  const D = {
    client_id: process.env.YT_CLIENT_ID,
    client_secret: process.env.YT_CLIENT_SECRET,
    refresh_token: process.env.YT_REFRESH_TOKEN
  };
  return (P.client_id && P.client_secret && P.refresh_token) ? P : D;
}

async function getAccessToken() {
  const { client_id, client_secret, refresh_token } = pickCreds();
  const body = new URLSearchParams({
    client_id,
    client_secret,
    refresh_token,
    grant_type: "refresh_token"
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`token(${r.status})`);
  return j.access_token;
}

// ---------- CSV utils (copiés de /api/upcoming) ----------
function splitCSVLine(line){
  const out=[]; let cur=""; let inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){
      if(inQ && line[i+1]==='"'){ cur+='"'; i++; }
      else inQ=!inQ;
    }else if(c===',' && !inQ){
      out.push(cur); cur="";
    }else{
      cur+=c;
    }
  }
  out.push(cur);
  return out.map(s=>s.trim());
}
function parseCSV(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim().length>0);
  if (!lines.length) return [];
  const headers=splitCSVLine(lines[0]).map(h=>h.trim());
  return lines.slice(1).map(l=>{
    const cols=splitCSVLine(l);
    const o={}; headers.forEach((h,i)=>o[h]=cols[i]??"");
    return o;
  });
}

// dd.mm.yyyy + HH:MM -> Date (UTC) comme /api/upcoming
function toDateTimeCH(dateStr,timeStr){
  const ds=(dateStr||"").trim();
  const ts=(timeStr||"").trim();
  const m=ds.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if(m){
    const dd=parseInt(m[1],10), mm=parseInt(m[2],10), yyyy=parseInt(m[3],10);
    const tt=ts.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    const hh=tt?parseInt(tt[1],10):0;
    const mn=tt?parseInt(tt[2],10):0;
    const ss=tt&&tt[3]?parseInt(tt[3],10):0;
    // même logique que /api/upcoming (hh-1)
    return new Date(Date.UTC(yyyy,mm-1,dd,hh-1,mn,ss));
  }
  const t=Date.parse(ds+(ts?` ${ts}`:""));
  return Number.isNaN(t)?null:new Date(t);
}

function getCI(map, ...keys){
  for(const k of keys){
    const kk=k.toLowerCase();
    if(kk in map) return map[kk];
  }
  return "";
}

// yyyy-mm-dd à partir d'un Date, en timezone CH
function ymdFromDateCH(d) {
  const parts = new Intl.DateTimeFormat("fr-CH", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d);
  const y = parts.find(p=>p.type==="year").value;
  const m = parts.find(p=>p.type==="month").value;
  const da = parts.find(p=>p.type==="day").value;
  return `${y}-${m}-${da}`;
}

// ---------- YouTube helpers ----------
async function listBroadcastsByIds(accessToken, ids) {
  if (!ids.length) return [];
  const u = new URL(YT_BROADCASTS);
  u.searchParams.set("part", "id,snippet,contentDetails,status");
  u.searchParams.set("id", ids.join(","));
  u.searchParams.set("maxResults", "50");
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`liveBroadcasts(${r.status}): ${text.slice(0, 200)}`);
  const j = JSON.parse(text);
  return j.items || [];
}

async function listStreamsByIds(accessToken, ids) {
  if (!ids.length) return new Map();
  const u = new URL(YT_STREAMS);
  u.searchParams.set("part", "status,cdn,snippet");
  u.searchParams.set("id", ids.join(","));
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`liveStreams(${r.status}): ${text.slice(0, 200)}`);
  const j = JSON.parse(text);
  const map = new Map();
  (j.items || []).forEach(s => map.set(s.id, s));
  return map;
}

export default async function handler(req, res) {
  const debugFlag = req.query.debug === "1" || req.query.debug === "true";

  try {
    // 1) On lit le Google Sheet et on isole les matchs d'AUJOURD'HUI (CH)
    const rSheet = await fetch(SHEET_CSV);
    if (!rSheet.ok) throw new Error("sheet");
    const csvText = await rSheet.text();
    const rows = parseCSV(csvText);

    const todayKey = ymdFromDateCH(new Date());
    const sheetMatchesToday = [];

    (rows || []).forEach(row => {
      const m = {};
      Object.keys(row || {}).forEach(k=>{
        m[k.trim().toLowerCase()] = (row[k]||"").trim();
      });

      const dateCol = getCI(m, "DATE","date");
      const timeCol = getCI(m, "HOUR","heure","time");
      const teamA   = getCI(m, "HOME","home","équipe a","equipe a");
      const teamB   = getCI(m, "AWAY","away","équipe b","equipe b");
      const arena   = getCI(m, "VENUE","venue","salle","arena","hall");
      const comp    = getCI(m, "COMPETITION","competition","league","ligue","compétition","competition name");
      const yt      = getCI(m, "YouTube ID","youtube id","yt id","youtube","youtubeeventid");

      const dt = toDateTimeCH(dateCol, timeCol);
      if (!dt) return;
      const key = ymdFromDateCH(dt);
      if (key !== todayKey) return;
      if (!yt) return;

      sheetMatchesToday.push({
        id: yt,
        when: dt.toISOString(),
        titleSheet: teamA && teamB ? `${teamA} vs ${teamB}` : (comp || "Match"),
        teamA,
        teamB,
        arena,
        competition: comp
      });
    });

    // aucun match dans le sheet pour aujourd'hui -> on renvoie vide
    if (!sheetMatchesToday.length) {
      const payload = { items: [] };
      if (debugFlag) {
        payload.debug = {
          todayKey,
          sheetRows: rows.length,
          sheetMatchesToday: 0
        };
      }
      return res.status(200).json(payload);
    }

    // 2) YouTube : on récupère les broadcasts par ID, puis leurs streamKeys
    const access = await getAccessToken();
    const ids = [...new Set(sheetMatchesToday.map(m => m.id))];
    const broadcasts = await listBroadcastsByIds(access, ids);
    const byId = new Map(broadcasts.map(b => [b.id, b]));

    const streamIds = [];
    broadcasts.forEach(b => {
      const sid = b?.contentDetails?.boundStreamId;
      if (sid) streamIds.push(sid);
    });
    const streamsMap = await listStreamsByIds(access, [...new Set(streamIds)]);

    const items = sheetMatchesToday
      .map(m => {
        const b = byId.get(m.id);
        if (!b) return null;

        const cd = b.contentDetails || {};
        const sid = cd.boundStreamId || null;
        if (!sid) return null;

        const stream = streamsMap.get(sid) || null;
        const ingest = stream?.cdn?.ingestionInfo || {};
        const streamKey = ingest.streamName || "";
        if (!streamKey) return null;

        const streamLabelRaw = stream?.snippet?.title || "";
        let streamLabel = streamLabelRaw;
        const idx = streamLabelRaw.indexOf("(");
        if (idx > 0) streamLabel = streamLabelRaw.slice(0, idx).trim();

        const st = (b.status?.lifeCycleStatus || "").toLowerCase();
        const status = st === "live" ? "live" : "upcoming";
        const privacy = (b.status?.privacyStatus || "").toLowerCase();

        return {
          id: b.id,
          title: b.snippet?.title || m.titleSheet,
          status,
          when: m.when,
          streamKey,
          streamLabel,
          streamLabelRaw,
          privacy,
          url: `https://www.youtube.com/watch?v=${b.id}`
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.when) - new Date(b.when));

    const payload = { items };
    if (debugFlag) {
      payload.debug = {
        todayKey,
        sheetRows: rows.length,
        sheetMatchesToday: sheetMatchesToday.length,
        broadcastsFound: broadcasts.length,
        itemsWithKeys: items.length
      };
    }

    res.status(200).json(payload);
  } catch (e) {
    res.status(200).json({
      items: [],
      error: String(e)
    });
  }
}
