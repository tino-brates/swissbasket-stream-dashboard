// Récupère les lives YT en cours (mine=true) via OAuth (refresh token)
// Étapes : refresh token -> search.list (eventType=live, forMine) -> videos.list pour l'heure de début

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_SEARCH = "https://www.googleapis.com/youtube/v3/search";
const YT_VIDEOS = "https://www.googleapis.com/youtube/v3/videos";

// On privilégie les identifiants "PLAYGROUND" si présents, sinon on tombe sur "DESKTOP".
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

async function ytSearchLive(accessToken) {
  const url = new URL(YT_SEARCH);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("eventType", "live");
  url.searchParams.set("type", "video");
  url.searchParams.set("forMine", "true");
  url.searchParams.set("maxResults", "50");

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error("search");
  const j = await r.json();
  return (j.items || [])
    .map((it) => ({
      videoId: it?.id?.videoId,
      title: it?.snippet?.title || "",
    }))
    .filter((x) => !!x.videoId);
}

async function ytVideosDetails(accessToken, ids) {
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
      startedAt:
        v?.liveStreamingDetails?.actualStartTime ||
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

    // 1) vidéos live en cours sur la chaîne (mine=true)
    const lives = await ytSearchLive(accessToken);
    if (!lives.length) {
      return res.status(200).json({ items: [] });
    }

    // 2) compléter avec l'heure de début (videos.list)
    const details = await ytVideosDetails(
      accessToken,
      lives.map((x) => x.videoId)
    );

    const items = lives.map((x) => {
      const d = details.get(x.videoId) || {};
      return {
        title: x.title,
        startedAt: d.startedAt || null,
        url: `https://www.youtube.com/watch?v=${x.videoId}`,
      };
    });

    res.status(200).json({ items });
  } catch (e) {
    // En cas d'erreur (quota/token), on renvoie liste vide pour ne pas casser l'UI
    res.status(200).json({ items: [] });
  }
}