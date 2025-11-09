// ---------- Keemotion Issues (arenas critiques) ----------

const BASE = (process.env.KEEMOTION_API_BASE || "https://pointguard.keemotion.com").replace(/\/$/, "");
const ARENAS_BASEPATH = process.env.KEEMOTION_ARENAS_BASEPATH || "/game/arenas";
const LIMIT  = process.env.KEEMOTION_LIMIT  || "25";
const OFFSET = process.env.KEEMOTION_OFFSET || "0";

const SCHEME = process.env.KEEMOTION_AUTH_SCHEME || "OAuth2";
let   STATIC_TOKEN = process.env.KEEMOTION_TOKEN || "";
const COOKIE_T     = process.env.KEEMOTION_COOKIE_T || "";

// Toujours ces valeurs exactes (pour éliminer les typos côté env)
const AGENT_TOKEN_FOR_AUTH = "Auth0 3.3.0";           // pour PUT /auth/token (obligatoire)
const AGENT_FOR_ARENAS     = "KeecastWeb 5.24.2";     // pour GET /game/arenas...

const ORIGIN  = process.env.KEEMOTION_ORIGIN  || "https://sportshub.keemotion.com";
const REFERER = process.env.KEEMOTION_REFERER || "https://sportshub.keemotion.com/";
const ALANG   = process.env.KEEMOTION_ACCEPT_LANGUAGE
  || "fr-CH,fr;q=0.9,de-DE;q=0.8,de;q=0.7,en-US;q=0.6,en;q=0.5,fr-FR;q=0.4";
const UA_BROWSER = process.env.KEEMOTION_UA_BROWSER
  || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

function baseHeaders(extra = {}) {
  return {
    Accept: "application/json",
    "Accept-Language": ALANG,
    "User-Agent": UA_BROWSER,
    Referer: REFERER,
    Origin: ORIGIN,
    ...extra,
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
  let raw = "";
  try { raw = await r.text(); } catch {}
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch {}
  return { ok: r.ok, status: r.status, headers: r.headers, json, raw };
}

async function obtainTokenFromCookie() {
  const debug = { tried: [], tokenFound: false, tokenSource: null };

  if (!COOKIE_T) {
    debug.tried.push("no COOKIE_T supplied");
    return { token: null, debug };
  }

  // Tentative 1: EXACT "Auth0 3.3.0" (clé du succès)
  {
    const headers = baseHeaders({
      "Keemotion-Agent": AGENT_TOKEN_FOR_AUTH,
      "Content-Type": "application/json",
      Cookie: `t=${COOKIE_T}`,
      "Cache-Control": "no-cache",
      "X-Requested-With": "XMLHttpRequest",
    });

    // corps vide OK, mais pour ressembler au trafic réel on met un petit JSON
    const resp = await fetchJSON(`${BASE}/auth/token`, { method: "PUT", headers, body: JSON.stringify({ from: "web" }) });
    debug.tried.push({ step: `PUT /auth/token [${AGENT_TOKEN_FOR_AUTH}]`, status: resp.status, raw: resp.raw?.slice(0,200) });

    const token = resp.json?.access_token || resp.json?.accessToken || resp.json?.token || resp.json?.jwt
      || (resp.headers?.get("Authorization") || "").replace(/^OAuth2\s+/i, "").replace(/^Bearer\s+/i, "");

    if (token) { debug.tokenFound = true; debug.tokenSource = AGENT_TOKEN_FOR_AUTH; return { token, debug }; }
  }

  // Tentative 2: GET /me (parfois renvoie un blob contenant le jwt)
  {
    const headers = baseHeaders({ Cookie: `t=${COOKIE_T}` });
    const resp = await fetchJSON(`${BASE}/me`, { method: "GET", headers });
    debug.tried.push({ step: "GET /me", status: resp.status, raw: resp.raw?.slice(0,200) });

    const m = resp.raw && resp.raw.match(/eyJ[A-Za-z0-9\-\._=]{10,}|[A-Za-z0-9\-\._~\+\/=]{30,}/);
    if (m) { debug.tokenFound = true; debug.tokenSource = "regex(/me)"; return { token: m[0], debug }; }
  }

  return { token: null, debug };
}

function isCriticalText(s) {
  const t = (s || "").toLowerCase();
  return (
    t.includes("offline") ||
    t.includes("no ingest") ||
    t.includes("encoder offline") ||
    t.includes("unstable") ||
    (t.includes("bandwidth") && (t.includes("low") || t.includes("insufficient") || t.includes("insuffisant")))
  );
}

function mapArena(a) {
  const arena = a?.name || a?.arena_name || a?.venue?.name || a?.location?.name || a?.title || "";
  const statusCandidates = [
    a?.status, a?.online_status, a?.encoder?.status, a?.network_status, a?.bandwidth_status
  ].filter(Boolean);

  const blob = JSON.stringify(a);
  const status = statusCandidates.find(s => typeof s === "string") ||
                 (blob.match(/"status":"([^"]+)"/)?.[1] || "");
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
  const debug = { authFlow: {}, usedUrl: null, sentCookie: !!COOKIE_T };

  try {
    // 1) token
    let token = STATIC_TOKEN || null;
    if (!token) {
      const r = await obtainTokenFromCookie();
      debug.authFlow = r.debug;
      token = r.token;
      if (token) STATIC_TOKEN = token;
    } else {
      debug.authFlow = { usedStaticEnvToken: true };
    }

    // 2) arenas
    const urls = arenasURLs();
    let data = null, last = { status: 0 };

    for (const u of urls) {
      const headers = baseHeaders({
        "Keemotion-Agent": AGENT_FOR_ARENAS,
        Authorization: token ? `${SCHEME} ${token}` : undefined,
        Cookie: COOKIE_T ? `t=${COOKIE_T}` : undefined,
      });

      const out = await fetchJSON(u, { method: "GET", headers });
      last = out;
      if (out.ok && (Array.isArray(out.json) || Array.isArray(out.json?.results))) {
        debug.usedUrl = u;
        data = Array.isArray(out.json) ? out.json : out.json.results;
        break;
      }
    }

    if (!data) {
      return res.status(200).json({ items: [], error: `Keemotion fetch failed (${last.status})`, debug });
    }

    const mapped = data.map(mapArena).filter(x => x.arena);
    const critical = mapped.filter(x => x.severity === "critical");
    return res.status(200).json({ items: critical, debug });
  } catch (e) {
    return res.status(200).json({ items: [], error: String(e), debug });
  }
}