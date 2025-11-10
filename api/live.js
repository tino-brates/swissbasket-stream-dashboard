// api/live.js — récupère LIVE et UPCOMING via mine=true (sans broadcastStatus), fallback search
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_BROADCASTS = "https://www.googleapis.com/youtube/v3/liveBroadcasts";
const YT_SEARCH = "https://www.googleapis.com/youtube/v3/search";
const YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const YT_CHANNELS = "https://www.googleapis.com/youtube/v3/channels";

let CACHE = { ts: 0, data: { live: [], upcoming: [], meta: { source: "init", lastError: "" } } };
const CACHE_TTL_MS = 120000;

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
    client_id, client_secret, refresh_token, grant_type: "refresh_token"
  });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("token");
  return j.access_token;
}

async function listBroadcastsMineAll(accessToken) {
  const u = new URL(YT_BROADCASTS);
  u.searchParams.set("part", "id,snippet,contentDetails,status");
  u.searchParams.set("mine", "true");
  u.searchParams.set("maxResults", "50");
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!r.ok) throw new Error("liveBroadcasts");
  const j = await r.json();
  return j.items || [];
}

function isLive(b) {
  const life = (b?.status?.lifeCycleStatus || "").toLowerCase(); // live
  const hasStart = !!(b?.liveStreamingDetails?.actualStartTime || b?.contentDetails?.actualStartTime);
  return life === "live" || hasStart;
}

function isUpcoming(b) {
  const life = (b?.status?.lifeCycleStatus || "").toLowerCase(); // created/ready
  const sched = b?.contentDetails?.scheduledStartTime || b?.snippet?.scheduledStartTime || null;
  const hasFutureStart = sched ? new Date(sched).getTime() > Date.now() : false;
  return hasFutureStart || life === "created" || life === "ready";
}

async function channelIdForMine(accessToken) {
  const u = new URL(YT_CHANNELS);
  u.searchParams.set("part", "id");
  u.searchParams.set("mine", "true");
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` }});
  const j = await r.json();
  return j?.items?.[0]?.id || null;
}

async function searchUpcoming(accessToken, channelId) {
  const u = new URL(YT_SEARCH);
  u.searchParams.set("part", "snippet");
  u.searchParams.set("type", "video");
  u.searchParams.set("eventType", "upcoming");
  u.searchParams.set("maxResults", "50");
  if (channelId) u.searchParams.set("channelId", channelId);
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` }});
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || []).map(it => ({
    videoId: it.id?.videoId, title: it.snippet?.title || ""
  })).filter(x => !!x.videoId);
}

async function videosDetails(accessToken, ids) {
  if (!ids.length) return new Map();
  const u = new URL(YT_VIDEOS);
  u.searchParams.set("part", "liveStreamingDetails,snippet,status");
  u.searchParams.set("id", ids.join(","));
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` }});
  const j = await r.json();
  const map = new Map();
  (j.items || []).forEach(v => {
    map.set(v.id, {
      actualStart: v?.liveStreamingDetails?.actualStartTime || null,
      scheduledStart: v?.liveStreamingDetails?.scheduledStartTime || v?.snippet?.publishedAt || null,
      visibility: (v?.status?.privacyStatus || "public").toLowerCase()
    });
  });
  return map;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  const now = Date.now();
  if (now - CACHE.ts < CACHE_TTL_MS) return res.status(200).json(CACHE.data);

  const meta = { source: "broadcasts.mine", lastError: "" };

  try {
    const access = await getAccessToken();

    // Mine sans broadcastStatus (pour éviter 400) puis filtrage local
    const all = await listBroadcastsMineAll(access);

    const live = all
      .filter(isLive)
      .map(b => ({
        title: b?.snippet?.title || "Live",
        startedAt: b?.liveStreamingDetails?.actualStartTime || b?.contentDetails?.actualStartTime || null,
        url: `https://www.youtube.com/watch?v=${b.id}`,
        visibility: (b?.status?.privacyStatus || "public").toLowerCase()
      }));

    let upcoming = all
      .filter(isUpcoming)
      .map(b => ({
        title: b?.snippet?.title || "Upcoming",
        scheduledStart: b?.contentDetails?.scheduledStartTime || b?.snippet?.scheduledStartTime || null,
        url: `https://www.youtube.com/watch?v=${b.id}`,
        visibility: (b?.status?.privacyStatus || "public").toLowerCase()
      }))
      .filter(x => !!x.scheduledStart);

    // Fallback publics (si all renvoie vide pour une raison X)
    if (live.length === 0 && upcoming.length === 0) {
      const forced = process.env.YT_CHANNEL_ID || "";
      const chId = forced || await channelIdForMine(access);
      const found = await searchUpcoming(access, chId || undefined);
      const details = await videosDetails(access, found.map(x => x.videoId));
      upcoming = found.map(x => {
        const d = details.get(x.videoId) || {};
        return {
          title: x.title,
          scheduledStart: d.scheduledStart,
          url: `https://www.youtube.com/watch?v=${x.videoId}`,
          visibility: (d.visibility || "public").toLowerCase()
        };
      }).filter(x => !!x.scheduledStart);
      meta.source = "search.list";
    }

    const data = { live, upcoming, meta };
    CACHE = { ts: now, data };
    return res.status(200).json(data);
  } catch (e) {
    meta.lastError = String(e);
    const data = { live: [], upcoming: [], meta };
    CACHE = { ts: now, data };
    return res.status(200).json(data);
  }
}
