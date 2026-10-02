/* Real iceberg positions: NASA/BYU Scatterometer Climate Record Pathfinder (near-real-time ASCAT + OSCAT-2). No fabricated tracks. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const page = 'https://www.scp.byu.edu/current_icebergs.html';
  const routes = [['same-origin /api/icebergs', '/api/icebergs'], ['BYU SCP (direct)', page], ['allorigins relay', 'https://api.allorigins.win/raw?url=' + encodeURIComponent(page)]];
  const dms = t => { const m = /(\d+)\s+(\d+)'\s*([EWNS])/.exec(t || ''); if (!m) return NaN; const v = +m[1] + (+m[2]) / 60; return /[WS]/.test(m[3]) ? -v : v; };
  function parse(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html'), list = [];
    doc.querySelectorAll('tr').forEach(tr => {
      const td = [...tr.querySelectorAll('td')].map(x => x.textContent.trim()); if (td.length < 4) return;
      const lon = dms(td[1]), lat = dms(td[2]), doy = +td[3];
      if (/^[a-z]{1,2}\d+/i.test(td[0]) && Number.isFinite(lon) && Number.isFinite(lat) && doy >= 1 && doy <= 366) list.push({ name: td[0].toUpperCase(), lon, lat, doy });
    });
    const rev = /Last revised:\s*\d+:\d+:\d+\s+(\d+)\/(\d+)\/(\d+)/.exec(doc.body.textContent || '');
    const year = rev ? 2000 + +rev[3] : new Date().getUTCFullYear(), revDate = rev ? new Date(Date.UTC(year, +rev[1] - 1, +rev[2])) : null;
    const revDoy = revDate ? Math.floor((revDate - Date.UTC(year, 0, 1)) / 864e5) + 1 : 366;
    list.forEach(b => { b.date = new Date(Date.UTC(b.doy > revDoy + 7 ? year - 1 : year, 0, b.doy)); });
    return { list, revDate };
  }
  const km = (a, b) => { const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r, h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  const pos = b => `${Math.abs(b.lat).toFixed(2)}°${b.lat < 0 ? 'S' : 'N'} ${Math.abs(b.lon).toFixed(2)}°${b.lon < 0 ? 'W' : 'E'}`;
  function rows(el, items) { el.replaceChildren(...items.map(([l, v]) => { const d = document.createElement('div'), s = document.createElement('span'), b = document.createElement('b'); s.textContent = l; b.textContent = v; d.append(s, b); return d; })); }
  function setStatus(id, kind, text) { const e = $(id); if (e) { e.className = `data-status ${kind}`; e.textContent = text; } }
  async function load() {
    setStatus('bergStatus', 'loading', 'Loading BYU/NASA SCP iceberg positions…');
    let res, errors = [];
    for (const [label, url] of routes) {
      try { const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const p = parse(await r.text()); if (p.list.length < 5) throw new Error('no iceberg table found'); res = { ...p, label }; break; }
      catch (e) { errors.push(`${label}: ${e.message}`); }
    }
    if (!res) { setStatus('bergStatus', 'error', 'Iceberg feed unavailable'); setStatus('proxStatus', 'error', 'Waiting for iceberg feed'); $('bergNote').textContent = `No iceberg markers or trajectories are drawn because the feed could not be loaded. ${errors.join(' | ')}`; return; }
    const { list, revDate, label } = res; window.IGBergsPending = list;
    const inMap = window.IGBergs ? window.IGBergs(list) : null;
    const age = revDate ? (Date.now() - revDate) / 864e5 : null;
    setStatus('bergStatus', age != null && age > 14 ? 'stale' : 'live', age != null && age > 14 ? 'Loaded; list is older than 14 days' : 'BYU / NASA SCP list loaded');
    $('bergNote').textContent = `${list.length} large icebergs tracked from ASCAT + OSCAT-2 scatterometer data${inMap != null ? ` · ${inMap} inside the 3D map area (white markers)` : ''}. List revised ${revDate ? revDate.toISOString().slice(0, 10) : 'date unavailable'} · route: ${label}. Positions are satellite estimates, not hazard guarantees; the US National Ice Center is authoritative.`;
    const west = list.filter(b => b.lon < -30 && b.lon > -80 && b.lat > -72).sort((a, b) => b.lon - a.lon);
    rows($('bergList'), (west.length ? west : list).slice(0, 8).map(b => [b.name, `${pos(b)} · obs ${b.date.toISOString().slice(5, 10)}`]));
    const sites = window.IGSites || [];
    setStatus('proxStatus', age != null && age > 14 ? 'stale' : 'live', 'Computed from real positions');
    rows($('proxList'), sites.map(s => { let best = null; list.forEach(b => { const d = km(s, b); if (!best || d < best.d) best = { b, d }; }); return [s.name, `${best.b.name} · ${Math.round(best.d).toLocaleString()} km`]; }));
  }
  load().catch(e => { setStatus('bergStatus', 'error', 'Iceberg feed unavailable'); $('bergNote').textContent = e.message; });
})();
