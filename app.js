const I18N = {
  fr: {
    title: "SwissBasket Streaming",
    app_header: "SwissBasket Streaming",
    refresh: "Rafraîchir",
    live_now: "Live maintenant sur YouTube",
    km_issues: "Arènes en problème Keemotion / Synergy",
    yt_health: "Statut d’ingestion YouTube",
    upcoming_90: "À venir (90 min)",
    upcoming_streams: "Upcoming Streams",
    tab_to_sunday: "Jusqu’au prochain dimanche",
    tab_this_next: "Semaine actuelle + suivante",
    filter_all: "Tous (streamés)",
    filter_swish_manual: "Swish Live + Manual",
    search_ph: "Rechercher équipe, arène, prod, ligue",
    th_date: "Date", th_time: "Heure", th_league:"Ligue",
    th_team_a:"Équipe A", th_team_b:"Équipe B",
    th_arena:"Arène", th_prod:"Production", th_yt_event:"YT Event",
    open: "Ouvrir",
    private: "Privé",
    upcoming_tag: "UPCOMING",
    no_arena_issue: "Aucun problème signalé.",
    rest: "Time to rest 😴",
    nodata: "No data",
    ago_prefix: "il y a",
    copy: "Copier",
    copied: "Copié !",
    copy_error: "Erreur",
    today_streamkeys: "Streamkeys du jour",
    status_live: "En direct",
    status_upcoming: "Prévu",
    no_streamkeys_today: "Aucun événement prévu aujourd'hui."
  },
  en: {
    title: "SwissBasket Streaming",
    app_header: "SwissBasket Streaming",
    refresh: "Refresh",
    live_now: "Live on YouTube now",
    km_issues: "Arenas in issue (Keemotion / Synergy)",
    yt_health: "YouTube ingestion status",
    upcoming_90: "Coming up (90 min)",
    upcoming_streams: "Upcoming Streams",
    tab_to_sunday: "Until next Sunday",
    tab_this_next: "This week + next",
    filter_all: "All (streamed)",
    filter_swish_manual: "Swish Live + Manual",
    search_ph: "Search team, arena, prod, league",
    th_date: "Date", th_time: "Time", th_league:"League",
    th_team_a:"Team A", th_team_b:"Team B",
    th_arena:"Arena", th_prod:"Production", th_yt_event:"YT Event",
    open: "Open",
    private: "Private",
    upcoming_tag: "UPCOMING",
    no_arena_issue: "No issues reported.",
    rest: "Time to rest 😴",
    nodata: "No data",
    ago_prefix: "ago",
    copy: "Copy",
    copied: "Copied!",
    copy_error: "Error",
    today_streamkeys: "Today's streamkeys",
    status_live: "Live",
    status_upcoming: "Upcoming",
    no_streamkeys_today: "No events today."
  }
};

let LANG = (localStorage.getItem("LANG") || "fr");
function t(key){ return (I18N[LANG] && I18N[LANG][key]) || I18N.fr[key] || key; }

function applyI18n(){
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const k = el.getAttribute("data-i18n");
    el.textContent = t(k);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el=>{
    const k = el.getAttribute("data-i18n-ph");
    el.setAttribute("placeholder", t(k));
  });
  document.querySelectorAll(".lang-btn").forEach(b=>{
    b.classList.toggle("active", b.dataset.lang===LANG);
  });
}

window.addEventListener("DOMContentLoaded", ()=>{
  const fr = document.getElementById("langFr");
  const en = document.getElementById("langEn");
  if (fr) fr.addEventListener("click",()=>{ LANG="fr"; localStorage.setItem("LANG","fr"); applyI18n(); renderAll(); });
  if (en) en.addEventListener("click",()=>{ LANG="en"; localStorage.setItem("LANG","en"); applyI18n(); renderAll(); });
  applyI18n();
});

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
    ytMeta: { source: '', quotaBackoffUntil: 0, lastError: '' },
    streamKeys: []
  }
};

const CH_TZ = 'Europe/Zurich';
const LATE_GRACE_MIN = 3;
const dismissedLateKeys = new Set();

function parseSheetDate(input) {
  if (input instanceof Date) return input;
  if (typeof input === 'string') {
    const s = input.replace(/Z$/, '');
    return new Date(s);
  }
  return new Date(input);
}
function parseUTCDate(input) { return input instanceof Date ? input : new Date(input); }
function nowMs() { return Date.now(); }

function fmtDateCH(dateObj) {
  return new Intl.DateTimeFormat(LANG==='fr'?'fr-CH':'en-GB', {
    timeZone: CH_TZ, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(dateObj);
}
function fmtTimeCH(dateObj) {
  return new Intl.DateTimeFormat(LANG==='fr'?'fr-CH':'en-GB', {
    timeZone: CH_TZ, hour: '2-digit', minute: '2-digit'
  }).format(dateObj);
}
function fmtDateSheet(d) { return fmtDateCH(parseSheetDate(d)); }
function fmtTimeSheet(d) { return fmtTimeCH(parseSheetDate(d)); }
function fmtDateUTC(d)   { return fmtDateCH(parseUTCDate(d)); }
function fmtTimeUTC(d)   { return fmtTimeCH(parseUTCDate(d)); }

function withinNextMinutesSheet(d, min) {
  const t = parseSheetDate(d).getTime();
  const now = nowMs();
  return t >= now && t <= now + min * 60000;
}
function isInFutureSheet(d) { return parseSheetDate(d).getTime() >= nowMs(); }
function withinNextMinutesUTC(d, min) {
  const t = parseUTCDate(d).getTime();
  const now = nowMs();
  return t >= now && t <= now + min * 60000;
}
function isInFutureUTC(d) { return parseUTCDate(d).getTime() >= nowMs(); }

function startOfWeekMonday(dt) {
  const d = parseSheetDate(dt ?? new Date());
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (base.getDay() + 6) % 7;
  base.setDate(base.getDate() - day);
  base.setHours(0, 0, 0, 0);
  return base;
}
function endOfWeekSunday(dt) {
  const s = startOfWeekMonday(dt);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}
function endOfComingSunday(){ return endOfWeekSunday(new Date()); }
function endOfNextWeekSunday(dt) {
  const s = startOfWeekMonday(dt);
  const e = new Date(s);
  e.setDate(e.getDate() + 13);
  e.setHours(23, 59, 59, 999);
  return e;
}

function pad2(n){return n<10?`0${n}`:`${n}`}
function elapsedHM(start){
  if(!start) return "";
  const secs=Math.max(0,Math.floor((Date.now()-parseUTCDate(start).getTime())/1000));
  const h=Math.floor(secs/3600);const m=Math.floor((secs%3600)/60);const s=secs%60;
  return h>0?`${pad2(h)}:${pad2(m)}`:`${pad2(m)}:${pad2(s)}`;
}

function normProd(s){
  const v=(s||'').toString().trim().toUpperCase();
  if(!v) return '';
  if(v.includes('KEEMOTION')) return 'Keemotion';
  if(v.includes('SWISH')) return 'Swish Live';
  if(v.includes('MANUAL')) return 'Manual';
  if(v==='TV') return 'TV';
  return '';
}
function prodGroup(p){if(p==='Swish Live'||p==='Manual')return'SwishManual';return p||''}
function badgeForStatus(s){const map={perfect:'status-perfect',good:'status-good',bad:'status-bad',nodata:'status-nodata'};return map[s]||'status-nodata'}
function badgeForIssue(s){const map={sufficient:'tag-ok',insufficient:'tag-warn',offline:'tag-error',unknown:'tag-warn'};return map[s]||'tag-warn'}

function statusLabel(s){
  const map={perfect:{fr:'Parfait',en:'Perfect'},good:{fr:'Bon',en:'Good'},bad:{fr:'Mauvais',en:'Bad'},nodata:{fr:t('nodata'),en:t('nodata')}};
  const k=(s||'').toLowerCase();
  return (map[k] && map[k][LANG]) || t('nodata');
}
function timeSince(date){
  const s=Math.floor((Date.now()-parseUTCDate(date))/1000);
  if(s<60)return `${s}s`;
  const m=Math.floor(s/60);if(m<60)return `${m} min`;
  const h=Math.floor(m/60);return `${h} h ${m%60} min`;
}

function inActiveTabRange(d){
  const t=parseSheetDate(d).getTime();
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

/* --------- LATE EVENTS DETECTION --------- */
function lateKey(ev){
  return ev.url || ev.id || (ev.title + '|' + (ev.scheduledStart || ''));
}

function getLateEventsRaw(){
  const now = nowMs();
  return (state.data.ytUpcoming || []).filter(ev=>{
    if(!ev || !ev.scheduledStart) return false;
    const vis = (ev.visibility || '').toLowerCase();
    if(vis && vis !== 'public') return false;
    const t = parseUTCDate(ev.scheduledStart).getTime();
    return t + LATE_GRACE_MIN*60000 < now;
  });
}

function getLateEventsForHighlight(){
  return getLateEventsRaw();
}

function getLateEventsForAlerts(){
  return getLateEventsRaw().filter(ev => !dismissedLateKeys.has(lateKey(ev)));
}

/* --------- RENDER LATE ALERT POPUPS --------- */
function dismissLateAlert(key){
  dismissedLateKeys.add(key);
  renderLateAlerts();
}

function renderLateAlerts(){
  const container = document.getElementById('alertsContainer');
  if(!container) return;
  const late = getLateEventsForAlerts();
  container.innerHTML = '';
  late.forEach(ev=>{
    const key = lateKey(ev);
    const keyJs = key.replace(/'/g,"\\'");
    const whenTxt = ev.scheduledStart ? `${fmtDateUTC(ev.scheduledStart)} ${fmtTimeUTC(ev.scheduledStart)}` : '';
    const div = document.createElement('div');
    div.className='alert';
    div.innerHTML = `
      <div class="alert-icon">⚠️</div>
      <div class="alert-body">
        <div class="alert-title">${ev.title}</div>
        <div class="alert-meta">${t('status_upcoming')} • ${whenTxt}</div>
      </div>
      <button class="alert-close" onclick="dismissLateAlert('${keyJs}')">×</button>
    `;
    container.appendChild(div);
  });
}

/* --------- RENDER LATE CARD IN LIVE BOX --------- */
function renderLateCard(ev, box){
  const when = ev.scheduledStart ? `${fmtDateUTC(ev.scheduledStart)} ${fmtTimeUTC(ev.scheduledStart)}` : '';
  const el = document.createElement('div');
  el.className = 'item item-late';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;min-width:0;">
      <span class="dot-live"></span>
      <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ev.title}</div>
    </div>
    <div class="cell-center">
      <span class="tag">${t('status_upcoming')}</span>
    </div>
    <div class="date-soft" style="white-space:nowrap;">${when}</div>
    <a class="tag" href="${ev.url}" target="_blank" style="justify-self:end;">${t('open')}</a>
  `;
  box.appendChild(el);
}

/* ---------------- RENDERERS ---------------- */
function renderLive(){
  const box=document.getElementById('liveNow');
  box.innerHTML='';
  const late = getLateEventsForHighlight();

  if(state.data.live.length){
    state.data.live.forEach(x=>{
      const isPriv = (x.visibility||"").toLowerCase()==="private";
      const isPreview = (x.lifeCycleStatus||"") === "testing";
      const timer = elapsedHM(x.startedAt);

      const el=document.createElement('div');el.className='item';
      el.innerHTML=`
        <div style="display:flex;align-items:center;gap:.6rem;min-width:0;">
          <span class="dot-live"></span>
          <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${x.title}</div>
          <span class="muted" style="font-variant-numeric:tabular-nums;">${timer}</span>
          ${isPriv?`<span class="tag" style="background:#555;border-color:#444;">${t('private')}</span>`:""}
        </div>
        <div class="cell-center">
          <span class="live-pill">${t('status_live')}${isPreview?' (preview)':''}</span>
        </div>
        <div></div>
        <a class="tag" href="${x.url}" target="_blank" style="justify-self:end;">${t('open')}</a>
      `;
      box.appendChild(el);
    });

    if(late.length){
      late.forEach(ev => renderLateCard(ev, box));
    }
    return;
  }

  if(late.length){
    late.forEach(ev => renderLateCard(ev, box));
    return;
  }

  let next3=(state.data.ytUpcoming||[])
    .filter(x=>x.scheduledStart?isInFutureUTC(x.scheduledStart):true)
    .sort((a,b)=>parseUTCDate(a.scheduledStart)-parseUTCDate(b.scheduledStart))
    .slice(0,3)
    .map(x=>({
      title:x.title,
      when:`${fmtDateUTC(x.scheduledStart)} ${fmtTimeUTC(x.scheduledStart)}`,
      url:x.url,
      visibility:x.visibility||''
    }));

  if(next3.length===0){return}

  next3.forEach(x=>{
    const el=document.createElement('div');
    el.className='item upcoming-item';
    el.innerHTML=`
      <div style="display:flex;align-items:center;gap:.6rem;min-width:0;">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${x.title}</div>
        ${x.visibility && x.visibility.toLowerCase()==='private' ? `<span class="tag" style="background:#555;border-color:#444;">${t('private')}</span>` : ``}
      </div>
      <div class="cell-center">
        <span class="tag">${t('upcoming_tag')}</span>
      </div>
      <div class="date-soft" style="white-space:nowrap;">${x.when}</div>
      <a class="tag" href="${x.url}" target="_blank" style="justify-self:end;">${t('open')}</a>
    `;
    box.appendChild(el);
  });
}

function renderIssues(){
  const box=document.getElementById('issues');box.innerHTML='';
  if(!state.data.issues.length){
    const e=document.createElement('div');e.className='muted';e.textContent=t('no_arena_issue');box.appendChild(e);return;
  }
  state.data.issues.forEach(x=>{
    const el=document.createElement('div');el.className='item';
    const cls=badgeForIssue(x.statusCode||x.status||'unknown');
    el.innerHTML=`<div>${x.arena}</div><div>${x.vendor}</div><div>${x.note||''}</div><span class="tag ${cls}">${x.status||x.statusCode||''}</span>`;
    box.appendChild(el);
  });
}

function renderNext90(){
  const box=document.getElementById('next90');box.innerHTML='';
  const soonYT=(state.data.ytUpcoming||[]).filter(x=>x.scheduledStart&&withinNextMinutesUTC(x.scheduledStart,90));
  let soon = soonYT.sort((a,b)=>parseUTCDate(a.scheduledStart)-parseUTCDate(b.scheduledStart))
                   .map(x=>{
                     const isPriv=(x.visibility||"").toLowerCase()==="private";
                     return { title:x.title + (isPriv?` (${t('private')})`:''), time:fmtTimeUTC(x.scheduledStart), url:x.url };
                   });
  if(!soon.length){
    const sheetSoon=state.data.upcoming
      .map(x=>({...x,prod:normProd(x.production)}))
      .filter(x=>x.prod && withinNextMinutesSheet(x.datetime,90))
      .sort((a,b)=>parseSheetDate(a.datetime)-parseSheetDate(b.datetime))
      .map(x=>({ title:`${x.teamA} vs ${x.teamB}`, time:fmtTimeSheet(x.datetime), url:'' }));
    soon = sheetSoon;
  }
  if(!soon.length){const e=document.createElement('div');e.className='muted';e.textContent=t('rest');box.appendChild(e);return}
  soon.forEach(x=>{
    const el=document.createElement('div');el.className='item';
    el.innerHTML=`
      <div style="font-weight:600;">${x.title}</div>
      <div></div>
      <div>${x.time}</div>
      ${x.url?`<a class="tag" href="${x.url}" target="_blank" style="justify-self:end;">${t('open')}</a>`:''}`;
    box.appendChild(el);
  });
}

function renderHealth(){
  const box=document.getElementById('ytHealth');box.innerHTML='';
  if(!state.data.live.length){return}
  if(!state.data.health.length){
    const e=document.createElement('div'); e.className='muted'; e.textContent='—'; box.appendChild(e); return;
  }
  state.data.health.forEach(x=>{
    const since = x.lastUpdate ? timeSince(x.lastUpdate) : null;
    const el=document.createElement('div');
    el.className='item';
    el.innerHTML=`
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;width:100%;">
        <div style="flex:1;min-width:140px;">${x.name}</div>
        <div class="badge ${badgeForStatus(x.status)}">${statusLabel(x.status)}</div>
        <div class="muted" style="flex:1;min-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${x.streamKey||''}</div>
        <div class="muted" style="white-space:nowrap;">${x.lastUpdate?fmtTimeUTC(x.lastUpdate):''}</div>
        <div class="muted" style="font-size:.8em;opacity:.7;">${since?`🕒 ${t('ago_prefix')} ${since}`:'—'}</div>
      </div>`;
    box.appendChild(el);
  });
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
  rows.sort((a,b)=>parseSheetDate(a.datetime)-parseSheetDate(b.datetime)).forEach(x=>{
    const dt=parseSheetDate(x.datetime);
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${fmtDateCH(dt)}</td>
      <td>${fmtTimeCH(dt)}</td>
      <td>${x.competition||''}</td>
      <td>${x.teamA}</td>
      <td>${x.teamB}</td>
      <td>${x.arena}</td>
      <td>${x.prod}</td>
      <td>${x.youtubeEventId?`<a target="_blank" href="https://www.youtube.com/live/${x.youtubeEventId}">${x.youtubeEventId}</a>`:''}</td>`;
    tbody.appendChild(tr);
  });
}

/* --------- COPY STREAMKEY --------- */
function copyStreamKey(key, btn){
  if(!key) return;
  const doFallback = () => {
    const ta = document.createElement('textarea');
    ta.value = key;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try{ document.execCommand('copy'); }catch(e){}
    document.body.removeChild(ta);
  };

  const setLabel = (textKey)=>{
    if(!btn) return;
    const orig = btn.getAttribute('data-orig-label') || btn.textContent;
    if(!btn.getAttribute('data-orig-label')) btn.setAttribute('data-orig-label', orig);
    btn.textContent = t(textKey);
    setTimeout(()=>{ btn.textContent = btn.getAttribute('data-orig-label') || orig; }, 1200);
  };

  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(key)
      .then(()=> setLabel('copied'))
      .catch(()=> { doFallback(); setLabel('copy_error'); });
  } else {
    doFallback();
    setLabel('copied');
  }
}

/* --------- STREAMKEYS DU JOUR --------- */
function renderStreamKeys(){
  const box = document.getElementById('streamKeys');
  if(!box) return;
  box.innerHTML = '';
  const items = state.data.streamKeys || [];
  if(!items.length){
    const e = document.createElement('div');
    e.className = 'muted';
    e.textContent = t('no_streamkeys_today');
    box.appendChild(e);
    return;
  }
  items.forEach(it=>{
    const badge = it.status === 'live'
      ? `<span class="live-pill">${t('status_live')}</span>`
      : `<span class="tag">${t('status_upcoming')}</span>`;
    const whenTxt = it.when ? `${fmtDateUTC(it.when)} ${fmtTimeUTC(it.when)}` : '';
    const safeKey = (it.streamKey || '').replace(/'/g,"\\'");
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0;">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${it.title}</div>
        <div class="muted" style="font-size:.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${it.streamKey}</div>
      </div>
      <div class="cell-center">${badge}</div>
      <div class="date-soft" style="white-space:nowrap;">${whenTxt}</div>
      <div style="display:flex;gap:.4rem;justify-content:flex-end;">
        <button type="button" class="tag" onclick="copyStreamKey('${safeKey}', this)">${it.streamLabel || t('copy')}</button>
        <a class="tag" href="${it.url}" target="_blank">${t('open')}</a>
      </div>
    `;
    box.appendChild(el);
  });
}

function renderAll(){
  renderLive();
  renderIssues();
  renderNext90();
  renderHealth();
  renderUpcoming();
  renderStreamKeys();
  renderLateAlerts();
}

function setLastUpdate(){
  const el=document.getElementById('lastUpdate');
  const d=new Date();
  el.textContent=new Intl.DateTimeFormat(LANG==='fr'?'fr-CH':'en-GB',{timeZone:CH_TZ,hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(d);
}

/* ---------------- DATA LOADING ---------------- */
async function fetchJSON(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('http');return await r.json()}

async function loadCalendars(){
  const upcoming=await fetchJSON('/api/upcoming');
  state.data.upcoming=upcoming.items||[];
  renderUpcoming(); setLastUpdate();
}

async function loadYouTube(){
  let payload = await fetchJSON('/api/live').catch(()=>({live:[], upcoming:[], meta:{source:'err', lastError:'fetch /api/live'}}));
  if ((!payload.live || payload.live.length===0) && (!payload.upcoming || payload.upcoming.length===0)) {
    const atom = await fetchJSON('/api/live-feed').catch(()=>({live:[],upcoming:[],source:'atom-err'}));
    payload = { live: atom.live||[], upcoming: atom.upcoming||[], meta: { source: atom.source||'atom', lastError:'' } };
  }
  state.data.live = payload.live || [];
  state.data.ytUpcoming = payload.upcoming || [];
  state.data.ytMeta = payload.meta || { source:'', quotaBackoffUntil:0, lastError:'' };

  renderLive();
  renderNext90();
  renderLateAlerts();
  setLastUpdate();
  if (state.data.live && state.data.live.length) await loadHealth();
}

async function loadHealth(){
  const h = await fetchJSON('/api/health').catch(()=>({items:[]}));
  state.data.health = h.items || [];
  renderHealth();
}

async function loadIssues(){
  const issues = await fetchJSON('/api/issues').catch(()=>({items:[]}));
  state.data.issues = issues.items || [];
  renderIssues();
}

async function loadStreamKeys(){
  const sk = await fetchJSON('/api/stream-keys').catch(()=>({items:[]}));
  state.data.streamKeys = sk.items || [];
  renderStreamKeys();
}

/* ---------------- UI ---------------- */
document.getElementById('refreshBtn').addEventListener('click',()=>{loadCalendars();loadYouTube();loadIssues();loadHealth();loadStreamKeys();});
document.getElementById('prodFilter').addEventListener('change',e=>{state.filterProd=e.target.value;renderUpcoming()});
document.getElementById('searchInput').addEventListener('input',e=>{state.search=e.target.value;renderUpcoming()});
document.getElementById('tabRange1').addEventListener('click',()=>{state.activeUpcomingTab='RANGE1';document.getElementById('tabRange1').classList.add('active');document.getElementById('tabRange2').classList.remove('active');renderUpcoming()});
document.getElementById('tabRange2').addEventListener('click',()=>{state.activeUpcomingTab='RANGE2';document.getElementById('tabRange2').classList.add('active');document.getElementById('tabRange1').classList.remove('active');renderUpcoming()});

/* ---------------- Kickoff ---------------- */
loadCalendars();
loadYouTube();
loadIssues();
loadHealth();
loadStreamKeys();
setInterval(loadCalendars, 10000);
setInterval(loadYouTube, 60000);
setInterval(loadIssues, 60000);
setInterval(loadHealth, 30000);
setInterval(loadStreamKeys, 60000);
setInterval(()=>{ if (state.data.live && state.data.live.length){ renderLive(); } }, 1000);
