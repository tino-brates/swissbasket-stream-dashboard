// api/yt-upcoming.js — upcoming robustes + support des événements PRIVÉS (mine=true)
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_BROADCASTS = "https://www.googleapis.com/youtube/v3/liveBroadcasts";
const YT_SEARCH = "https://www.googleapis.com/youtube/v3/search";
const YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const YT_CHANNELS = "https://www.googleapis.com/youtube/v3/channels";

function pickCreds() {
  const P = {
    client_id: process.env.YT_PLAYGROUND_CLIENT_ID,
    client_secret: process.env.YT_PLAYGROUND_CLIENT_SECRET,
    refresh_token: process.env.YT_PLAYGROUND_REFRESH_TOKEN,
  };
  const D = {
    client_id: process.env.YT_CLIENT_ID,
    client_secret: process.env.YT_CLIENT_SECRET,
    refresh_token: process.env.YT_REFRESH_TOKEN,
  };
  return (P.client_id && P.client_secret && P.refresh_token) ? P : D;
}

async function getAccessToken() {
  const { client_id, client_secret, refresh_token } = pickCreds();
  if (!client_id || !client_secret || !refresh_token) throw new Error("missing_creds");
  const body = new URLSearchParams({
    client_id, client_secret, refresh_token, grant_type: "refresh_token"
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("token");
  return j.access_token;
}

async function channelIdForMine(accessToken) {
  const u = new URL(YT_CHANNELS);
  u.searchParams.set("part", "id");
  u.searchParams.set("mine", "true");
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const j = await r.json();
  return j?.items?.[0]?.id || null;
}

async function listUpcomingBroadcastsMine(accessToken) {
  // Inclut public/unlisted/PRIVÉ pour le compte du token
  const u = new URL(YT_BROADCASTS);
  u.searchParams.set("part", "id,snippet,contentDetails,status");
  u.searchParams.set("broadcastStatus", "upcoming");
  u.searchParams.set("mine", "true");
  u.searchParams.set("maxResults", "50");
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || []).map(b => ({
    id: b.id,
    title: b?.snippet?.title || "Upcoming",
    scheduledStart: b?.contentDetails?.scheduledStartTime || null,
    url: `https://www.youtube.com/watch?v=${b.id}`,
    visibility: (b?.status?.privacyStatus || "public").toLowerCase(), // public | unlisted | private
    isPrivate: (b?.status?.privacyStatus || "").toLowerCase() === "private",
    source: "broadcasts.mine"
  })).filter(x => !!x.scheduledStart);
}

async function searchUpcoming(accessToken, channelId) {
  // search.list ne renvoie que les publics (YouTube)
  const u = new URL(YT_SEARCH);
  u.searchParams.set("part", "snippet");
  u.searchParams.set("type", "video");
  u.searchParams.set("eventType", "upcoming");
  u.searchParams.set("maxResults", "50");
  if (channelId) u.searchParams.set("channelId", channelId);
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || [])
    .map(it => ({ videoId: it?.id?.videoId, title: it?.snippet?.title || "" }))
    .filter(x => !!x.videoId);
}

async function videosDetails(accessToken, ids) {
  if (!ids.length) return new Map();
  const u = new URL(YT_VIDEOS);
  u.searchParams.set("part", "liveStreamingDetails,snippet,status");
  u.searchParams.set("id", ids.join(","));
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const j = await r.json();
  const map = new Map();
  (j.items || []).forEach(v => {
    map.set(v.id, {
      scheduledStart: v?.liveStreamingDetails?.scheduledStartTime || v?.snippet?.publishedAt || null,
      visibility: (v?.status?.privacyStatus || "public").toLowerCase()
    });
  });
  return map;
}

export default async function handler(req, res) {
  try {
    const access = await getAccessToken();

    // 1) D’abord les upcoming du compte (inclut privés)
    let mine = await listUpcomingBroadcastsMine(access);

    // 2) Fallback publics via search.list (ok même si token ≠ chaîne)
    let publicItems = [];
    if (mine.length === 0) {
      let channelId = process.env.YT_CHANNEL_ID || await channelIdForMine(access) || null;
      const found = await searchUpcoming(access, channelId || undefined);
      const details = await videosDetails(access, found.map(x => x.videoId));
      publicItems = found.map(x => {
        const d = details.get(x.videoId) || {};
        const visibility = (d.visibility || "public").toLowerCase();
        return {
          id: x.videoId,
          title: x.title || "Upcoming",
          scheduledStart: d.scheduledStart || null,
          url: `https://www.youtube.com/watch?v=${x.videoId}`,
          visibility,
          isPrivate: visibility === "private",
          source: "search.list"
        };
      }).filter(x => !!x.scheduledStart);
    }

    // Merge & tri
    const items = [...mine, ...publicItems].sort((a,b)=>new Date(a.scheduledStart)-new Date(b.scheduledStart));

    res.status(200).json({ items });
  } catch (e) {
    res.status(200).json({ items: [], error: String(e) });
  }
}
