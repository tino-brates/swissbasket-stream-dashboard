import fs from "fs"
import path from "path"

export default async function handler(req, res) {
  try {
    const filePath = path.join(process.cwd(), "index.html")
    const html = fs.readFileSync(filePath, "utf8")
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.status(200).send(html)
  } catch (e) {
    res.status(500).send("Error loading index.html")
  }
}