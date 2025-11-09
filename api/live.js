const TOKEN_URL = "https://oauth2.googleapis.com/token";

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
  if (!r.ok) throw new Error("token");
  const j = await r.json();
  if (!j.access_token) throw new Error("token_access");
  return j.access_token;
}

async function fetchBroadcasts(accessToken, status) {
  const u = new URL("https://www.googleapis.com/youtube/v3/liveBroadcasts");
  u.searchParams.set("part", "snippet,contentDetails,status");
  u.searchParams.set("broadcastStatus", status);
  u.searchParams.set("broadcastType", "all");
  u.searchParams.set("mine", "true");
  u.searchParams.set("maxResults", "50");
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error("broadcasts_" + status);
  const j = await r.json();
  return j.items || [];
}

export default async function handler(req, res) {
  try {
    const accessToken = await getAccessToken();

    const liveItems = await fetchBroadcasts(accessToken, "active");
    const upItems = await fetchBroadcasts(accessToken, "upcoming");

    const live = liveItems
      .map(b => ({
        title: b?.snippet?.title || "Live",
        startedAt: b?.contentDetails?.actualStartTime || b?.snippet?.actualStartTime || null,
        url: `https://www.youtube.com/watch?v=${b?.id}`
      }))
      .filter(x => !!x.url);

    const upcoming = upItems
      .map(b => ({
        title: b?.snippet?.title || "Upcoming",
        scheduledStart: b?.contentDetails?.scheduledStartTime || b?.snippet?.scheduledStartTime || b?.snippet?.publishedAt || null,
        url: `https://www.youtube.com/watch?v=${b?.id}`
      }))
      .filter(x => !!x.scheduledStart);

    res.status(200).json({ live, upcoming });
  } catch {
    res.status(200).json({ live: [], upcoming: [] });
  }
}