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
  return (P.client_id && P.client_secret && P.refresh_token) ? P : D;
}

export default async function handler(req, res) {
  try {
    const { client_id, client_secret, refresh_token } = pickCreds();

    if (!client_id || !client_secret || !refresh_token) {
      return res.status(200).json({
        ok: false,
        error: "Missing client_id / client_secret / refresh_token in env",
      });
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

    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { j = {}; }

    if (!r.ok || !j.access_token) {
      return res.status(200).json({
        ok: false,
        httpStatus: r.status,
        error: j.error || "token_error",
        error_description: j.error_description || null,
        raw: text.slice(0, 400),
      });
    }

    return res.status(200).json({
      ok: true,
      token_type: j.token_type || "Bearer",
      scope: j.scope || "",
      expires_in: j.expires_in || null,
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      error: String(e),
    });
  }
}
