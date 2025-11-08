export default async function handler(req, res) {
  try {
    const demo = [
      { title: 'Nyon vs Pully', arena: 'Salle du Rocher', startedAt: new Date().toISOString(), url: 'https://youtube.com/live/demo1' },
      { title: 'BC Zurich 93 vs Vevey', arena: 'Hallenstadion B', startedAt: new Date(Date.now()-600000).toISOString(), url: 'https://youtube.com/live/demo2' }
    ]
    res.status(200).json({ items: demo })
  } catch (e) {
    res.status(500).json({ items: [] })
  }
}
