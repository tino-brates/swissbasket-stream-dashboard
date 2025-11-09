const TOKEN_URL = "https://oauth2.googleapis.com/token"

async function getAccessToken() {
  const params = new URLSearchParams()
  params.set("client_id", process.env.YT_CLIENT_ID)
  params.set("client_secret", process.env.YT_CLIENT_SECRET)
  params.set("refresh_token", process.env.YT_REFRESH_TOKEN)
  params.set("grant_type", "refresh_token")
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params })
  if (!r.ok) throw new Error("token")
  const j = await r.json()
  return j.access_token
}

async function listActiveBroadcasts(accessToken) {
  const u = new URL("https://www.googleapis.com/youtube/v3/liveBroadcasts")
  u.searchParams.set("part", "id,snippet,contentDetails,status")
  u.searchParams.set("broadcastStatus", "active")
  u.searchParams.set("mine", "true")
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!r.ok) throw new Error("broadcasts")
  const j = await r.json()
  return j.items || []
}

async function listStreams(accessToken, ids) {
  if (!ids.length) return []
  const u = new URL("https://www.googleapis.com/youtube/v3/liveStreams")
  u.searchParams.set("part", "status,cdn,snippet")
  u.searchParams.set("id", ids.join(","))
  const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!r.ok) throw new Error("streams")
  const j = await r.json()
  return j.items || []
}

function mapHealth(h) {
  const v = ((h || {}).status || "").toLowerCase()
  if (v === "good") return { status: "perfect", label: "Perfect" }
  if (v === "ok") return { status: "good", label: "Good" }
  if (v === "bad") return { status: "bad", label: "Bad" }
  return { status: "nodata", label: "No data" }
}

export default async function handler(req, res) {
  try {
    const accessToken = await getAccessToken()
    const broadcasts = await listActiveBroadcasts(accessToken)
    const streamIds = broadcasts.map(b => (b.contentDetails || {}).boundStreamId).filter(Boolean)
    const streams = await listStreams(accessToken, streamIds)
    const byId = new Map(streams.map(s => [s.id, s]))
    const items = broadcasts.map(b => {
      const sid = (b.contentDetails || {}).boundStreamId
      const s = byId.get(sid)
      const h = mapHealth((s || {}).status || {})
      const cdn = (s || {}).cdn || {}
      const ingest = cdn.ingestionInfo || {}
      return {
        name: (b.snippet || {}).title || "Live",
        status: h.status,
        statusLabel: h.label,
        lastUpdate: ((s || {}).status || {}).healthStatus ? ((s.status.healthStatus || {}).lastUpdateTime || null) : null,
        streamKey: ingest.streamName ? `${cdn.ingestionAddress || ""}/${ingest.streamName}`.trim() : ""
      }
    })
    res.status(200).json({ items })
  } catch (e) {
    res.status(200).json({ items: [] })
  }
}