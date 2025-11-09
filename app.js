const state = {
  filterProd: 'ALL',
  search: '',
  activeUpcomingTab: 'RANGE1',
  data: { live: [], issues: [], upcoming: [], health: [] }
};

function fmtDate(d){const x=new Date(d);return x.toLocaleDateString('fr-CH',{weekday:'short',year:'numeric',month:'2-digit',day:'2-digit'})}
function fmtTime(d){const x=new Date(d);return x.toLocaleTimeString('fr-CH',{hour:'2-digit',minute:'2-digit'})}
function withinNextMinutes(d,min){const now=Date.now();const t=new Date(d).getTime();return t>=now&&t<=now+min*60000}
function isInFuture(d){return new Date(d).getTime()>=Date.now()}
function timeSince(date){const s=Math.floor((Date.now()-new Date(date))/1000);if(s<60)return`${s}s`;const m=Math.floor(s/60);if(m<60)return`${m} min`;const h=Math.floor(m/60);return`${h} h ${m%60} min`}

function startOfWeekMonday(dt){const d=new Date(dt);const day=(d.getDay()+6)%7;d.setHours(0,0,0,0);d.setDate(d.getDate()-day);return d}
function endOfWeekSunday(dt){const d=startOfWeekMonday(dt);d.setDate(d.getDate()+6);d.setHours(23,59,59,999);return d}
function endOfNextWeekSunday(dt){const d=startOfWeekMonday(dt);d.setDate(d.getDate()+13);d.setHours(23,59,59,999);return d}
function endOfComingSunday(dt){const d=new Date(dt);const day=d.getDay();const add=((7-day)%7)||7;const end=new Date(d);end.setDate(d.getDate()+add);end.setHours(23,59,59,999);return end}

function normProd(s){const v=(s||'').toUpperCase();if(!v)return'';if(v.includes('KEEMOTION'))return'Keemotion';if(v.includes('SWISH'))return'Swish Live';if(v.includes('MANUAL'))return'Manual';if(v==='TV')return'TV';return''}
function prodGroup(p){if(p==='Swish Live'||p==='Manual')return'SwishManual';return p||''}
function badgeForStatus(s){const map={perfect:'status-perfect',good:'status-good',bad:'status-bad',nodata:'status-nodata'};return map[s]||'status-nodata'}

function renderLive(){
  const box=document.getElementById('liveNow');box.innerHTML='';
}

function renderIssues(){
  const box=document.getElementById('issues');box.innerHTML='';
  if(!state.data.issues.length){const e=document.createElement('div');e.className='muted';e.textContent='Aucun problème signalé.';box.appendChild(e);return}
  state.data.issues.forEach(x=>{
    const el=document.createElement('div');el.className='item';
    el.innerHTML=`<div>${x.arena}</div><div>${x.vendor}</div><div>${x.note||''}</div><div class="tag">${x.status}</div>`;
    box.appendChild(el);
  });
}

function renderNext90(){
  const box=document.getElementById('next90');box.innerHTML='';
  const e=document.createElement('div');e.className='muted';e.textContent='Time to rest 😴';box.appendChild(e);
}

function renderHealth(){
  const box=document.getElementById('ytHealth');box.innerHTML='';
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
      <td class="nowrap">${fmtDate(dt)}</td>
      <td class="nowrap">${fmtTime(dt)}</td>
      <td class="nowrap">${x.competition||''}</td>
      <td>${x.teamA}</td>
      <td>${x.teamB}</td>
      <td>${x.arena}</td>
      <td class="nowrap">${normProd(x.production)}</td>
      <td class="nowrap">${x.youtubeEventId?`<a target="_blank" href="https://www.youtube.com/live/${x.youtubeEventId}">${x.youtubeEventId}</a>`:''}</td>`;
    tbody.appendChild(tr);
  });
}

function renderAll(){renderLive();renderIssues();renderNext90();renderHealth();renderUpcoming()}
function setLastUpdate(){const el=document.getElementById('lastUpdate');const d=new Date();el.textContent=d.toLocaleTimeString('fr-CH',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
async function fetchJSON(url){const r=await fetch(url);if(!r.ok)throw new Error('http');return await r.json()}
async function loadData(){
  const [upcoming]=await Promise.all([fetchJSON('/api/upcoming')]);
  state.data.upcoming=upcoming.items||[];
  renderAll();setLastUpdate();
}

document.getElementById('refreshBtn').addEventListener('click',()=>{loadData()});
document.getElementById('prodFilter').addEventListener('change',e=>{state.filterProd=e.target.value;renderUpcoming()});
document.getElementById('searchInput').addEventListener('input',e=>{state.search=e.target.value;renderUpcoming()});
document.getElementById('tabRange1').addEventListener('click',()=>{state.activeUpcomingTab='RANGE1';document.getElementById('tabRange1').classList.add('active');document.getElementById('tabRange2').classList.remove('active');renderUpcoming()});
document.getElementById('tabRange2').addEventListener('click',()=>{state.activeUpcomingTab='RANGE2';document.getElementById('tabRange2').classList.add('active');document.getElementById('tabRange1').classList.remove('active');renderUpcoming()});

loadData();setInterval(loadData,10000);