// --- Config depuis Vercel ---
const BASE = (process.env.KEEMOTION_API_BASE || "https://pointguard.keemotion.com").replace(/\/$/, "");
const ARENAS_BASEPATH = process.env.KEEMOTION_ARENAS_BASEPATH || "/game/arenas";
const LIMIT  = process.env.KEEMOTION_LIMIT  || "25";
const OFFSET = process.env.KEEMOTION_OFFSET || "0";

const SCHEME = process.env.KEEMOTION_AUTH_SCHEME || "OAuth2";
let   STATIC_TOKEN = process.env.KEEMOTION_TOKEN || ""; // peut rester vide
const COOKIE_T     = process.env.KEEMOTION_COOKIE_T || ""; // valeur brute de t=...

const UA    = process.env.KEEMOTION_AGENT || "KeecastWeb 5.24.2";
const REF   = process.env.KEEMOTION_REFERER || "https://sportshub.keemotion.com/";
const ORI   = process.env.KEEMOTION_ORIGIN  || "https://sportshub.keemotion.com";
const ALANG = process.env.KEEMOTION_ACCEPT_LANGUAGE || "fr-CH,fr;q=0.9,de-DE;q=0.8,de;q=0.7,en-US;q=0.6,en;q=0.5,fr-FR;q=0.4";

function baseHeaders(extra = {}) {
  return {
    Accept: "application/json",
    "Accept-Language": ALANG,
    "User-Agent": UA,
    Referer: REF,
    Origin: ORI,
    "Keemotion-Agent": UA,
    ...extra,
  };
}

function arenasURLs() {
  const p = ARENAS_BASEPATH.startsWith("/") ? ARENAS_BASEPATH : `/${ARENAS_BASEPATH}`;
  return [
    `${BASE}${p}?inactive=false&can_schedule=true&sort=name,asc&page=${encodeURIComponent(OFFSET)},${encodeURIComponent(LIMIT)}`,
    `${BASE}${p}?inactive=false&can_schedule=true&sort=name,asc&page=${encodeURIComponent(OFFSET)}&size=${encodeURIComponent(LIMIT)}`,
    `${BASE}${p}?inactive=false&can_schedule=true&sort=name,asc&limit=${encodeURIComponent(LIMIT)}&offset=${encodeURIComponent(OFFSET)}`,
  ];
}

async function fetchJSON(url, options) {
  const r = await fetch(url, { cache: "no-store", ...options });
  let bodyText = "";
  try { bodyText = await r.text(); } catch {}
  let json = null;
  try { json = bodyText ? JSON.parse(bodyText) : null; } catch {}
  return { ok: r.ok, status: r.status, headers: r.headers, json, raw: bodyText };
}

async function obtainTokenFromCookie() {
  const debug = { tried: [], tokenFound: false, tokenSource: null };

  if (!COOKIE_T) {
    debug.tried.push("no COOKIE_T supplied");
    return { token: null, debug };
  }

  const url = `${BASE}/auth/token`;
  const headers = baseHeaders({
    Cookie: `t=${COOKIE_T}`,
    "Content-Type": "application/json",
    // certains tenants aiment bien ce header
    "Cache-Control": "no-cache",
  });

  // 1) PUT (observé dans tes captures)
  const r1 = await fetchJSON(url, { method: "PUT", headers, body: "{}" });
  debug.tried.push({ step: "PUT /auth/token", status: r1.status, raw: r1.raw?.slice(0, 200) });

  // a) token dans le corps ?
  let token = r1.json?.access_token || r1.json?.token || r1.json?.jwt || r1.json?.accessToken || null;
  if (token) {
    debug.tokenFound = true; debug.tokenSource = "json(PUT)";
    return { token, debug };
  }

  // b) token dans les headers ?
  const authHdr = r1.headers?.get("Authorization") || r1.headers?.get("authorization");
  if (authHdr && /[A-Za-z0-9\-\._~\+\/=]{20,}/.test(authHdr)) {
    token = authHdr.replace(/^OAuth2\s+/i, "").replace(/^Bearer\s+/i, "");
    debug.tokenFound = true; debug.tokenSource = "header(PUT)";
    return { token, debug };
  }

  // 2) GET (certains endpoints renvoient le token au GET)
  const r2 = await fetchJSON(url, { method: "GET", headers: baseHeaders({ Cookie: `t=${COOKIE_T}` }) });
  debug.tried.push({ step: "GET /auth/token", status: r2.status, raw: r2.raw?.slice(0, 200) });

  token = r2.json?.access_token || r2.json?.token || r2.json?.jwt || r2.json?.accessToken || null;
  if (token) {
    debug.tokenFound = true; debug.tokenSource = "json(GET)";
    return { token, debug };
  }

  const authHdr2 = r2.headers?.get("Authorization") || r2.headers?.get("authorization");
  if (authHdr2 && /[A-Za-z0-9\-\._~\+\/=]{20,}/.test(authHdr2)) {
    token = authHdr2.replace(/^OAuth2\s+/i, "").replace(/^Bearer\s+/i, "");
    debug.tokenFound = true; debug.tokenSource = "header(GET)";
    return { token, debug };
  }

  // 3) /me (parfois renvoie un blob contenant un token)
  const r3 = await fetchJSON(`${BASE}/me`, { method: "GET", headers: baseHeaders({ Cookie: `t=${COOKIE_T}` }) });
  debug.tried.push({ step: "GET /me", status: r3.status, raw: r3.raw?.slice(0, 200) });

  // tente extraction naïve d’un jeton style JWT/opaque
  const m = r3.raw && r3.raw.match(/eyJ[A-Za-z0-9\-\._=]{10,}|[A-Za-z0-9\-\._~\+\/=]{30,}/);
  if (m) {
    token = m[0];
    debug.tokenFound = true; debug.tokenSource = "regex(/me)";
    return { token, debug };
  }

  return { token: null, debug };
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

function mapArena(a) {
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

  const debug = { authFlow: {}, usedUrl: null, sentCookie: !!COOKIE_T };

  try {
    // 1) token depuis env ou cookie->token
    let token = STATIC_TOKEN || null;
    if (!token) {
      const r = await obtainTokenFromCookie();
      debug.authFlow = r.debug;
      token = r.token;
      if (token) STATIC_TOKEN = token; // cache process
    } else {
      debug.authFlow = { usedStaticEnvToken: true };
    }

    // 2) essaie les URLs arenas
    const urls = arenasURLs();
    let data = null, last = { status: 0 };

    for (const u of urls) {
      const headers = baseHeaders(
        token
          ? { Authorization: `${SCHEME} ${token}`, Cookie: COOKIE_T ? `t=${COOKIE_T}` : undefined }
          : { Cookie: COOKIE_T ? `t=${COOKIE_T}` : undefined }
      );

      const out = await fetchJSON(u, { method: "GET", headers });
      last = out;
      if (out.ok && (Array.isArray(out.json) || Array.isArray(out.json?.results))) {
        debug.usedUrl = u;
        data = Array.isArray(out.json) ? out.json : out.json.results;
        break;
      }
    }

    if (!data) {
      return res.status(200).json({
        items: [],
        error: `Keemotion fetch failed (${last.status})`,
        debug
      });
    }

    const mapped = data.map(mapArena).filter(x => x.arena);
    const critical = mapped.filter(x => x.severity === "critical");
    return res.status(200).json({ items: critical, debug });
  } catch (e) {
    return res.status(200).json({ items: [], error: String(e), debug });
  }
}