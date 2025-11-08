const SHEET_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJbAy9lLRUi22IZZTwuL0hpbMdekSoyFbL05_GaO2p9gbHJFQYVomMlKIM8zRKX0e42B9awnelGz5H/pub?gid=1442510586&single=true&output=csv"

function parseCSV(text) {
  const rows = []
  let cur = []
  let buf = ""
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    if (c === '"' && inQ && n === '"') { buf += '"'; i++; continue }
    if (c === '"') { inQ = !inQ; continue }
    if (c === ',' && !inQ) { cur.push(buf); buf = ""; continue }
    if ((c === '\n' || c === '\r') && !inQ) {
      if (buf !== "" || cur.length > 0) { cur.push(buf); rows.push(cur); cur = []; buf = "" }
      continue
    }
    buf += c
  }
  if (buf !== "" || cur.length > 0) { cur.push(buf); rows.push(cur) }
  return rows.filter(r => r.some(x => x && x.trim() !== ""))
}
function normMethod(s) {
  const v = (s || "").toString().trim().toUpperCase()
  if (v.includes("KEEMOTION")) return "Keemotion"
  if (v.includes("SWISH")) return "Swish Live"
  if (v.includes("MANUAL")) return "Manual"
  if (v === "TV") return "TV"
  return v || "Manual"
}
function toLocalISO(dateStr, timeStr) {
  const [d, m, y] = dateStr.split(/[./-]/).map(x => parseInt(x, 10))
  const [hh, mm] = (timeStr || "00:00").split(":").map(x => parseInt(x, 10))
  const pad = n => String(n).padStart(2, "0")
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00`
}
export default async function handler(req, res) {
  try {
    const r = await fetch(SHEET_CSV)
    if (!r.ok) return res.status(200).json({ items: [] })
    const csv = await r.text()
    const rows = parseCSV(csv)
    if (!rows.length) return res.status(200).json({ items: [] })
    const header = rows[0].map(h => h.trim().toUpperCase())
    const idx = {
      DATE: header.indexOf("DATE"),
      HOUR: header.indexOf("HOUR"),
      COMPETITION: header.indexOf("COMPETITION"),
      DAY: header.indexOf("DAY"),
      HOME: header.indexOf("HOME"),
      AWAY: header.indexOf("AWAY"),
      VENUE: header.indexOf("VENUE"),
      PRODUCTION: header.indexOf("PRODUCTION")
    }
    const now = new Date()
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const items = rows.slice(1).map(c => {
      const date = c[idx.DATE] || ""
      const time = c[idx.HOUR] || ""
      const dt = toLocalISO(date, time)
      return {
        datetime: dt,
        teamA: c[idx.HOME] || "",
        teamB: c[idx.AWAY] || "",
        arena: c[idx.VENUE] || "",
        method: normMethod(c[idx.PRODUCTION]),
        production: c[idx.PRODUCTION] || "",
        competition: c[idx.COMPETITION] || "",
        day: c[idx.DAY] || "",
        youtubeEventId: ""
      }
    }).filter(x => {
      const t = new Date(x.datetime)
      return t >= now && t <= in7
    })
    items.sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
    res.status(200).json({ items })
  } catch (e) {
    res.status(200).json({ items: [] })
  }
}
