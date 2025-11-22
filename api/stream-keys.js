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
  let items = [];
  let pageToken = undefined;
  let safety = 0;

  while (true) {
    const u = new URL(YT_BROADCASTS);
    u.searchParams.set("part", "id,snippet,contentDetails,status");
    u.searchParams.set("mine", "true");
    u.searchParams.set("maxResults", "50");
    if (pageToken) u.searchParams.set("pageToken", pageToken);

    const r = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`liveBroadcasts(${r.status}): ${text.slice(0, 200)}`);

    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error("liveBroadcasts(json)");
    }

    const batch = j.items || [];
    items = items.concat(batch);

    pageToken = j.nextPageToken;
    safety += 1;
    if (!pageToken || safety > 10) break;
  }

  return items;
}

async function listStreamsByIds(accessToken, ids) {
  if (!ids.length) return new Map();
  const unique = [...new Set(ids)];
  const map = new Map();

  const chunkSize = 50;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const slice = unique.slice(i, i + chunkSize);
    const u = new URL(YT_STREAMS);
    u.searchParams.set("part", "status,cdn,snippet");
    u.searchParams.set("id", slice.join(","));
    const r = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`liveStreams(${r.status}): ${text.slice(0, 200)}`);
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error("liveStreams(json)");
    }
    (j.items || []).forEach(s => map.set(s.id, s));
  }

  return map;
}

function ymdCH(dateInput) {
  const d = new Date(dateInput);
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

// ---- CACHE ----
let CACHE = {
  ts: 0,
  data: { items: [] },
  backoffUntil: 0
};
const CACHE_TTL_MS = 180000; // 3 min
const BACKOFF_MS = 300000;   // 5 min

export default async function handler(req, res) {
  const debugFlag = req.query.debug === "1" || req.query.debug === "true";
  const now = Date.now();

  if (now < CACHE.backoffUntil && CACHE.data) {
    return res.status(200).json(CACHE.data);
  }
  if (now - CACHE.ts < CACHE_TTL_MS && CACHE.data) {
    return res.status(200).json(CACHE.data);
  }

  try {
    const access = await getAccessToken();
    const all = await listAllBroadcasts(access);

    const nowMs = Date.now();
    const todayCH = ymdCH(nowMs);
    const todayBroadcasts = [];
    const debugDates = [];

    for (const b of all) {
      const sn = b.snippet || {};
      const cd = b.contentDetails || {};
      const st = (b.status?.lifeCycleStatus || "").toLowerCase();
      const privacy = (b.status?.privacyStatus || "").toLowerCase();

      const scheduled = cd.scheduledStartTime || sn.scheduledStartTime || null;
      const actual = cd.actualStartTime || null;

      let dateRef = null;
      if (actual) {
        dateRef = actual;
      } else if (scheduled) {
        dateRef = scheduled;
      } else if (sn.publishedAt) {
        dateRef = sn.publishedAt;
      }

      let ymd = null;
      if (dateRef) {
        try {
          ymd = ymdCH(dateRef);
        } catch {
          ymd = null;
        }
      }

      debugDates.push({
        id: b.id,
        lifeCycleStatus: st,
        privacy,
        scheduled,
        actual,
        ymd
      });

      if (!dateRef || !ymd) continue;
      if (ymd !== todayCH) continue;

      const isLive = st === "live";
      const isUpcomingLike = st === "ready" || st === "upcoming" || st === "created";

      if (!isLive && !isUpcomingLike) continue;
      if (!cd.boundStreamId) continue;

      todayBroadcasts.push(b);
    }

    const streamIds = todayBroadcasts
      .map(b => (b.contentDetails || {}).boundStreamId)
      .filter(Boolean);

    const streamsMap = await listStreamsByIds(access, streamIds);

    const items = todayBroadcasts
      .map(b => {
        const sn = b.snippet || {};
        const cd = b.contentDetails || {};
        const st = (b.status?.lifeCycleStatus || "").toLowerCase();
        const status = st === "live" ? "live" : "upcoming";
        const privacy = (b.status?.privacyStatus || "").toLowerCase();

        const scheduled = cd.scheduledStartTime || sn.scheduledStartTime || null;
        const actual = cd.actualStartTime || null;
        const when = actual || scheduled || sn.publishedAt || null;

        const sid = cd.boundStreamId || null;
        const stream = sid ? streamsMap.get(sid) : null;
        const ingest = stream?.cdn?.ingestionInfo || {};
        const streamKey = ingest.streamName || "";
        if (!streamKey) return null;

        const streamLabelRaw = stream?.snippet?.title || "";
        let streamLabel = streamLabelRaw;
        const idx = streamLabelRaw.indexOf("(");
        if (idx > 0) streamLabel = streamLabelRaw.slice(0, idx).trim();

        return {
          id: b.id,
          title: sn.title || "Live",
          status,
          when,
          streamKey,
          streamLabel,
          streamLabelRaw,
          privacy,
          url: `https://www.youtube.com/watch?v=${b.id}`
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const ta = a.when ? new Date(a.when).getTime() : 0;
        const tb = b.when ? new Date(b.when).getTime() : 0;
        return ta - tb;
      });

    const payload = { items };
    if (debugFlag) {
      payload.debug = {
        totalBroadcasts: all.length,
        todayCH,
        matched: items.length,
        rawDates: debugDates
      };
    }

    CACHE = {
      ts: now,
      data: payload,
      backoffUntil: 0
    };

    res.status(200).json(payload);
  } catch (e) {
    const payload = {
      items: [],
      error: String(e)
    };
    CACHE = {
      ts: Date.now(),
      data: payload,
      backoffUntil: Date.now() + BACKOFF_MS
    };
    res.status(200).json(payload);
  }
}
