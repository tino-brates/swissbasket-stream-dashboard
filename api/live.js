const TOKEN_URL = "https://oauth2.googleapis.com/token";

async function getAccessToken() {
  const params = new URLSearchParams();
  params.set("client_id", process.env.YT_CLIENT_ID);
  params.set("client_secret", process.env.YT_CLIENT_SECRET);
  params.set("refresh_token", process.env.YT_REFRESH_TOKEN);
  params.set("grant_type", "refresh_token");
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!r.ok) throw new Error("token");
  const j = await r.json();
  return j.access_token;
}

export default async function handler(req, res) {
  try {
    const accessToken = await getAccessToken();

    const u = new URL("https://www.googleapis.com/youtube/v3/liveBroadcasts");
    u.searchParams.set("part", "id,snippet,contentDetails,status");
    // 'active' = testing + live. On filtrera ensuite.
    u.searchParams.set("broadcastStatus", "active");
    u.searchParams.set("mine", "true");

    const r = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!r.ok) throw new Error("broadcasts");
    const j = await r.json();

    const items = (j.items || [])
      // vrais lives uniquement
      .filter(b => (b.status?.lifeCycleStatus || "").toLowerCase() === "live")
      // évite les tests privés/non listés
      .filter(b => (b.status?.privacyStatus || "").toLowerCase() === "public")
      // exige un start time réel
      .filter(b => !!b.snippet?.actualStartTime)
      .map(b => ({
        title: b.snippet?.title || "Live",
        arena: "", // on pourra parser l’arène du titre plus tard si tu veux
        startedAt: b.snippet.actualStartTime,
        url: `https://www.youtube.com/watch?v=${b.id}`
      }));

    res.status(200).json({ items });
  } catch {
    // en cas d’erreur → vide (pour afficher "Time to rest")
    res.status(200).json({ items: [] });
  }
}