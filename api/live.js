const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_BROADCASTS = "https://www.googleapis.com/youtube/v3/liveBroadcasts";
const YT_SEARCH = "https://www.googleapis.com/youtube/v3/search";
const YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const YT_CHANNELS = "https://www.googleapis.com/youtube/v3/channels";

let CACHE = {
  ts: 0,
  data: { live: [], upcoming: [], meta: { source: "init", quotaBackoffUntil: 0, lastError: "" } },
  backoffUntil: 0
};
const CACHE_TTL_MS = 120000; // 2 min
const BACKOFF_MS = 300000;   // 5 min en cas de quotaExceeded

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
  if (P.client_id && P.client_secret && P.refresh_token) return P;
  return D;
}

async function getAccessToken() {
  const { client_id, client_secret, refresh_token } = pickCreds();
  if (!client_id || !client_secret || !refresh_token) throw new Error("Missing env");
  const body = new URLSearchParams({
    client_id, client_secret, refresh_token, grant_type: "refresh_token"
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!r.ok) throw new Error("token");
  const j = await r.json();
  if (!j.access_token) throw new Error("token_access");
  return j.access_token;
}

async function broadcasts(accessToken, status) {
  const u = new URL(YT_BROADCASTS);
  u.searchParams.set("part", "snippet,contentDetails,status");
  u.searchParams.set("broadcastStatus", status); // active | upcoming
  u.searchParams.set("broadcastType", "all");
  u.searchParams.set("mine", "true");
  u.searchParams.set("maxResults", "50");
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!r.ok) {
    const txt = await r.text();
    const isQuota = txt.includes("quota") || txt.includes("quotaExceeded");
    if (isQuota) {
      const now = Date.now();
      CACHE.backoffUntil = Math.max(CACHE.backoffUntil, now + BACKOFF_MS);
      throw new Error("quotaExceeded");
    }
    throw new Error("broadcasts_" + status);
  }
  const j = await r.json();
  return j.items || [];
}

async function channelIdForMine(accessToken) {
  const u = new URL(YT_CHANNELS);
  u.searchParams.set("part", "id");
  u.searchParams.set("mine", "true");
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!r.ok) return null;
  const j = await r.json();
  const it = (j.items || [])[0];
  return it ? it.id : null;
}

async function searchByEventType(accessToken, channelId, eventType) {
  const u = new URL(YT_SEARCH);
  u.searchParams.set("part", "snippet");
  u.searchParams.set("type", "video");
  u.searchParams.set("eventType", eventType); // live | upcoming
  u.searchParams.set("maxResults", "50");
  if (channelId) u.searchParams.set("channelId", channelId);
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || []).map(it => ({
    videoId: it?.id?.videoId,
    title: it?.snippet?.title || ""
  })).filter(x => !!x.videoId);
}

async function videosDetails(accessToken, ids) {
  if (!ids.length) return new Map();
  const u = new URL(YT_VIDEOS);
  u.searchParams.set("part", "liveStreamingDetails,snippet,status");
  u.searchParams.set("id", ids.join(","));
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!r.ok) return new Map();
  const j = await r.json();
  const map = new Map();
  (j.items || []).forEach(v => {
    map.set(v.id, {
      actualStart: v?.liveStreamingDetails?.actualStartTime || null,
      scheduledStart: v?.liveStreamingDetails?.scheduledStartTime || v?.snippet?.publishedAt || null,
      privacyStatus: v?.status?.privacyStatus || "public"
    });
  });
  return map;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  const now = Date.now();
  const cacheFresh = (now - CACHE.ts) < CACHE_TTL_MS;
  if (cacheFresh) {
    return res.status(200).json(CACHE.data);
  }
  if (now < CACHE.backoffUntil) {
    return res.status(200).json(CACHE.data);
  }

  let meta = { source: "liveBroadcasts", quotaBackoffUntil: CACHE.backoffUntil, lastError: "" };

  try {
    const access = await getAccessToken();

    // 1) voie officielle : liveBroadcasts
    const [bActive, bUpcoming] = await Promise.all([
      broadcasts(access, "active"),
      broadcasts(access, "upcoming")
    ]);

    let live = (bActive || []).map(b => ({
      title: b?.snippet?.title || "Live",
      startedAt: b?.contentDetails?.actualStartTime || b?.snippet?.actualStartTime || null,
      url: `https://www.youtube.com/watch?v=${b?.id}`
    })).filter(x => !!x.url);

    let upcoming = (bUpcoming || []).map(b => ({
      title: b?.snippet?.title || "Upcoming",
      scheduledStart: b?.contentDetails?.scheduledStartTime || b?.snippet?.scheduledStartTime || b?.snippet?.publishedAt || null,
      url: `https://www.youtube.com/watch?v=${b?.id}`
    })).filter(x => !!x.scheduledStart);

    // 2) fallback (public/unlisted) si liveBroadcasts ne renvoie rien
    if (live.length === 0 || upcoming.length === 0) {
      meta.source = "searchFallback";
      const chId = await channelIdForMine(access);

      if (live.length === 0) {
        const sLive = await searchByEventType(access, chId, "live");
        const dLive = await videosDetails(access, sLive.map(x=>x.videoId));
        live = sLive.map(x => {
          const d = dLive.get(x.videoId) || {};
          return {
            title: x.title,
            startedAt: d.actualStart || d.scheduledStart || null,
            url: `https://www.youtube.com/watch?v=${x.videoId}`
          };
        });
      }

      if (upcoming.length === 0) {
        const sUp = await searchByEventType(access, chId, "upcoming");
        const dUp = await videosDetails(access, sUp.map(x=>x.videoId));
        upcoming = sUp.map(x => {
          const d = dUp.get(x.videoId) || {};
          return {
            title: x.title,
            scheduledStart: d.scheduledStart || null,
            url: `https://www.youtube.com/watch?v=${x.videoId}`
          };
        }).filter(x => !!x.scheduledStart);
      }
    }

    CACHE.data = { live, upcoming, meta };
    CACHE.ts = now;
    return res.status(200).json(CACHE.data);
  } catch (e) {
    meta.lastError = String(e || "");
    CACHE.data.meta = meta;
    return res.status(200).json(CACHE.data);
  }
}