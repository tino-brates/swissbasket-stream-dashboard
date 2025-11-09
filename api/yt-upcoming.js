const TOKEN_URL = 'https://oauth2.googleapis.com/token';

async function getAccessToken() {
  const clientId = process.env.YT_PLAYGROUND_CLIENT_ID || process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_PLAYGROUND_CLIENT_SECRET || process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_PLAYGROUND_REFRESH_TOKEN || process.env.YT_REFRESH_TOKEN;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  if (!r.ok) throw new Error('token');
  const j = await r.json();
  return j.access_token;
}

export default async function handler(req, res) {
  try {
    const accessToken = await getAccessToken();

    const u = new URL('https://www.googleapis.com/youtube/v3/liveBroadcasts');
    u.searchParams.set('part', 'id,snippet,status');
    u.searchParams.set('broadcastStatus', 'upcoming');
    u.searchParams.set('broadcastType', 'all');
    u.searchParams.set('mine', 'true');
    u.searchParams.set('maxResults', '50');

    const r = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!r.ok) throw new Error('yt upcoming');
    const j = await r.json();

    const items = (j.items || []).map(b => ({
      id: b.id,
      title: b.snippet?.title || 'Live',
      scheduledStart: b.snippet?.scheduledStartTime || b.snippet?.publishedAt || null,
      url: `https://www.youtube.com/watch?v=${b.id}`
    })).filter(x => !!x.scheduledStart);

    res.status(200).json({ items });
  } catch {
    res.status(200).json({ items: [] });
  }
}