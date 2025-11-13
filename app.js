// ------------------------------------------------------
// Dashboard SwissBasket Streaming
// ------------------------------------------------------

const I18N = {
  fr: {
    live_now: "Live maintenant sur YouTube",
    open: "Ouvrir",
    private: "Privé",
    upcoming_tag: "UPCOMING",
    no_arena_issue: "Aucun problème signalé.",
    rest: "Time to rest 😴",
    nodata: "No data",
    streamkeys_today: "Streamkeys du jour",
  },
  en: {
    live_now: "Live on YouTube now",
    open: "Open",
    private: "Private",
    upcoming_tag: "UPCOMING",
    no_arena_issue: "No issues reported.",
    rest: "Time to rest 😴",
    nodata: "No data",
    streamkeys_today: "Today's Streamkeys",
  }
};

let LANG = (localStorage.getItem("LANG") || "fr");
function t(k){ return (I18N[LANG] && I18N[LANG][k]) || I18N.fr[k] || k; }

/* ---------------- ÉTAT ---------------- */
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
    streamkeys: [],
  }
};

/* ---------------- OUTILS DATE ---------------- */
const CH_TZ = 'Europe/Zurich';
function parseSheetDate(input){ if(input instanceof Date) return input; if(typeof input==='string'){ const s=input.replace(/Z$/,''); return new Date(s);} return new Date(input); }
function parseUTCDate(input){ return input instanceof Date? input : new Date(input); }
function fmtDateCH(d){ return new Intl.DateTimeFormat(LANG==='fr'?'fr-CH':'en-GB',{timeZone:CH_TZ,weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).format(d); }
function fmtTimeCH(d){ return new Intl.DateTimeFormat(LANG==='fr'?'fr-CH':'en-GB',{timeZone:CH_TZ,hour:'2-digit',minute:'2-digit'}).format(d); }
function fmtDateUTC(d){return fmtDateCH(parseUTCDate(d))} function fmtTimeUTC(d){return fmtTimeCH(parseUTCDate(d))}
function withinNextMinutesUTC(d,min){const t=parseUTCDate(d).getTime();const now=Date.now();return t>=now&&t<=now+min*60000}
function pad2(n){return n<10?`0${n}`:`${n}`} function elapsedHM(start){ if(!start) return ""; const secs=Math.max(0,Math.floor((Date.now()-parseUTCDate(start).getTime())/1000)); const h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60), s=secs%60; return h>0?`${pad2(h)}:${pad2(m)}`:`${pad2(m)}:${pad2(s)}`; }

/* ---------------- RENDER LIVE / UPCOMING ---------------- */
function renderLive(){
  const box=document.getElementById('liveNow'); box.innerHTML='';

  if(state.data.live.length){
    state.data.live.forEach(x=>{
      const isPriv=(x.visibility||"").toLowerCase()==="private";
      const isPreview=(x.lifeCycleStatus||"")==="testing";
      const timer=elapsedHM(x.startedAt);

      const el=document.createElement('div'); el.className='item';
      el.innerHTML=`
        <div style="display:flex;align-items:center;gap:.6rem;min-width:0;">
          <span class="dot-live"></span>
          <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${x.title}</div>
          <span class="muted" style="font-variant-numeric:tabular-nums;">${timer}</span>
          ${isPriv?`<span class="tag" style="background:#555;border-color:#444;">${t('private')}</span>`:""}
        </div>
        <div class="cell-center"><span class="live-pill">LIVE${isPreview?' (preview)':''}</span></div>
        <div></div>
        <a class="tag justify-end" href="${x.url}" target="_blank">${t('open')}</a>
      `;
      box.appendChild(el);
    });
    return;
  }

  const next3=(state.data.ytUpcoming||[])
    .filter(x=>x.scheduledStart?true:false)
    .sort((a,b)=>parseUTCDate(a.scheduledStart)-parseUTCDate(b.scheduledStart))
    .slice(0,3)
    .map(x=>({ title:x.title, when:`${fmtDateUTC(x.scheduledStart)} ${fmtTimeUTC(x.scheduledStart)}`, url:x.url, visibility:x.visibility||'' }));

  next3.forEach(x=>{
    const el=document.createElement('div');
    el.className='item upc';
    el.innerHTML=`
      <div class="upc-left">
        <div class="upc-title">${x.title}</div>
        ${x.visibility.toLowerCase()==='private'?`<span class="tag" style="background:#555;border-color:#444;">${t('private')}</span>`:""}
      </div>
      <div class="upc-center"><span class="tag">${t('upcoming_tag')}</span></div>
      <div class="upc-right">
        <span class="date-soft">${x.when}</span>
        <a class="tag" href="${x.url}" target="_blank">${t('open')}</a>
      </div>
    `;
    box.appendChild(el);
  });
}

/* ---------------- STREAMKEYS ---------------- */
function copyToClipboard(text){
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(()=>{});
  else {
    const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta);
    ta.select(); try{document.execCommand('copy');}catch(e){} document.body.removeChild(ta);
  }
}

function renderStreamKeys(){
  const box=document.getElementById('streamKeys'); if(!box) return;
  box.innerHTML='';

  const items=state.data.streamkeys||[];
  if(!items.length){
    const e=document.createElement('div'); e.className='muted'; e.textContent='—'; box.appendChild(e); return;
  }

  items.forEach(x=>{
    const statusBadge=x.status==='live'
      ? `<span class="live-pill">LIVE</span>`
      : `<span class="tag">${t('upcoming_tag')}</span>`;
    const el=document.createElement('div'); el.className='item';
    el.innerHTML=`
      <div style="min-width:0">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${x.title}</div>
        <div class="muted" style="margin-top:4px;">
          <span class="tag copykey" data-key="${x.streamKey}" title="Cliquer pour copier">
            ${x.streamKey || '—'}
          </span>
        </div>
      </div>
      <div class="cell-center">${statusBadge}</div>
      <div></div>
      <a class="tag justify-end" href="${x.url}" target="_blank">${t('open')}</a>
    `;
    box.appendChild(el);
  });

  box.addEventListener('click',(ev)=>{
    const t=ev.target.closest('.copykey');
    if(!t)return;
    const key=t.getAttribute('data-key');
    if(!key)return;
    copyToClipboard(key);
    const old=t.textContent;
    t.textContent='Copié ✅';
    setTimeout(()=>{t.textContent=old;},1200);
  },{once:true});
}

async function loadStreamKeys(){
  const r=await fetch('/api/stream-keys',{cache:'no-store'}).catch(()=>null);
  const j=r&&r.ok?await r.json():{items:[]};
  state.data.streamkeys=j.items||[];
  renderStreamKeys();
}

/* ---------------- LOAD & REFRESH ---------------- */
async function fetchJSON(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('http');return await r.json()}

async function loadCalendars(){ const u=await fetchJSON('/api/upcoming'); state.data.upcoming=u.items||[]; }
async function loadYouTube(){ const y=await fetchJSON('/api/live'); state.data.live=y.live||[]; state.data.ytUpcoming=y.upcoming||[]; renderLive(); }
async function loadIssues(){ const i=await fetchJSON('/api/issues'); state.data.issues=i.items||[]; }

/* ---------------- INIT ---------------- */
document.getElementById('refreshBtn').addEventListener('click',()=>{
  loadCalendars(); loadYouTube(); loadIssues(); loadStreamKeys();
});

loadCalendars();
loadYouTube();
loadIssues();
loadStreamKeys();

setInterval(loadYouTube,60000);
setInterval(loadStreamKeys,60000);