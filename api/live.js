const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_BROADCASTS = "https://www.googleapis.com/youtube/v3/liveBroadcasts";
const YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const DEFAULT_CHANNEL_ID = process.env.YT_CHANNEL_ID || "UCgJw4GIqhkaIF7nYYqRI84w";

let CACHE = {
  ts: 0,
  data: { live: [], upcoming: [], meta: { source: "init", lastError: "" } },
  backoffUntil: 0
};
const CACHE_TTL_MS = 120000;
const BACKOFF_MS = 300000;

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

async function videosDetails(accessToken, ids) {
  if (!ids.length) return new Map();
  const u = new URL(YT_VIDEOS);
  u.searchParams.set("part", "liveStreamingDetails,snippet,status");
  u.searchParams.set("id", ids.join(","));
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const j = await r.json();
  const map = new Map();
  (j.items || []).forEach(v => {
    map.set(v.id, {
      actualStart: v.liveStreamingDetails?.actualStartTime || null,
      scheduledStart: v.liveStreamingDetails?.scheduledStartTime || v.snippet?.publishedAt || null,
      privacy: v.status?.privacyStatus || null
    });
  });
  return map;
}

function textBetween(s, a, b) {
  const i = s.indexOf(a);
  if (i < 0) return "";
  const j = s.indexOf(b, i + a.length);
  if (j < 0) return "";
  return s.slice(i + a.length, j);
}

function parseAtom(xml) {
  const parts = xml.split("<entry>").slice(1).map(seg => "<entry>" + seg);
  return parts.map(e => ({
    title: textBetween(e, "<title>", "</title>").trim(),
    id: textBetween(e, "<yt:videoId>", "</yt:videoId>").trim(),
    lbc: textBetween(e, "<yt:liveBroadcastContent>", "</yt:liveBroadcastContent>").trim()
  }));
}

async function atomFallback() {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(
    DEFAULT_CHANNEL_ID
  )}`;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!r.ok)
    return { live: [], upcoming: [], meta: { source: "atom", lastError: "atom http" } };
  const xml = await r.text();
  const entries = parseAtom(xml);
  const nowIso = new Date().toISOString();
  const live = entries
    .filter(x => x.lbc === "live")
    .map(x => ({
      id: x.id,
      title: x.title || "Live",
      startedAt: nowIso,
      url: `https://www.youtube.com/watch?v=${x.id}`,
      visibility: "public",
      lifeCycleStatus: "live"
    }));
  const upcoming = entries
    .filter(x => x.lbc === "upcoming")
    .map(x => ({
      title: x.title || "Upcoming",
      scheduledStart: null,
      url: `https://www.youtube.com/watch?v=${x.id}`,
      visibility: "public"
    }));
  return { live, upcoming, meta: { source: "atom", lastError: "live API error" } };
}

function isUpcomingLike(b) {
  const life = (b?.status?.lifeCycleStatus || "").toLowerCase();
  const sched =
    b?.contentDetails?.scheduledStartTime || b?.snippet?.scheduledStartTime || null;
  const t = sched ? Date.parse(sched) : NaN;
  const future = !Number.isNaN(t) && t >= Date.now() - 10 * 60 * 1000;
  return future || life === "ready" || life === "created" || life === "upcoming";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  const now = Date.now();
  if (now - CACHE.ts < CACHE_TTL_MS) return res.status(200).json(CACHE.data);
  if (now < CACHE.backoffUntil) return res.status(200).json(CACHE.data);

  const meta = { source: "liveBroadcasts", lastError: "" };

  try {
    const access = await getAccessToken();
    const items = await listAllBroadcasts(access);

    let live = items
      .filter(b => (b.status?.lifeCycleStatus || "").toLowerCase() === "live")
      .map(b => ({
        id: b.id,
        title: b.snippet?.title || "Live",
        startedAt: b.contentDetails?.actualStartTime || null,
        url: `https://www.youtube.com/watch?v=${b.id}`,
        visibility: b.status?.privacyStatus || "public",
        lifeCycleStatus: "live"
      }));

    let upcoming = items
      .filter(b => isUpcomingLike(b) && (b.status?.lifeCycleStatus || "").toLowerCase() !== "live")
      .map(b => ({
        id: b.id,
        title: b.snippet?.title || "Upcoming",
        scheduledStart:
          b.contentDetails?.scheduledStartTime || b.snippet?.scheduledStartTime || null,
        url: `https://www.youtube.com/watch?v=${b.id}`,
        visibility: b.status?.privacyStatus || "public"
      }));

    const missingIds = live.filter(x => !x.startedAt).map(x => x.id);
    if (missingIds.length) {
      const det = await videosDetails(access, missingIds);
      live = live.map(x => {
        if (x.startedAt) return x;
        const d = det.get(x.id) || {};
        return {
          ...x,
          startedAt: d.actualStart || null,
          visibility: x.visibility || d.privacy || "public"
        };
      });
    }

    CACHE.data = { live, upcoming, meta };
    CACHE.ts = now;
    return res.status(200).json(CACHE.data);
  } catch (e) {
    meta.lastError = String(e);
    try {
      const fb = await atomFallback();
      CACHE.data = fb;
      CACHE.ts = now;
      CACHE.backoffUntil = Date.now() + BACKOFF_MS;
      return res.status(200).json(CACHE.data);
    } catch {
      CACHE.data = {
        live: [],
        upcoming: [],
        meta: { source: "error", lastError: meta.lastError }
      };
      CACHE.ts = now;
      CACHE.backoffUntil = Date.now() + BACKOFF_MS;
      return res.status(200).json(CACHE.data);
    }
  }
}
