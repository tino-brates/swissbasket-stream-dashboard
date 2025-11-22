const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_BROADCASTS = "https://www.googleapis.com/youtube/v3/liveBroadcasts";

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

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function setVisibility(accessToken, id, privacy) {
  const url = new URL(YT_BROADCASTS);
  url.searchParams.set("part", "status");
  const body = {
    id,
    status: { privacyStatus: privacy }
  };
  const r = await fetch(url.toString(), {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`visibility(${r.status}): ${text.slice(0,200)}`);
  return true;
}

async function endLive(accessToken, id) {
  const url = new URL("https://www.googleapis.com/youtube/v3/liveBroadcasts/transition");
  url.searchParams.set("part", "status");
  url.searchParams.set("id", id);
  url.searchParams.set("broadcastStatus", "complete");
  const r = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`transition(${r.status}): ${text.slice(0,200)}`);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok:false, error:"Method not allowed" });
  }

  try {
    const body = await readJsonBody(req);
    const { action, id, privacy } = body || {};
    if (!action || !id) {
      return res.status(400).json({ ok:false, error:"Missing action or id" });
    }

    const access = await getAccessToken();

    if (action === "setVisibility") {
      if (!privacy) return res.status(400).json({ ok:false, error:"Missing privacy" });
      await setVisibility(access, id, privacy);
      return res.status(200).json({ ok:true });
    }

    if (action === "endLive") {
      await endLive(access, id);
      return res.status(200).json({ ok:true });
    }

    return res.status(400).json({ ok:false, error:"Unknown action" });
  } catch (e) {
    return res.status(200).json({ ok:false, error:String(e) });
  }
}
