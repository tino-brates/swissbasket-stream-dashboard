export default async function handler(req, res) {
  try {
    const demo = [
      { name: 'SwissBasket Main', streamKey: 'rtmp://a.rtmp.youtube.com/live2/xxxx-xxxx-xxxx-xxxx', status: 'perfect', statusLabel: 'Perfect', lastUpdate: new Date().toISOString() },
      { name: 'Court A', streamKey: 'rtmp://a.rtmp.youtube.com/live2/aaaa-bbbb-cccc-dddd', status: 'good', statusLabel: 'Good', lastUpdate: new Date().toISOString() },
      { name: 'Court B', streamKey: 'rtmp://a.rtmp.youtube.com/live2/eeee-ffff-gggg-hhhh', status: 'bad', statusLabel: 'Bad', lastUpdate: new Date().toISOString() },
      { name: 'Court C', streamKey: 'rtmp://a.rtmp.youtube.com/live2/iiii-jjjj-kkkk-llll', status: 'nodata', statusLabel: 'No data', lastUpdate: new Date().toISOString() }
    ]
    res.status(200).json({ items: demo })
  } catch (e) {
    res.status(500).json({ items: [] })
  }
}
