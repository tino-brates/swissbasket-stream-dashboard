const DEFAULT_CHANNEL_ID = process.env.YT_CHANNEL_ID || "UCgJw4GIqhkaIF7nYYqRI84w";

function textBetween(s, start, end){
  const i=s.indexOf(start); if(i<0) return "";
  const j=s.indexOf(end, i+start.length); if(j<0) return "";
  return s.slice(i+start.length, j);
}

function entriesFromAtom(xml){
  const parts = xml.split("<entry>").slice(1).map(seg => "<entry>"+seg);
  return parts.map(e => {
    const title = textBetween(e,"<title>","</title>").trim();
    const videoId = textBetween(e,"<yt:videoId>","</yt:videoId>").trim();
    const published = textBetween(e,"<published>","</published>").trim();
    const updated = textBetween(e,"<updated>","</updated>").trim();
    const lbc = textBetween(e,"<yt:liveBroadcastContent>","</yt:liveBroadcastContent>").trim(); // live | upcoming | none
    return { title, videoId, published, updated, liveBroadcastContent: lbc };
  });
}

export default async function handler(req,res){
  try{
    const channelId = DEFAULT_CHANNEL_ID;
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
    const r = await fetch(url, { headers: { "user-agent":"Mozilla/5.0" }});
    if(!r.ok){ return res.status(200).json({ live:[], upcoming:[], source:"atom" }); }
    const xml = await r.text();
    const entries = entriesFromAtom(xml);

    const live = entries
      .filter(x=>x.liveBroadcastContent==="live")
      .map(x=>({ title:x.title, url:`https://www.youtube.com/watch?v=${x.videoId}`, startedAt:null }));

    const upcoming = entries
      .filter(x=>x.liveBroadcastContent==="upcoming")
      .map(x=>({ title:x.title, url:`https://www.youtube.com/watch?v=${x.videoId}`, scheduledStart:null }));

    res.status(200).json({ live, upcoming, source:"atom" });
  }catch{
    res.status(200).json({ live:[], upcoming:[], source:"atom" });
  }
}