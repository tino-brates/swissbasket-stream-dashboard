// api/health.js — RTMP ingest + health pour LIVE & TESTING (preview), READY en fallback
// Fix: ne pas demander "liveStreamingDetails" sur liveBroadcasts (part invalide)

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_BROADCASTS = "https://www.googleapis.com/youtube/v3/liveBroadcasts";
const YT_STREAMS = "https://www.googleapis.com/youtube/v3/liveStreams";

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
  const params = new URLSearchParams({
    client_id, client_secret, refresh_token, grant_type: "refresh_token"
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    const msg = `token(${r.status})`;
    throw new Error(msg);
  }
  return j.access_token;
}

// IMPORTANT : mine=true SANS broadcastStatus (sinon 400)
// FIX: part = id,snippet,contentDetails,status (PAS "liveStreamingDetails")
async function listAllBroadcasts(accessToken, debug=false) {
  const u = new URL(YT_BROADCASTS);
  u.searchParams.set("part", "id,snippet,contentDetails,status");
  u.searchParams.set("mine", "true");
  u.searchParams.set("maxResults", "50");
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await r.text();
  if (!r.ok) {
    if (debug) {
      throw new Error(`broadcasts(${r.status}): ${text.slice(0,400)}`);
    }
    throw new Error("broadcasts");
  }
  try {
    const j = JSON.parse(text);
    return j.items || [];
  } catch {
    if (debug) throw new Error(`broadcasts(json): ${text.slice(0,200)}`);
    throw new Error("broadcasts");
  }
}

function lc(s){ return (s||"").toLowerCase(); }

function wantHealth(b) {
  const life = lc(b?.status?.lifeCycleStatus);
  // on affiche l’ingest/health pour live et testing
  return life === "live" || life === "testing";
}
function maybeReady(b) {
  const life = lc(b?.status?.lifeCycleStatus);
  // parfois utile de montrer ready si boundStreamId déjà présent
  return life === "ready" || life === "created";
}

async function listStreams(accessToken, ids, debug=false) {
  if (!ids.length) return [];
  const u = new URL(YT_STREAMS);
  u.searchParams.set("part", "status,cdn,snippet");
  u.searchParams.set("id", ids.join(","));
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await r.text();
  if (!r.ok) {
    if (debug) throw new Error(`streams(${r.status}): ${text.slice(0,400)}`);
    throw new Error("streams");
  }
  try {
    const j = JSON.parse(text);
    return j.items || [];
  } catch {
    if (debug) throw new Error(`streams(json): ${text.slice(0,200)}`);
    throw new Error("streams");
  }
}

function mapHealth(h) {
  const v = lc((h || {}).status || "");
  if (v === "good") return { status: "perfect", label: "Perfect" };
  if (v === "ok")   return { status: "good",    label: "Good" };
  if (v === "bad")  return { status: "bad",     label: "Bad" };
  return { status: "nodata", label: "No data" };
}

export default async function handler(req, res) {
  const debug = (req.query.debug === "1" || req.query.debug === "true");
  try {
    const accessToken = await getAccessToken();
    const broadcasts = await listAllBroadcasts(accessToken, debug);

    // LIVE + TESTING prioritaire, READY/CREATED en fallback si stream déjà bind
    const interesting = broadcasts
      .filter(b => wantHealth(b) || maybeReady(b))
      .map(b => ({
        id: b.id,
        title: b?.snippet?.title || "Live",
        life: lc(b?.status?.lifeCycleStatus),           // live | testing | ready | created
        privacy: lc(b?.status?.privacyStatus || "public"),
        boundStreamId: b?.contentDetails?.boundStreamId || null
      }))
      .filter(b => !!b.boundStreamId);

    const streamIds = [...new Set(interesting.map(b => b.boundStreamId))];
    const streams = await listStreams(accessToken, streamIds, debug);
    const byId = new Map(streams.map(s => [s.id, s]));

    const items = interesting.map(b => {
      const s = byId.get(b.boundStreamId) || {};
      const h = mapHealth((s || {}).status || {});
      const cdn = (s || {}).cdn || {};
      const ingest = cdn.ingestionInfo || {};
      const lastUpdate = ((s || {}).status || {}).healthStatus
        ? (s.status.healthStatus.lastUpdateTime || null)
        : null;

      return {
        name: b.title + (b.life === "testing" ? " (preview)" : ""),
        status: h.status,
        statusLabel: h.label,
        lastUpdate,
        streamKey: ingest.streamName ? `${cdn.ingestionAddress || ""}/${ingest.streamName}`.trim() : "",
        lifeCycleStatus: b.life,
        privacy: b.privacy
      };
    })
    .filter(x => x.streamKey || x.status !== "nodata" || x.lifeCycleStatus === "live" || x.lifeCycleStatus === "testing");

    const payload = { items };
    if (debug) {
      payload.debug = {
        totalBroadcasts: broadcasts.length,
        sampled: interesting.slice(0, 5),
        haveStreams: streams.length
      };
    }
    res.status(200).json(payload);
  } catch (e) {
    res.status(200).json({ items: [], error: String(e) });
  }
}
