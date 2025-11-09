const SHEET_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSJbAy9lLRUi22IZZTwuL0hpbMdekSoyFbL05_GaO2p9gbHJFQYVomMlKIM8zRKX0e42B9awnelGz5H/pub?gid=1442510586&single=true&output=csv";

function splitCSVLine(line){
  const out=[]; let cur=""; let inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){ if(inQ && line[i+1]==='"'){cur+='"'; i++;} else inQ=!inQ; }
    else if(c===',' && !inQ){ out.push(cur); cur=""; }
    else cur+=c;
  }
  out.push(cur);
  return out.map(s=>s.trim());
}
function parseCSV(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim().length>0);
  const headers=splitCSVLine(lines[0]);
  return lines.slice(1).map(l=>{
    const cols=splitCSVLine(l);
    const o={}; headers.forEach((h,i)=>o[h]=cols[i]??"");
    return o;
  });
}
function toDateTimeCH(dateStr,timeStr){
  const ds=(dateStr||"").trim();
  const ts=(timeStr||"").trim();
  const m=ds.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if(m){
    const dd=parseInt(m[1],10), mm=parseInt(m[2],10), yyyy=parseInt(m[3],10);
    const tt=ts.match(/^(\d{1,2}):(\d{2})$/);
    const hh=tt?parseInt(tt[1],10):0, mn=tt?parseInt(tt[2],10):0;
    return new Date(Date.UTC(yyyy,mm-1,dd,hh,mn,0));
  }
  const t=Date.parse(ds+(ts?` ${ts}`:""));
  return Number.isNaN(t)?null:new Date(t);
}
function normProd(s){
  const v=(s||"").toUpperCase();
  if(v.includes("KEEMOTION"))return"Keemotion";
  if(v.includes("SWISH"))return"Swish Live";
  if(v.includes("MANUAL"))return"Manual";
  if(v.trim()==="TV")return"TV";
  return"";
}

export default async function handler(req,res){
  try{
    const r=await fetch(SHEET_CSV);
    if(!r.ok)throw new Error("sheet");
    const text=await r.text();
    const rows=parseCSV(text);

    const now=Date.now();
    const horizon=now+30*24*60*60*1000;

    const items=rows.map(row=>{
      const dateCol=row.Date||row.DATE||row.date||row["Date du match"]||"";
      const timeCol=row.Time||row.TIME||row.time||row.Heure||"";
      const teamA=row["Home Team"]||row.Home||row["Equipe A"]||row.TeamA||row.HomeTeam||"";
      const teamB=row["Away Team"]||row.Away||row["Equipe B"]||row.TeamB||row.AwayTeam||"";
      const arena=row.Arena||row.Hall||row.Salle||row.Venue||"";
      const production=row.Production||row["Production"]||row.Prod||row.Method||"";
      const yt=row["YouTube ID"]||row["YT ID"]||row["YouTube"]||row["youtubeEventId"]||"";
      const competition=row.Competition||row.League||row["Compétition"]||"";
      const dt=toDateTimeCH(dateCol,timeCol);
      return {
        datetime: dt?dt.toISOString():null,
        teamA, teamB, arena,
        production, youtubeEventId: yt,
        competition
      };
    })
    .filter(x=>x.datetime)
    .filter(x=>{const t=new Date(x.datetime).getTime();return t>=now && t<=horizon;})
    .filter(x=>!!normProd(x.production));

    res.status(200).json({items});
  }catch(e){
    res.status(200).json({items:[]});
  }
}