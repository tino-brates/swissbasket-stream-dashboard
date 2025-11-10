// api/yt-upcoming.js — robuste: liveBroadcasts (mine=true) + fallback search.list + videos details
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_BROADCASTS = "https://www.googleapis.com/youtube/v3/liveBroadcasts";
const YT_SEARCH = "https://www.googleapis.com/youtube/v3/search";
const YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos";
const YT_CHANNELS = "https://www.googleapis.com/youtube/v3/channels";

// Utilise les creds "playground" si présents, sinon les "défaut"
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

async function listUpcomingBroadcasts(accessToken) {
  const u = new URL(YT_BROADCASTS);
  u.searchParams.set("part", "id,snippet,contentDetails,status");
  u.searchParams.set("broadcastStatus", "upcoming");
  u.searchParams.set("mine", "true");
  u.searchParams.set("maxResults", "50");
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) {
    // YouTube peut renvoyer 403 (quota/scopes). On considère "rien" => fallback.
    return [];
  }
  const j = await r.json();
  return j.items || [];
}

async function searchUpcoming(accessToken, channelId) {
  // search.list pour récupérer les vidéos "upcoming" — marche même si mine=true ne renvoie rien
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
  // on récupère liveStreamingDetails.scheduledStartTime
  if (!ids.length) return new Map();
  const u = new URL(YT_VIDEOS);
  u.searchParams.set("part", "liveStreamingDetails,snippet,status");
  u.searchParams.set("id", ids.join(","));
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const j = await r.json();
  const map = new Map();
  (j.items || []).forEach(v => {
    map.set(v.id, {
      scheduledStart: v?.liveStreamingDetails?.scheduledStartTime
        || v?.snippet?.publishedAt
        || null
    });
  });
  return map;
}

export default async function handler(req, res) {
  try {
    const access = await getAccessToken();
    const FORCED_CHANNEL = process.env.YT_CHANNEL_ID || ""; // tu peux définir ça dans Vercel si besoin

    // 1) Essai via liveBroadcasts (mine=true)
    const upcoming = await listUpcomingBroadcasts(access);
    let items = (upcoming || []).map(b => ({
      id: b.id,
      title: b?.snippet?.title || "Upcoming",
      scheduledStart: b?.contentDetails?.scheduledStartTime || null,
      url: `https://www.youtube.com/watch?v=${b.id}`,
    })).filter(x => !!x.scheduledStart);

    // 2) Fallback via search.list + videos
    if (items.length === 0) {
      // détermine le channelId à utiliser
      let channelId = FORCED_CHANNEL;
      if (!channelId) {
        // tente de récupérer le channel lié au token — si le token est sur un autre compte, ça évitera 0 résultat
        channelId = await channelIdForMine(access);
      }
      const found = await searchUpcoming(access, channelId || undefined);
      const details = await videosDetails(access, found.map(x => x.videoId));
      items = found.map(x => {
        const d = details.get(x.videoId) || {};
        return {
          id: x.videoId,
          title: x.title || "Upcoming",
          scheduledStart: d.scheduledStart || null,
          url: `https://www.youtube.com/watch?v=${x.videoId}`,
        };
      }).filter(x => !!x.scheduledStart);
    }

    // tri ascendant par date
    items.sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));

    res.status(200).json({ items });
  } catch (e) {
    // retourne vide (pas d’erreur fatale côté front)
    res.status(200).json({ items: [], error: String(e) });
  }
}