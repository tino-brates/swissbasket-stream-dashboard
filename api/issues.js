const BASE = process.env.KEEMOTION_API_BASE || "https://pointguard.keemotion.com";
const ARENAS_BASEPATH = process.env.KEEMOTION_ARENAS_BASEPATH || "/game/arenas";
const LIMIT = encodeURIComponent(process.env.KEEMOTION_LIMIT || "25");
const OFFSET = encodeURIComponent(process.env.KEEMOTION_OFFSET || "0");

const SCHEME = process.env.KEEMOTION_AUTH_SCHEME || "OAuth2";
let STATIC_TOKEN = process.env.KEEMOTION_TOKEN || ""; // peut rester vide : on ira chercher via cookie

const UA = process.env.KEEMOTION_AGENT || "KeecastWeb 5.24.2";
const REF = process.env.KEEMOTION_REFERER || "https://sportshub.keemotion.com/";
const ORI = process.env.KEEMOTION_ORIGIN  || "https://sportshub.keemotion.com";
const ALANG = process.env.KEEMOTION_ACCEPT_LANGUAGE || "fr-CH,fr;q=0.9";
const COOKIE_T = process.env.KEEMOTION_COOKIE_T || ""; // valeur de t=...

function h() {
  return {
    Accept: "application/json",
    "Accept-Language": ALANG,
    "User-Agent": UA,
    Referer: REF,
    Origin: ORI,
    "Keemotion-Agent": UA
  };
}

// Essaie plusieurs variantes de pagination car Pointguard varie selon les tenants
function arenasCandidates() {
  return [
    `${ARENAS_BASEPATH}?inactive=false&can_schedule=true&sort=name,asc&page=${OFFSET},${LIMIT}`,
    `${ARENAS_BASEPATH}?inactive=false&can_schedule=true&sort=name,asc&page=${OFFSET}&size=${LIMIT}`,
    `${ARENAS_BASEPATH}?inactive=false&can_schedule=true&sort=name,asc&limit=${LIMIT}&offset=${OFFSET}`,
  ];
}

async function tryFetch(url, headers) {
  const r = await fetch(url, { method: "GET", headers, cache: "no-store" });
  const ok = r.ok;
  let json = null;
  try { json = await r.json(); } catch { /* ignore */ }
  return { ok, status: r.status, json };
}

// Échange le cookie t=… contre un access token (observé en PUT /auth/token)
async function obtainTokenFromCookie() {
  if (!COOKIE_T) return null;

  const url = `${BASE.replace(/\/$/, "")}/auth/token`;
  const headers = {
    ...h(),
    // Très important : le cookie tel qu'observé ("t=<valeur>")
    Cookie: `t=${COOKIE_T}`,
    "Content-Type": "application/json",
  };

  // Dans tes traces, c'est un PUT sans payload
  const r = await fetch(url, { method: "PUT", headers, body: JSON.stringify({}) });
  if (!r.ok) return null;

  // On tente d'extraire le token depuis la réponse
  let data = null;
  try { data = await r.json(); } catch { /* parfois vide */ }

  // Plusieurs façons possibles selon l'implémentation côté Pointguard
  const token =
    data?.access_token || data?.token || data?.jwt || data?.accessToken || null;

  return token;
}

function isCriticalText(s) {
  const t = (s || "").toLowerCase();
  return (
    t.includes("offline") ||
    t.includes("no ingest") ||
    t.includes("encoder offline") ||
    t.includes("not connected") ||
    t.includes("unstable") ||
    (t.includes("bandwidth") && (t.includes("low") || t.includes("insufficient") || t.includes("insuffisant")))
  );
}

function extractArenaItem(a) {
  const arena =
    a?.name || a?.arena_name || a?.venue?.name || a?.location?.name || a?.title || "";

  const statusCandidates = [
    a?.status, a?.online_status, a?.encoder?.status,
    a?.network_status, a?.bandwidth_status
  ].filter(Boolean);

  const blob = JSON.stringify(a);
  const status =
    statusCandidates.find(s => typeof s === "string") ||
    (blob.match(/"status":"([^"]+)"/)?.[1] || "") || "";

  const note = a?.note || a?.network_message || a?.encoder?.message || "";

  const critical = isCriticalText(status) || isCriticalText(note) || isCriticalText(blob);

  return {
    arena,
    vendor: "Keemotion",
    status: status || (critical ? "Critical" : "OK"),
    note,
    updatedAt: a?.updated_at || a?.updatedAt || a?.last_seen || "",
    severity: critical ? "critical" : "normal",
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");

  try {
    // 1) S’assure d’avoir un access token (header Authorization)
    let authToken = STATIC_TOKEN;
    if (!authToken) {
      authToken = await obtainTokenFromCookie();
      if (authToken) {
        // on l’enregistre en mémoire process (sur la Lambda) le temps de vie du process
        STATIC_TOKEN = authToken;
      }
    }

    // 2) Construit la liste des URLs candidates pour les arenas
    const urls = arenasCandidates().map(p => `${BASE.replace(/\/$/, "")}${p.startsWith("/") ? p : `/${p}`}`);

    // 3) Essaie jusqu’à succès
    let data = null;
    let lastStatus = 0;
    let usedUrl = null;

    for (const url of urls) {
      const headers = { ...h() };
      if (authToken) headers.Authorization = `${SCHEME} ${authToken}`;
      const out = await tryFetch(url, headers);
      lastStatus = out.status;
      if (out.ok && out.json) {
        usedUrl = url;
        data = out.json;
        break;
      }
    }

    if (!data) {
      return res.status(200).json({ items: [], error: `Keemotion fetch failed (${lastStatus})` });
    }

    const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
    const mapped = list.map(extractArenaItem).filter(x => x.arena);
    const criticalOnly = mapped.filter(x => x.severity === "critical");

    return res.status(200).json({ items: criticalOnly, debug: { usedUrl, auth: !!authToken } });
  } catch (e) {
    return res.status(200).json({ items: [], error: String(e) });
  }
}