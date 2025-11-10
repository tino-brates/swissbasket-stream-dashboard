// api/issues.js — proxy vers ta Web App Apps Script (Keemotion)

export default async function handler(req, res) {
  const { debug } = req.query;
  const WEBAPP = process.env.KEEM_WEBAPP_URL;
  const KEY    = process.env.KEEM_WEBAPP_KEY;

  if (!WEBAPP || !KEY) {
    return res.status(200).json({
      items: [],
      error: "Missing KEEM_WEBAPP_URL / KEEM_WEBAPP_KEY env vars"
    });
  }

  try {
    const url = `${WEBAPP}?path=issues&key=${encodeURIComponent(KEY)}`;
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();

    if (!r.ok) {
      return res.status(200).json({
        items: [],
        error: `AppsScript fetch failed (${r.status})`,
        debug: debug ? { status: r.status, body: text.slice(0, 400) } : undefined
      });
    }

    let data; try { data = JSON.parse(text); } catch { data = { items: [] }; }
    const items = Array.isArray(data.items) ? data.items : [];
    return res.status(200).json({
      items,
      debug: debug ? { count: items.length, sample: items.slice(0,3) } : undefined
    });
  } catch (err) {
    return res.status(200).json({
      items: [],
      error: "Proxy error",
      debug: debug ? { message: String(err) } : undefined
    });
  }
}