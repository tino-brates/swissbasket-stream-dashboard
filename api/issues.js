// Keemotion / Pointguard arena issues proxy
// Lit la liste des arènes et ne renvoie QUE les statuts critiques (offline, bandwidth insuffisant, unstable…).

const BASE = process.env.KEEMOTION_API_BASE || "https://pointguard.keemotion.com";
const PATH = process.env.KEEMOTION_ARENAS_PATH || "/game/arenas?inactive=false&can_schedule=true&sort=name,asc&page=0,25";
const TOKEN = process.env.KEEMOTION_TOKEN || "";
const SCHEME = process.env.KEEMOTION_AUTH_SCHEME || "OAuth2";
const UA = process.env.KEEMOTION_AGENT || "KeecastWeb 5.24.2";
const REF = process.env.KEEMOTION_REFERER || "";   // optionnel
const ORI = process.env.KEEMOTION_ORIGIN || "";    // optionnel

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
  // Nom probable de l’arène selon divers schémas possibles
  const arena =
    a?.name ||
    a?.arena_name ||
    a?.venue?.name ||
    a?.location?.name ||
    a?.title ||
    "";

  // Statut textuel : on tente plusieurs clés
  const statusCandidates = [
    a?.status,
    a?.online_status,
    a?.encoder?.status,
    a?.network_status,
    a?.bandwidth_status,
  ].filter(Boolean);

  // Si rien, tentative d’extraction depuis le JSON brut
  const blob = JSON.stringify(a);
  const status =
    statusCandidates.find(s => typeof s === "string") ||
    (blob.match(/"status":"([^"]+)"/)?.[1] || "") ||
    "";

  const note =
    a?.note ||
    a?.network_message ||
    a?.encoder?.message ||
    "";

  const critical =
    isCriticalText(status) ||
    isCriticalText(note) ||
    isCriticalText(blob);

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

  if (!TOKEN) {
    return res.status(200).json({ items: [], error: "Missing KEEMOTION_TOKEN" });
  }

  try {
    const url = `${BASE.replace(/\/$/, "")}${PATH.startsWith("/") ? PATH : `/${PATH}`}`;

    const headers = {
      Authorization: `${SCHEME} ${TOKEN}`,
      Accept: "application/json",
      "User-Agent": UA,
    };
    if (REF) headers["Referer"] = REF;
    if (ORI) headers["Origin"] = ORI;

    const r = await fetch(url, { headers });

    if (!r.ok) {
      return res.status(200).json({ items: [], error: `Keemotion fetch failed (${r.status})` });
    }

    const data = await r.json();
    // Format souvent { results: [...] } ou tableau direct :
    const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];

    const mapped = list.map(extractArenaItem).filter(x => x.arena);
    const criticalOnly = mapped.filter(x => x.severity === "critical");

    return res.status(200).json({ items: criticalOnly });
  } catch (e) {
    return res.status(200).json({ items: [], error: String(e) });
  }
}