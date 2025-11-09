const state = {
  filterProd: 'ALL',
  search: '',
  activeUpcomingTab: 'RANGE1',
  data: { live: [], ytUpcoming: [], issues: [], upcoming: [], health: [], ytMeta: { source:'', quotaBackoffUntil:0, lastError:'' } }
};

function fmtDate(d){const x=new Date(d);return x.toLocaleDateString('fr-CH',{weekday:'short',year:'numeric',month:'2-digit',day:'2-digit'})}
function fmtTime(d){const x=new Date(d);return x.toLocaleTimeString('fr-CH',{hour:'2-digit',minute:'2-digit'})}
function withinNextMinutes(d,min){const now=Date.now();const t=new Date(d).getTime();return t>=now&&t<=now+min*60000}
function isInFuture(d){return new Date(d).getTime()>=Date.now()}
function timeSince(date){const s=Math.floor((Date.now()-new Date(date))/1000);if(s<60)return `${s}s`;const m=Math.floor(s/60);if(m<60)return `${m} min`;const h=Math.floor(m/60);return `${h} h ${m%60} min`}
function pad2(n){return n<10?`0${n}`:`${n}`}
function elapsedHM(start){if(!start)return"";const secs=Math.max(0,Math.floor((Date.now()-new Date(start).getTime())/1000));const h=Math.floor(secs/3600);const m=Math.floor((secs%3600)/60);const s=secs%60;return h>0?`${pad2(h)}:${pad2(m)}`:`${pad2(m)}:${pad2(s)}`}

function startOfWeekMonday(dt){const d=new Date(dt);const day=(d.getDay()+6)%7;d.setHours(0,0,0,0);d.setDate(d.getDate()-day);return d}
function endOfWeekSunday(dt){const d=startOfWeekMonday(dt);d.setDate(d.getDate()+6);d.setHours(23,59,59,999);return d}
function endOfComingSunday(dt){const d=new Date(dt);const day=d.getDay();const add=(7-day)%7;const end=new Date(d);end.setDate(d.getDate()+add);end.setHours(23,59,59,999);return end}
function endOfNextWeekSunday(dt){const d=startOfWeekMonday(dt);d.setDate(d.getDate()+13);d.setHours(23,59,59,999);return d}

function normProd(s){const v=(s||'').toUpperCase();if(!v)return'';if(v.includes('KEEMOTION'))return'Keemotion';if(v.includes('SWISH'))return'Swish Live';if(v.includes('MANUAL'))return'Manual';if(v==='TV')return'TV';return''}
function prodGroup(p){if(p==='Swish Live'||p==='Manual')return'SwishManual';return p||''}
function badgeForStatus(s){const map={perfect:'status-perfect',good:'status-good',bad:'status-bad',nodata:'status-nodata'};return map[s]||'status-nodata'}
function badgeForIssue(s){const map={sufficient:'status-ok',insufficient:'status-warn',offline:'status-error',unknown:'status-nodata'};return map[s]||'status-nodata'}

function renderLive(){
  const box=document.getElementById('liveNow');box.innerHTML='';
  if(state.data.live.length){
    state.data.live.forEach(x=>{
      const el=document.createElement('div');el.className='item';
      el.innerHTML=`
        <div style="font-weight:600;">${x.title}</div>
        <div></div>
        <div>${elapsedHM(x.startedAt)}</div>
        <a class="tag" href="${x.url}" target="_blank">Ouvrir</a>`;
      box.appendChild(el);
    });
    return;
  }
  let next3=(state.data.ytUpcoming||[])
    .filter(x=>x.scheduledStart?isInFuture(x.scheduledStart):true)
    .sort((a,b)=>{
      const ta=a.scheduledStart?new Date(a.scheduledStart).getTime():Infinity;
      const tb=b.scheduledStart?new Date(b.scheduledStart).getTime():Infinity;
      return ta-tb;
    })
    .slice(0,3)
    .map(x=>({title:x.title, when:x.scheduledStart?`${fmtDate(x.scheduledStart)} ${fmtTime(x.scheduledStart)}`:"Heure N/A", url:x.url, tag:'UPCOMING'}));
  if(next3.length===0){
    next3=state.data.upcoming
      .map(x=>({...x,prod:normProd(x.production)}))
      .filter(x=>x.prod&&isInFuture(x.datetime))
      .sort((a,b)=>new Date(a.datetime)-new Date(b.datetime))
      .slice(0,3)
      .map(x=>({title:`${x.teamA} vs ${x.teamB}`, when:`${fmtDate(x.datetime)} ${fmtTime(x.datetime)}`, url:'', tag:x.prod}));
  }
  if(next3.length===0){return}
  next3.forEach(x=>{
    const el=document.createElement('div');
    el.className='item';
    el.setAttribute('style','position:relative;opacity:.45;');
    el.innerHTML=`
      <div style="font-weight:600;">${x.title}</div>
      <div></div>
      <div>${x.when}</div>
      ${x.url?`<a class="tag" href="${x.url}" target="_blank">Ouvrir</a>`:`<span class="tag">${x.tag}</span>`}
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
        <span style="font-weight:700;letter-spacing:.1em;border:1px solid currentColor;border-radius:9999px;padding:.2rem .6rem;opacity:.9;">UPCOMING</span>
      </div>`;
    box.appendChild(el);
  });
}

function renderIssues(){
  const box = document.getElementById('issues');
  box.innerHTML = '';

  if (!state.data.issues.length) {
    const e = document.createElement('div');
    e.className = 'muted';
    e.textContent = 'Aucun problème signalé.';
    box.appendChild(e);
    return;
  }

  state.data.issues.forEach(x => {
    const el = document.createElement('div');
    el.className = 'item';

    // mappe le code statut -> classe couleur sur .tag (et pas .badge)
    const cls = x.statusCode === 'offline'     ? 'tag-error'
              : x.statusCode === 'insufficient'? 'tag-warn'
              : 'tag-ok';

    el.innerHTML = `
      <div>${x.arena}</div>
      <div>${x.vendor}</div>
      <div>${x.note || ''}</div>
      <span class="tag ${cls}">${x.status || ''}</span>
    `;
    box.appendChild(el);
  });
}

function renderNext90(){
  const box=document.getElementById('next90');box.innerHTML='';
  const soonYT=(state.data.ytUpcoming||[]).filter(x=>x.scheduledStart&&withinNextMinutes(x.scheduledStart,90));
  let soon = soonYT.sort((a,b)=>new Date(a.scheduledStart)-new Date(b.scheduledStart)).map(x=>({ title:x.title, time:fmtTime(x.scheduledStart), url:x.url }));
  if(!soon.length){
    const sheetSoon=state.data.upcoming
      .map(x=>({...x,prod:normProd(x.production)}))
      .filter(x=>x.prod && withinNextMinutes(x.datetime,90))
      .sort((a,b)=>new Date(a.datetime)-new Date(b.datetime))
      .map(x=>({ title:`${x.teamA} vs ${x.teamB}`, time:fmtTime(x.datetime), url:'' }));
    soon = sheetSoon;
  }
  if(!soon.length){const e=document.createElement('div');e.className='muted';e.textContent='Time to rest 😴';box.appendChild(e);return}
  soon.forEach(x=>{
    const el=document.createElement('div');el.className='item';
    el.innerHTML=`
      <div style="font-weight:600;">${x.title}</div>
      <div></div>
      <div>${x.time}</div>
      ${x.url?`<a class="tag" href="${x.url}" target="_blank">Ouvrir</a>`:''}`;
    box.appendChild(el);
  });
}

function renderHealth(){
  const box=document.getElementById('ytHealth');box.innerHTML='';
  if(!state.data.live.length){return}
  if(!state.data.health.length){return}
  state.data.health.forEach(x=>{
    const since=x.lastUpdate?timeSince(x.lastUpdate):'';
    const el=document.createElement('div');
    el.className='item';
    el.innerHTML=`
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;width:100%;">
        <div style="flex:1;min-width:140px;">${x.name}</div>
        <div class="badge ${badgeForStatus(x.status)}">${x.statusLabel}</div>
        <div class="muted" style="flex:1;min-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${x.streamKey||''}</div>
        <div class="muted" style="white-space:nowrap;">${x.lastUpdate?fmtTime(x.lastUpdate):''}</div>
        <div class="muted" style="font-size:.8em;opacity:.7;">🕒 il y a ${since}</div>
      </div>`;
    box.appendChild(el);
  });
}

function inActiveTabRange(d){
  const t=new Date(d).getTime();
  const now=new Date();
  if(state.activeUpcomingTab==='RANGE1'){
    const end=endOfComingSunday(now).getTime();
    return t>=Date.now() && t<=end;
  }else{
    const start=startOfWeekMonday(now).getTime();
    const end=endOfNextWeekSunday(now).getTime();
    return t>=start && t<=end;
  }
}

function renderUpcoming(){
  const tbody=document.getElementById('upcomingBody');
  const search=state.search.trim().toLowerCase();
  const rows=state.data.upcoming
    .map(x=>({...x,prod:normProd(x.production),group:prodGroup(normProd(x.production))}))
    .filter(x=>x.prod)
    .filter(x=>inActiveTabRange(x.datetime))
    .filter(x=>state.filterProd==='ALL'?true:x.group===state.filterProd)
    .filter(x=>{
      if(!search) return true;
      return [x.teamA,x.teamB,x.arena,x.production,x.competition].some(v=>(v||'').toLowerCase().includes(search));
    });
  tbody.innerHTML='';
  rows.sort((a,b)=>new Date(a.datetime)-new Date(b.datetime)).forEach(x=>{
    const tr=document.createElement('tr');const dt=new Date(x.datetime);
    tr.innerHTML=`
      <td>${fmtDate(dt)}</td>
      <td>${fmtTime(dt)}</td>
      <td>${x.competition||''}</td>
      <td>${x.teamA}</td>
      <td>${x.teamB}</td>
      <td>${x.arena}</td>
      <td>${x.prod}</td>
      <td>${x.youtubeEventId?`<a target="_blank" href="https://www.youtube.com/live/${x.youtubeEventId}">${x.youtubeEventId}</a>`:''}</td>`;
    tbody.appendChild(tr);
  });
}

function renderAll(){renderLive();renderIssues();renderNext90();renderHealth();renderUpcoming()}
function setLastUpdate(){const el=document.getElementById('lastUpdate');const d=new Date();el.textContent=d.toLocaleTimeString('fr-CH',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
async function fetchJSON(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('http');return await r.json()}

async function loadCalendars(){
  const [upcoming]=await Promise.all([fetchJSON('/api/upcoming')]);
  state.data.upcoming=upcoming.items||[];
  renderUpcoming(); setLastUpdate();
}

async function loadYouTube(){
  let payload = await fetchJSON('/api/live');
  if ((!payload.live || payload.live.length===0) && (!payload.upcoming || payload.upcoming.length===0)) {
    const atom = await fetchJSON('/api/live-feed');
    payload = { live: atom.live||[], upcoming: atom.upcoming||[], meta: { source: atom.source||'atom', lastError:'' } };
  }
  state.data.live = payload.live || [];
  state.data.ytUpcoming = payload.upcoming || [];
  state.data.ytMeta = payload.meta || { source:'', quotaBackoffUntil:0, lastError:'' };
  renderLive(); renderNext90(); setLastUpdate();
}

async function loadIssues(){
  const issues = await fetchJSON('/api/issues');
  state.data.issues = issues.items || [];
  renderIssues();
}

document.getElementById('refreshBtn').addEventListener('click',()=>{loadCalendars();loadYouTube();loadIssues()});
document.getElementById('prodFilter').addEventListener('change',e=>{state.filterProd=e.target.value;renderUpcoming()});
document.getElementById('searchInput').addEventListener('input',e=>{state.search=e.target.value;renderUpcoming()});
document.getElementById('tabRange1').addEventListener('click',()=>{state.activeUpcomingTab='RANGE1';document.getElementById('tabRange1').classList.add('active');document.getElementById('tabRange2').classList.remove('active');renderUpcoming()});
document.getElementById('tabRange2').addEventListener('click',()=>{state.activeUpcomingTab='RANGE2';document.getElementById('tabRange2').classList.add('active');document.getElementById('tabRange1').classList.remove('active');renderUpcoming()});

loadCalendars();
loadYouTube();
loadIssues();
setInterval(loadCalendars, 10000);
setInterval(loadYouTube, 60000);
setInterval(loadIssues, 60000);