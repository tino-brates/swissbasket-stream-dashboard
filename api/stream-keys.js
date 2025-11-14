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

async function listAllBroadcasts(accessToken, debug) {
  const u = new URL(YT_BROADCASTS);
  u.searchParams.set("part", "id,snippet,contentDetails,status");
  u.searchParams.set("mine", "true");
  u.searchParams.set("maxResults", "50");
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const text = await r.text();
  if (!r.ok) {
    if (debug) throw new Error(`liveBroadcasts(${r.status}): ${text.slice(0,400)}`);
    throw new Error("liveBroadcasts");
  }
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    if (debug) throw new Error(`liveBroadcasts(json): ${text.slice(0,200)}`);
    throw new Error("liveBroadcasts json");
  }
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

const lc = s => (s || "").toLowerCase();

export default async function handler(req, res) {
  const debugFlag = req.query.debug === "1" || req.query.debug === "true";
  try {
    const access = await getAccessToken();

    const broadcasts = await listAllBroadcasts(access, debugFlag);

    const relevant = (broadcasts || []).filter(b => {
      const ls = lc(b?.status?.lifeCycleStatus);
      return ls === "live" || ls === "upcoming";
    });

    const ids = relevant
      .map(b => (b.contentDetails || {}).boundStreamId)
      .filter(Boolean);
    const streamsMap = await listStreamsByIds(access, ids);

    const items = relevant
      .map(b => {
        const cd = b.contentDetails || {};
        const sid = cd.boundStreamId || null;
        const stream = sid ? streamsMap.get(sid) : null;
        const ingest = (stream?.cdn?.ingestionInfo) || {};
        const streamKey = ingest.streamName || "";
        const when = cd.actualStartTime || cd.scheduledStartTime || b.snippet?.publishedAt || null;
        const status = lc(b?.status?.lifeCycleStatus) === "live" ? "live" : "upcoming";
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

    const payload = { items };
    if (debugFlag) {
      payload.debug = {
        totalBroadcasts: broadcasts.length,
        relevantCount: relevant.length
      };
    }

    res.status(200).json(payload);
  } catch (e) {
    res.status(200).json({ items: [], error: String(e) });
  }
}
