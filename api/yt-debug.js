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
  if (!client_id || !client_secret || !refresh_token) throw new Error("env");
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

export default async function handler(req, res) {
  try {
    // 1) check env presence
    const envs = {
      playground: !!(process.env.YT_PLAYGROUND_CLIENT_ID && process.env.YT_PLAYGROUND_CLIENT_SECRET && process.env.YT_PLAYGROUND_REFRESH_TOKEN),
      legacy: !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN)
    };

    const access = await getAccessToken();

    // 2) which channel is this token tied to?
    const chUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    chUrl.searchParams.set("part", "id,snippet");
    chUrl.searchParams.set("mine", "true");
    const chR = await fetch(chUrl.toString(), { headers: { Authorization: `Bearer ${access}` }});
    const chJ = await chR.json();

    // 3) counts for live/upcoming via liveBroadcasts
    async function count(status) {
      const u = new URL("https://www.googleapis.com/youtube/v3/liveBroadcasts");
      u.searchParams.set("part", "id,status,snippet,contentDetails");
      u.searchParams.set("mine", "true");
      u.searchParams.set("broadcastStatus", status); // active | upcoming | completed
      u.searchParams.set("maxResults", "50");
      const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${access}` }});
      if (!r.ok) return { status, ok:false, count:0, error:true };
      const j = await r.json();
      return { status, ok:true, count:(j.items||[]).length };
    }

    const [cActive, cUpcoming] = await Promise.all([count("active"), count("upcoming")]);

    res.status(200).json({
      envs,
      channelMine: chJ,
      liveBroadcastsCounts: { active: cActive, upcoming: cUpcoming }
    });
  } catch (e) {
    res.status(200).json({ error: true, message: String(e) });
  }
}