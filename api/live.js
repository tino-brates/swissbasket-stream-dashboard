// Récupère depuis YouTube :
// - les lives EN COURS (eventType=live, forMine=true)
// - les lives A VENIR (eventType=upcoming, forMine=true)
// Retourne { live: [...], upcoming: [...] } avec title, startedAt/scheduledStart et url.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_SEARCH = "https://www.googleapis.com/youtube/v3/search";
const YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos";

// On privilégie les identifiants PLAYGROUND si présents; sinon DESKTOP.
function pickCreds() {
  const P = {
    client_id: process.env.YT_PLAYGROUND_CLIENT_ID,
    client_secret: process.env.YT_PLAYGROUND_CLIENT_SECRET,
    refresh_token: process.env.YT_PLAYGROUND_REFRESH_TOKEN,
  };
  const D = {
    client_id: process.env.YT_DESKTOP_CLIENT_ID,
    client_secret: process.env.YT_DESKTOP_CLIENT_SECRET,
    refresh_token: process.env.YT_DESKTOP_REFRESH_TOKEN,
  };
  if (P.client_id && P.client_secret && P.refresh_token) return P;
  return D;
}

async function getAccessToken() {
  const { client_id, client_secret, refresh_token } = pickCreds();
  if (!client_id || !client_secret || !refresh_token) {
    throw new Error("Missing YouTube OAuth env vars");
  }
  const body = new URLSearchParams({
    client_id,
    client_secret,
    refresh_token,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error("token");
  const j = await r.json();
  if (!j.access_token) throw new Error("token_access");
  return j.access_token;
}

async function ytSearchByEventType(accessToken, eventType) {
  const url = new URL(YT_SEARCH);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("eventType", eventType); // "live" | "upcoming"
  url.searchParams.set("type", "video");
  url.searchParams.set("forMine", "true");
  url.searchParams.set("maxResults", "50");

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error("search_" + eventType);
  const j = await r.json();
  return (j.items || [])
    .map((it) => ({
      videoId: it?.id?.videoId,
      title: it?.snippet?.title || "",
    }))
    .filter((x) => !!x.videoId);
}

async function ytVideosDetails(accessToken, ids) {
  if (!ids.length) return new Map();
  const url = new URL(YT_VIDEOS);
  url.searchParams.set("part", "liveStreamingDetails,snippet");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("maxResults", "50");

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error("videos");
  const j = await r.json();
  const map = new Map();
  (j.items || []).forEach((v) => {
    map.set(v.id, {
      actualStart: v?.liveStreamingDetails?.actualStartTime || null,
      scheduledStart:
        v?.liveStreamingDetails?.scheduledStartTime ||
        v?.snippet?.publishedAt ||
        null,
    });
  });
  return map;
}

export default async function handler(req, res) {
  try {
    const accessToken = await getAccessToken();

    // 1) EN DIRECT
    const liveList = await ytSearchByEventType(accessToken, "live");
    const liveDetails = await ytVideosDetails(
      accessToken,
      liveList.map((x) => x.videoId)
    );
    const live = liveList.map((x) => {
      const d = liveDetails.get(x.videoId) || {};
      return {
        title: x.title,
        startedAt: d.actualStart || d.scheduledStart || null,
        url: `https://www.youtube.com/watch?v=${x.videoId}`,
      };
    });

    // 2) A VENIR
    const upList = await ytSearchByEventType(accessToken, "upcoming");
    const upDetails = await ytVideosDetails(
      accessToken,
      upList.map((x) => x.videoId)
    );
    const upcoming = upList
      .map((x) => {
        const d = upDetails.get(x.videoId) || {};
        return {
          title: x.title,
          scheduledStart: d.scheduledStart || null,
          url: `https://www.youtube.com/watch?v=${x.videoId}`,
        };
      })
      .filter((x) => !!x.scheduledStart);

    res.status(200).json({ live, upcoming });
  } catch (e) {
    // En cas d'erreur (quota/token), on renvoie des listes vides
    res.status(200).json({ live: [], upcoming: [] });
  }
}