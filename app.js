// ------------------------------------------------------
// Dashboard SwissBasket — gestion stricte des heures CH
// ------------------------------------------------------

const state = {
  filterProd: 'ALL',
  search: '',
  activeUpcomingTab: 'RANGE1',
  data: {
    live: [],
    ytUpcoming: [],
    issues: [],
    upcoming: [],
    health: [],
    ytMeta: { source: '', quotaBackoffUntil: 0, lastError: '' }
  }
};

const CH_TZ = 'Europe/Zurich';
function parseUTCDate(input) { return input instanceof Date ? input : new Date(input); }
function fmtDateCH(dateObj) {
  return new Intl.DateTimeFormat('fr-CH',{timeZone:CH_TZ,weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).format(dateObj);
}
function fmtTimeCH(dateObj) {
  return new Intl.DateTimeFormat('fr-CH',{timeZone:CH_TZ,hour:'2-digit',minute:'2-digit'}).format(dateObj);
}
function fmtDateUTC(d){return fmtDateCH(parseUTCDate(d));}
function fmtTimeUTC(d){return fmtTimeCH(parseUTCDate(d));}
function nowMs(){return Date.now();}
function pad2(n){return n<10?`0${n}`:`${n}`;}
function elapsedHM(start){
  if(!start)return"";
  const secs=Math.max(0,Math.floor((Date.now()-parseUTCDate(start).getTime())/1000));
  const h=Math.floor(secs/3600);const m=Math.floor((secs%3600)/60);
  return h>0?`${pad2(h)}:${pad2(m)}`:`${pad2(m)}:${pad2(secs%60)}`;
}

// ------------------ RENDER LIVE ------------------
function renderLive(){
  const box=document.getElementById('liveNow'); box.innerHTML='';

  if(state.data.live.length){
    state.data.live.forEach(x=>{
      const isPriv=(x.visibility||"").toLowerCase()==="private";
      const isPreview=(x.lifeCycleStatus||"")==="testing";
      const timer=elapsedHM(x.startedAt);

      const el=document.createElement('div');
      el.className='item';
      el.innerHTML=`
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:.6rem;flex:1;min-width:0;">
            <span style="width:.55rem;height:.55rem;background:#e11900;border-radius:9999px;display:inline-block;"></span>
            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${x.title}</div>
            <span class="muted" style="font-variant-numeric:tabular-nums;">${timer}</span>
            ${isPriv?`<span class="tag" style="background:#555;border-color:#444;">Privé</span>`:""}
          </div>
          <div style="display:flex;align-items:center;gap:.6rem;flex-shrink:0;">
            <span style="font-weight:800;letter-spacing:.08em;border:2px solid #e11900;color:#e11900;border-radius:9999px;padding:.15rem .5rem;white-space:nowrap;">LIVE${isPreview?' (preview)':''}</span>
            <a class="tag" href="${x.url}" target="_blank">Ouvrir</a>
          </div>
        </div>`;
      box.appendChild(el);
    });
    return;
  }

  const next3=(state.data.ytUpcoming||[])
    .filter(x=>x.scheduledStart)
    .sort((a,b)=>parseUTCDate(a.scheduledStart)-parseUTCDate(b.scheduledStart))
    .slice(0,3);

  if(next3.length===0){
    const e=document.createElement('div'); e.className='muted'; e.textContent='Aucun live planifié sur YouTube.'; box.appendChild(e); return;
  }

  next3.forEach(x=>{
    const isPriv=(x.visibility||"").toLowerCase()==="private";
    const el=document.createElement('div');
    el.className='item'; el.style.opacity='.45';
    el.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:.6rem;flex:1;min-width:0;">
          <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${x.title}</div>
          ${isPriv?`<span class="tag" style="background:#555;border-color:#444;">Privé</span>`:""}
        </div>
        <div style="display:flex;align-items:center;gap:.6rem;flex-shrink:0;">
          <span class="muted">${fmtDateUTC(x.scheduledStart)} ${fmtTimeUTC(x.scheduledStart)}</span>
          <a class="tag" href="${x.url}" target="_blank">Ouvrir</a>
        </div>
      </div>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
        <span style="font-weight:700;letter-spacing:.1em;border:1px solid currentColor;border-radius:9999px;padding:.2rem .6rem;opacity:.9;">UPCOMING</span>
      </div>`;
    box.appendChild(el);
  });
}

// --- timers refresh
setInterval(()=>{
  if(state.data.live&&state.data.live.length)renderLive();
},1000);

// --- init ---
async function fetchJSON(u){const r=await fetch(u);return r.json();}
async function loadYouTube(){
  const data=await fetchJSON('/api/live'); state.data.live=data.live||[];
  const ytUp=await fetchJSON('/api/yt-upcoming'); state.data.ytUpcoming=ytUp.items||[];
  renderLive();
}
loadYouTube();
setInterval(loadYouTube,60000);
