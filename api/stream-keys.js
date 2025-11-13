const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_BROADCASTS = "https://www.googleapis.com/youtube/v3/liveBroadcasts";
const YT_STREAMS = "https://www.googleapis.com/youtube/v3/liveStreams";

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

async function listAllBroadcasts(accessToken) {
  const u = new URL(YT_BROADCASTS);
  u.searchParams.set("part", "id,snippet,contentDetails,status");
  u.searchParams.set("mine", "true");
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

function ymdCH(dateISO) {
  const d = new Date(dateISO);
  const parts = new Intl.DateTimeFormat("fr-CH", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d);
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const da = parts.find(p => p.type === "day").value;
  return `${y}-${m}-${da}`;
}

export default async function handler(req, res) {
  const debugFlag = req.query.debug === "1" || req.query.debug === "true";
  try {
    const access = await getAccessToken();
    const all = await listAllBroadcasts(access);

    const todayCH = ymdCH(Date.now());
    const todayItems = [];
    const debugDates = [];

    for (const b of all) {
      const cd = b.contentDetails || {};
      const startIso = cd.actualStartTime || cd.scheduledStartTime;
      if (!startIso) continue;

      const dYmd = ymdCH(startIso);
      const st = (b.status?.lifeCycleStatus || "").toLowerCase();
      const privacy = (b.status?.privacyStatus || "").toLowerCase();

      debugDates.push({
        id: b.id,
        lifeCycleStatus: st,
        privacy,
        when: startIso,
        ymd: dYmd
      });

      if (dYmd !== todayCH) continue;
      if (!cd.boundStreamId) continue;

      todayItems.push(b);
    }

    const streamIds = todayItems
      .map(b => (b.contentDetails || {}).boundStreamId)
      .filter(Boolean);
    const streamsMap = await listStreamsByIds(access, streamIds);

    const items = todayItems
      .map(b => {
        const cd = b.contentDetails || {};
        const sid = cd.boundStreamId || null;
        const startIso = cd.actualStartTime || cd.scheduledStartTime || null;
        const st = (b.status?.lifeCycleStatus || "").toLowerCase();
        const status = st === "live" ? "live" : "upcoming";
        const privacy = (b.status?.privacyStatus || "").toLowerCase();
        const stream = sid ? streamsMap.get(sid) : null;
        const ingest = stream?.cdn?.ingestionInfo || {};
        const streamKey = ingest.streamName || "";
        const streamLabelRaw = stream?.snippet?.title || "";
        let streamLabel = streamLabelRaw;
        const idx = streamLabelRaw.indexOf("(");
        if (idx > 0) streamLabel = streamLabelRaw.slice(0, idx).trim();

        return {
          id: b.id,
          title: b.snippet?.title || "Live",
          status,
          when: startIso,
          streamKey,
          streamLabel,
          streamLabelRaw,
          privacy,
          url: `https://www.youtube.com/watch?v=${b.id}`
        };
      })
      .sort((a, b) => new Date(a.when) - new Date(b.when));

    const payload = { items };
    if (debugFlag) {
      payload.debug = {
        totalBroadcasts: all.length,
        todayCH,
        matched: items.length,
        rawDates: debugDates
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
