import fs from 'fs'
import path from 'path'
export default async function handler(req, res) {
  try {
    const p = path.join(process.cwd(), 'data', 'issues.json')
    const raw = fs.readFileSync(p, 'utf8')
    const items = JSON.parse(raw)
    res.status(200).json({ items })
  } catch (e) {
    res.status(200).json({ items: [] })
  }
}
