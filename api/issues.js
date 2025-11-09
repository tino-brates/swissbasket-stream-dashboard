const BASE = (process.env.KEEMOTION_API_BASE || "https://pointguard.keemotion.com").replace(/\/$/, "");
const ARENAS_BASEPATH = process.env.KEEMOTION_ARENAS_BASEPATH || "/game/arenas";
const LIMIT  = process.env.KEEMOTION_LIMIT  || "25";
const OFFSET = process.env.KEEMOTION_OFFSET || "0";
const SCHEME = process.env.KEEMOTION_AUTH_SCHEME || "OAuth2";
const TOKEN  = process.env.KEEMOTION_TOKEN || "";

const ORIGIN  = process.env.KEEMOTION_ORIGIN  || "https://sportshub.keemotion.com";
const REFERER = process.env.KEEMOTION_REFERER || "https://sportshub.keemotion.com/";
const ALANG   = process.env.KEEMOTION_ACCEPT_LANGUAGE || "fr-CH,fr;q=0.9,de-DE;q=0.8,de;q=0.7,en-US;q=0.6,en;q=0.5,fr-FR;q=0.4";
const UA_BROWSER = process.env.KEEMOTION_UA_BROWSER || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const AGENT_FOR_ARENAS = "KeecastWeb 5.24.2";

function baseHeaders(extra={}) {
  return {
    Accept: "application/json",
    "Accept-Language": ALANG,
    "User-Agent": UA_BROWSER,
    Referer: REFERER,
    Origin: ORIGIN,
    "Keemotion-Agent": AGENT_FOR_ARENAS,
    ...extra
  };
}

function arenasURLs() {
  const p = ARENAS_BASEPATH.startsWith("/") ? ARENAS_BASEPATH : `/${ARENAS_BASEPATH}`;
  return [
    `${BASE}${p}?inactive=false&can_schedule=true&sort=name,asc&page=${encodeURIComponent(OFFSET)},${encodeURIComponent(LIMIT)}`,
    `${BASE}${p}?inactive=false&can_schedule=true&sort=name,asc&page=${encodeURIComponent(OFFSET)}&size=${encodeURIComponent(LIMIT)}`,
    `${BASE}${p}?inactive=false&can_schedule=true&sort=name,asc&limit=${encodeURIComponent(LIMIT)}&offset=${encodeURIComponent(OFFSET)}`
  ];
}

async function fetchJSON(url, options) {
  const r = await fetch(url, { cache: "no-store", ...options });
  let raw = ""; try { raw = await r.text(); } catch {}
  let json = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
  return { ok: r.ok, status: r.status, json, raw };
}

function isCriticalText(s) {
  const t = (s || "").toLowerCase();
  return t.includes("offline") || t.includes("no ingest") || t.includes("encoder offline") || t.includes("unstable") ||
         (t.includes("bandwidth") && (t.includes("low") || t.includes("insufficient") || t.includes("insuffisant")));
}

function mapArena(a) {
  const arena = a?.name || a?.arena_name || a?.venue?.name || a?.location?.name || a?.title || "";
  const statusCandidates = [a?.status, a?.online_status, a?.encoder?.status, a?.network_status, a?.bandwidth_status].filter(Boolean);
  const blob = JSON.stringify(a);
  const status = statusCandidates.find(s => typeof s === "string") || (blob.match(/"status":"([^"]+)"/)?.[1] || "");
  const note = a?.note || a?.network_message || a?.encoder?.message || "";
  const critical = isCriticalText(status) || isCriticalText(note) || isCriticalText(blob);
  return { arena, vendor: "Keemotion", status: status || (critical ? "Critical" : "OK"), note, updatedAt: a?.updated_at || a?.updatedAt || a?.last_seen || "", severity: critical ? "critical" : "normal" };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");

  if (!TOKEN) {
    return res.status(200).json({ items: [], error: "Missing KEEMOTION_TOKEN" });
  }

  try {
    const urls = arenasURLs();
    let data = null, last = { status: 0 };

    for (const u of urls) {
      const headers = baseHeaders({ Authorization: `${SCHEME} ${TOKEN}` });
      const out = await fetchJSON(u, { method: "GET", headers });
      last = out;
      if (out.ok && (Array.isArray(out.json) || Array.isArray(out.json?.results))) {
        data = Array.isArray(out.json) ? out.json : out.json.results;
        break;
      }
    }

    if (!data) {
      return res.status(200).json({ items: [], error: `Keemotion fetch failed (${last.status})` });
    }

    const mapped = data.map(mapArena).filter(x => x.arena);
    const criticalOnly = mapped.filter(x => x.severity === "critical");
    return res.status(200).json({ items: criticalOnly });
  } catch (e) {
    return res.status(200).json({ items: [], error: String(e) });
  }
}