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
  if (!r.ok || !j.access_token) throw new Error("token");
  return j.access_token;
}

async function listBroadcasts(accessToken, status) {
  const u = new URL(YT_BROADCASTS);
  u.searchParams.set("part", "id,snippet,contentDetails,status");
  u.searchParams.set("broadcastStatus", status);
  u.searchParams.set("mine", "true");
  u.searchParams.set("maxResults", "50");
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) return [];
  const j = await r.json();
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
  if (!r.ok) return new Map();
  const j = await r.json();
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
  try {
    const access = await getAccessToken();

    const todayCH = ymdCH(Date.now());

    const [liveB, upB] = await Promise.all([
      listBroadcasts(access, "active"),
      listBroadcasts(access, "upcoming")
    ]);
    const all = [...liveB, ...upB];

    const todayItems = all.filter(b => {
      const cd = b.contentDetails || {};
      const t = cd.actualStartTime || cd.scheduledStartTime || b.snippet?.publishedAt;
      if (!t) return false;
      return ymdCH(t) === todayCH;
    });

    const ids = todayItems
      .map(b => (b.contentDetails || {}).boundStreamId)
      .filter(Boolean);
    const streamsMap = await listStreamsByIds(access, ids);

    const items = todayItems
      .map(b => {
        const cd = b.contentDetails || {};
        const sid = cd.boundStreamId || null;
        const stream = sid ? streamsMap.get(sid) : null;
        const ingest = (stream?.cdn?.ingestionInfo) || {};
        const streamKey = ingest.streamName || "";
        const when = cd.actualStartTime || cd.scheduledStartTime || null;
        const status = cd.actualStartTime ? "live" : "upcoming";
        const rawLabel = (stream?.snippet?.title || "").trim();
        const streamLabelRaw = rawLabel || "";
        const streamLabel = streamLabelRaw || streamKey || "";

        return {
          id: b.id,
          title: b.snippet?.title || "Live",
          status,
          when,
          streamKey,
          streamLabel,
          streamLabelRaw,
          privacy: b.status?.privacyStatus || "public",
          url: `https://www.youtube.com/watch?v=${b.id}`
        };
      })
      .sort((a, b) => {
        const ta = a.when ? new Date(a.when).getTime() : 0;
        const tb = b.when ? new Date(b.when).getTime() : 0;
        return ta - tb;
      });

    res.status(200).json({ items });
  } catch (e) {
    res.status(200).json({ items: [], error: String(e) });
  }
}
