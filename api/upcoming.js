const SHEET_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJbAy9lLRUi22IZZTwuL0hpbMdekSoyFbL05_GaO2p9gbHJFQYVomMlKIM8zRKX0e42B9awnelGz5H/pub?gid=1442510586&single=true&output=csv";

/* --- CSV utils (tolérant aux guillemets) --- */
function splitCSVLine(line){
  const out=[]; let cur=""; let inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){
      if(inQ && line[i+1]==='"'){ cur+='"'; i++; }
      else inQ=!inQ;
    }else if(c===',' && !inQ){
      out.push(cur); cur="";
    }else{
      cur+=c;
    }
  }
  out.push(cur);
  return out.map(s=>s.trim());
}
function parseCSV(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim().length>0);
  const headers=splitCSVLine(lines[0]).map(h=>h.trim());
  return lines.slice(1).map(l=>{
    const cols=splitCSVLine(l);
    const o={}; headers.forEach((h,i)=>o[h]=cols[i]??"");
    return o;
  });
}

/* --- helpers --- */
function toDateTimeCH(dateStr,timeStr){
  const ds=(dateStr||"").trim();
  const ts=(timeStr||"").trim();
  // format FR/CH: dd.mm.yyyy / dd/mm/yyyy / dd-mm-yyyy
  const m=ds.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if(m){
    const dd=parseInt(m[1],10), mm=parseInt(m[2],10), yyyy=parseInt(m[3],10);
    // accepte HH:MM ou HH:MM:SS
    const tt=ts.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    const hh=tt?parseInt(tt[1],10):0;
    const mn=tt?parseInt(tt[2],10):0;
    const ss=tt&&tt[3]?parseInt(tt[3],10):0;
    return new Date(Date.UTC(yyyy,mm-1,dd,hh,mn,ss));
  }
  const t=Date.parse(ds+(ts?` ${ts}`:""));
  return Number.isNaN(t)?null:new Date(t);
}
function normProd(s){
  const v=(s||"").toUpperCase();
  if(v.includes("KEEMOTION")) return "Keemotion";
  if(v.includes("SWISH"))     return "Swish Live"; // couvre variantes type "SSWISH LIVE"
  if(v.includes("MANUAL"))    return "Manual";
  if(v.trim()==="TV")         return "TV";
  return "";
}
function getCI(map, ...keys){
  for(const k of keys){
    const kk=k.toLowerCase();
    if(kk in map) return map[kk];
  }
  return "";
}

export default async function handler(req,res){
  try{
    const r=await fetch(SHEET_CSV);
    if(!r.ok) throw new Error("sheet");
    const text=await r.text();
    const rows=parseCSV(text);

    const now=Date.now();
    const horizon=now + 30*24*60*60*1000; // 30 jours

    const items = rows.map(row=>{
      const m={};
      Object.keys(row).forEach(k=>{ m[k.trim().toLowerCase()] = (row[k]||"").trim(); });

      const dateCol = getCI(m, "DATE","date");
      const timeCol = getCI(m, "HOUR","heure","time");
      const teamA   = getCI(m, "HOME","home","équipe a","equipe a");
      const teamB   = getCI(m, "AWAY","away","équipe b","equipe b");
      const arena   = getCI(m, "VENUE","venue","salle","arena","hall");
      const prodRaw = getCI(m, "Production","production","prod","méthode","method");
      const comp    = getCI(m, "COMPETITION","competition","league","ligue","compétition","competition name");
      const yt      = getCI(m, "YouTube ID","youtube id","yt id","youtube","youtubeeventid");

      const dt = toDateTimeCH(dateCol, timeCol);

      return {
        datetime: dt ? dt.toISOString() : null,
        teamA, teamB, arena,
        production: prodRaw,
        youtubeEventId: yt,
        competition: comp
      };
    })
    .filter(x => x.datetime)
    .filter(x => { const t=new Date(x.datetime).getTime(); return t>=now && t<=horizon; })
    .map(x => ({ ...x, production: normProd(x.production) }))
    .filter(x => !!x.production);

    res.status(200).json({ items });
  }catch(e){
    res.status(200).json({ items: [] });
  }
}