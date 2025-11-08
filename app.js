const state = {
  filters: new Set(['Keemotion','Swish Live','Manual','TV']),
  search: '',
  data: { live: [], issues: [], upcoming: [], health: [] }
}
function fmtDate(d) { const x = new Date(d); return x.toLocaleDateString('fr-CH', { weekday:'short', year:'numeric', month:'2-digit', day:'2-digit' }) }
function fmtTime(d) { const x = new Date(d); return x.toLocaleTimeString('fr-CH', { hour:'2-digit', minute:'2-digit' }) }
function withinNextMinutes(d, min) { const now = Date.now(); const t = new Date(d).getTime(); return t >= now && t <= now + min*60000 }
function badgeForStatus(s) { const map = { perfect:'status-perfect', good:'status-good', bad:'status-bad', nodata:'status-nodata' }; return map[s] || 'status-nodata' }
function renderLive() {
  const box = document.getElementById('liveNow'); box.innerHTML = ''
  if (!state.data.live.length) { const e = document.createElement('div'); e.className='muted'; e.textContent='Aucun live en cours.'; box.appendChild(e); return }
  state.data.live.forEach(x => {
    const el = document.createElement('div'); el.className = 'item'
    el.innerHTML = `<div>${x.title}</div><div>${x.arena || ''}</div><div>${fmtTime(x.startedAt || Date.now())}</div><a class="tag" href="${x.url}" target="_blank">Ouvrir</a>`
    box.appendChild(el)
  })
}
function renderIssues() {
  const box = document.getElementById('issues'); box.innerHTML = ''
  if (!state.data.issues.length) { const e = document.createElement('div'); e.className='muted'; e.textContent='Aucun problème signalé.'; box.appendChild(e); return }
  state.data.issues.forEach(x => {
    const el = document.createElement('div'); el.className = 'item'
    el.innerHTML = `<div>${x.arena}</div><div>${x.vendor}</div><div>${x.note || ''}</div><div class="tag">${x.status}</div>`
    box.appendChild(el)
  })
}
function renderNext90() {
  const box = document.getElementById('next90'); box.innerHTML = ''
  const soon = state.data.upcoming.filter(x => withinNextMinutes(x.datetime, 90))
  if (!soon.length) { const e = document.createElement('div'); e.className='muted'; e.textContent='Aucun match dans les 90 minutes.'; box.appendChild(e); return }
  soon.sort((a,b)=>new Date(a.datetime)-new Date(b.datetime)).forEach(x => {
    const el = document.createElement('div'); el.className = 'item'
    el.innerHTML = `<div>${fmtDate(x.datetime)} ${fmtTime(x.datetime)}</div><div>${x.teamA} vs ${x.teamB}</div><div>${x.arena}</div><div class="tag">${x.method}</div>`
    box.appendChild(el)
  })
}
function renderHealth() {
  const box = document.getElementById('ytHealth'); box.innerHTML = ''
  if (!state.data.health.length) { const e = document.createElement('div'); e.className='muted'; e.textContent='Aucun flux détecté.'; box.appendChild(e); return }
  state.data.health.forEach(x => {
    const el = document.createElement('div'); el.className = 'health'
    el.innerHTML = `<div>${x.name}</div><div class="badge ${badgeForStatus(x.status)}">${x.statusLabel}</div><div class="muted">${x.streamKey || ''}</div><div class="muted">${x.lastUpdate ? fmtTime(x.lastUpdate) : ''}</div>`
    box.appendChild(el)
  })
}
function renderUpcoming() {
  const tbody = document.getElementById('upcomingBody')
  const search = state.search.trim().toLowerCase()
  const rows = state.data.upcoming.filter(x => state.filters.has(x.method)).filter(x => {
    if (!search) return true
    return [x.teamA,x.teamB,x.arena,x.production,x.competition].some(v => (v||'').toLowerCase().includes(search))
  })
  tbody.innerHTML = ''
  rows.sort((a,b)=>new Date(a.datetime)-new Date(b.datetime)).forEach(x => {
    const tr = document.createElement('tr'); const dt = new Date(x.datetime)
    tr.innerHTML = `<td>${fmtDate(dt)}</td><td>${fmtTime(dt)}</td><td>${x.teamA}</td><td>${x.teamB}</td><td>${x.arena}</td><td>${x.method}</td><td>${x.production}</td><td>${x.youtubeEventId ? `<a target="_blank" href="https://www.youtube.com/live/${x.youtubeEventId}">${x.youtubeEventId}</a>` : ''}</td>`
    tbody.appendChild(tr)
  })
}
function renderAll() { renderLive(); renderIssues(); renderNext90(); renderHealth(); renderUpcoming() }
function setLastUpdate() { const el = document.getElementById('lastUpdate'); const d = new Date(); el.textContent = d.toLocaleTimeString('fr-CH', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) }
async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error('http'); return await r.json() }
async function loadData() {
  const [live, issues, upcoming, health] = await Promise.all([fetchJSON('/api/live'), fetchJSON('/api/issues'), fetchJSON('/api/upcoming'), fetchJSON('/api/health')])
  state.data.live = live.items || []; state.data.issues = issues.items || []; state.data.upcoming = upcoming.items || []; state.data.health = health.items || []
  renderAll(); setLastUpdate()
}
function onFilterChange() { const boxes = Array.from(document.querySelectorAll('.flt')); state.filters = new Set(boxes.filter(b=>b.checked).map(b=>b.value)); renderUpcoming() }
document.getElementById('refreshBtn').addEventListener('click', () => { loadData() })
document.querySelectorAll('.flt').forEach(el => el.addEventListener('change', onFilterChange))
document.getElementById('searchInput').addEventListener('input', e => { state.search = e.target.value; renderUpcoming() })
loadData(); setInterval(loadData, 10000)
