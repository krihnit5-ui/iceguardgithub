(function () {
  'use strict';
  const $ = id => document.getElementById(id), A = () => window.IceGuardAI;
  const ERDDAP = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/nsidcG10016v3sh1day';
  const sitesWithData = () => (window.IGSites || []).filter(s => s.data);
  const row = (l, v) => { const d = document.createElement('div'), s = document.createElement('span'), b = document.createElement('b'); s.textContent = l; b.textContent = v; d.append(s, b); return d; };
  function weatherFor(p) { let best = null; for (const s of sitesWithData()) { const d = A().haversine(p, s); if (!best || d < best.d) best = { s, d }; } return best ? { ...best.s.data, siteName: best.s.name, siteKm: best.d } : null; }
  function modelled(berg, w) { return window.IGTrajectoryModel ? A().predict(berg, w, 24, { model: window.IGTrajectoryModel }) : A().predictPhysical(berg, w, w.current, 24); }

  // Real NOAA/NSIDC CDR sea-ice concentration for the whole Peninsula window in ONE request (25 km cells).
  let ice = null, iceErr = null;
  async function loadIce() {
    try {
      const pts = []; for (let la = -56; la >= -74; la -= 2) for (let lo = -85; lo <= -30; lo += 5) pts.push(A().toPolarStereo(la, lo));
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y), pad = 50000, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
      const r = await fetch(`${ERDDAP}.csv?cdr_seaice_conc[(last)][(${y1}):1:(${y0})][(${x0}):1:(${x1})]`, { signal: AbortSignal.timeout(40000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lines = (await r.text()).split('\n'), cells = new Map(); let date = null;
      for (let i = 2; i < lines.length; i++) { const c = lines[i].split(','); if (c.length < 4) continue; date = date || c[0]; const v = parseFloat(c[3]); cells.set(`${Math.round(parseFloat(c[1]))}|${Math.round(parseFloat(c[2]))}`, Number.isFinite(v) ? v : null); }
      if (cells.size < 500 || !date) throw new Error('unexpected ERDDAP response');
      ice = { cells, date: date.slice(0, 10) };
    } catch (e) { ice = null; iceErr = e.message; }
    window.dispatchEvent(new Event('iceguard:ice'));
  }
  const iceAt = (lat, lon) => { if (!ice) return undefined; const q = A().toPolarStereo(lat, lon); if (!q) return null; const sn = v => Math.round(v / 25000 - 0.5) * 25000 + 12500; const v = ice.cells.get(`${sn(q.y)}|${sn(q.x)}`); return v === undefined ? null : v; };

  function refreshAI() {
    const box = $('aiList'), status = $('aiStatus'); if (!box || !status || !A()) return;
    const bergs = window.IGIcebergs || [];
    if (!bergs.length) { status.textContent = 'No verified iceberg feed available; AI output remains unavailable.'; box.replaceChildren(); return; }
    const en = bergs.map(berg => { const w = weatherFor(berg); return { berg, w, vector: w ? A().featureVector(berg, w) : null }; }).filter(e => e.vector);
    if (!en.length) { status.textContent = 'Iceberg feed loaded, but no Open-Meteo weather yet; scoring needs both.'; box.replaceChildren(); return; }
    const vs = en.map(e => e.vector), k = Math.min(5, Math.max(2, vs.length - 1));
    const all = en.map(e => ({ ...e, an: A().anomalyScore(vs, e.vector, { k }), pr: modelled(e.berg, e.w) })), sc = all.map(i => i.an.score), q75 = A().quantile(sc, 0.75), q90 = A().quantile(sc, 0.9);
    all.forEach(i => { i.an.label = i.an.score == null ? 'INSUFFICIENT DATA' : i.an.score >= q90 ? 'TOP 10% UNUSUAL' : i.an.score >= q75 ? 'TOP 25% UNUSUAL' : 'TYPICAL'; });
    const items = all.sort((a, b) => (b.an.score ?? -1) - (a.an.score ?? -1)).slice(0, 8);
    box.replaceChildren(...items.map(({ berg, an, pr, w }) => row(berg.name, `${an.label}${an.score != null ? ` (${an.score})` : ''} · ${w.siteName} ${Math.round(w.siteKm)} km · ` + (pr.status === 'MODELLED_NOT_OBSERVED' ? `24 h modelled → ${pr.lat.toFixed(2)}, ${pr.lon.toFixed(2)} ±${Math.round(pr.uncertaintyKm)} km` : `trajectory unavailable (${pr.status === 'INSUFFICIENT_DATA' ? 'no ocean-current data at nearest site' : pr.status})`))));
    status.textContent = `kNN anomaly scores for ${en.length}/${bergs.length} bergs (most unusual first); labels are percentile ranks within the current tracked set, not validated thresholds. Trajectory: ${window.IGTrajectoryModel ? 'trained regression' : 'physics baseline (ocean current + 1-3 % wind drag, unvalidated, shown as a range)'}. Positions are modelled, not observed.`;
  }

  const parsePoint = v => { const [lat, lon] = String(v).split(',').map(Number); if (![lat, lon].every(Number.isFinite)) throw new Error('Invalid route endpoint'); return { lat, lon }; };
  const bearing = (a, b) => { const p = Math.PI / 180, dl = (b.lon - a.lon) * p; return (Math.atan2(Math.sin(dl) * Math.cos(b.lat * p), Math.cos(a.lat * p) * Math.sin(b.lat * p) - Math.sin(a.lat * p) * Math.cos(b.lat * p) * Math.cos(dl)) / p + 360) % 360; };
  function corridors(o, d) { const brg = bearing(o, d), mid = A().destinationPoint(o, brg, A().haversine(o, d) / 2); return [-200, -100, 0, 100, 200].map(off => [o, off === 0 ? mid : A().destinationPoint(mid, (brg + (off > 0 ? 90 : 270)) % 360, Math.abs(off)), d]); }
  function sample(points, n = 40) { const out = []; for (let i = 1; i < points.length; i++) for (let j = 0; j <= n; j++) { const f = j / n; out.push({ lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * f, lon: points[i - 1].lon + (points[i].lon - points[i - 1].lon) * f }); } return out; }
  function landHits(points) { if (!window.IGElevationAt) return null; const a = points[0], b = points[points.length - 1]; return sample(points).filter(p => A().haversine(p, a) >= 30 && A().haversine(p, b) >= 30 && (window.IGElevationAt(p.lat, p.lon) ?? 0) > 0).length; }
  // Concentration stats: 0.15 = NSIDC ice-edge convention; 0.70 = close pack or denser (WMO sea-ice nomenclature, 7/10+). Null cells (land/flagged) are unknown, never zero.
  function iceStats(points) { if (!ice) return null; const v = sample(points).map(p => iceAt(p.lat, p.lon)).filter(x => x != null); return v.length ? { n: v.length, max: Math.max(...v), edge: v.filter(x => x >= 0.15).length / v.length, close: v.filter(x => x >= 0.7).length / v.length } : { n: 0 }; }

  // ---- Route optimiser: A* over the real 25 km NOAA/NSIDC concentration grid (8-neighbour). Blocks null cells (land/flagged), cells at/above the vessel limit,
  // and cells within 20 km of a berg. Step cost = great-circle km x (1 + 6c^2) x 1.5 within 50 km of a berg. Vessel limits are planning assumptions (WMO concentration classes), not an ice class.
  const VESSEL_LIMIT = { open: 0.15, ice: 0.7, breaker: 1.01 };
  function optimise(o, d, limit, bergs) {
    if (!ice) return { error: 'Sea-ice grid not loaded' };
    if (!ice.ll) { ice.ll = new Map(); ice.cells.forEach((v, k) => { if (v == null) return; const [y, x] = k.split('|').map(Number); ice.ll.set(k, { ...A().fromPolarStereo(x, y), y, x, v }); }); }
    const near = ll => bergs.reduce((m, b) => Math.min(m, A().haversine(ll, b)), Infinity), free = new Map();
    ice.ll.forEach((c, k) => { const nb = bergs.length ? near(c) : Infinity; if (c.v < limit && nb >= 20) free.set(k, { ...c, nb }); });
    const snap = p => { let b = null; free.forEach((c, k) => { const dd = A().haversine(p, c); if (!b || dd < b.d) b = { k, c, d: dd }; }); return b; };
    const s = snap(o), g = snap(d); if (!s || !g) return { error: 'No open-water cell available for this vessel limit' };
    if (s.d > 150 || g.d > 150) return { error: `Endpoint is ${Math.round(Math.max(s.d, g.d))} km from the nearest navigable cell; outside the grid or fully blocked` };
    const heap = [], push = n => { heap.push(n); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } },
      pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { let m = i, a = 2 * i + 1, b = a + 1; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
    const G = new Map([[s.k, 0]]), from = new Map(), S = 25000; push([A().haversine(s.c, g.c), s.k]);
    while (heap.length) {
      const [, k] = pop(); if (k === g.k) break; const c = free.get(k), gc = G.get(k);
      for (const dy of [-S, 0, S]) for (const dx of [-S, 0, S]) { if (!dy && !dx) continue; const nk = `${c.y + dy}|${c.x + dx}`, n = free.get(nk); if (!n) continue;
        const cost = gc + A().haversine(c, n) * (1 + 6 * ((c.v + n.v) / 2) ** 2) * (Math.min(c.nb, n.nb) < 50 ? 1.5 : 1);
        if (cost < (G.get(nk) ?? Infinity)) { G.set(nk, cost); from.set(nk, k); push([cost + A().haversine(n, g.c), nk]); } }
    }
    if (!G.has(g.k)) return { error: 'No path exists under this vessel limit (blocked by land, ice or icebergs)' };
    const path = []; for (let k = g.k; k; k = from.get(k)) path.push(free.get(k)); path.reverse();
    return { points: [o, ...path.map(c => ({ lat: c.lat, lon: c.lon })), d] };
  }
  function optCard(o, d, bergs) {
    const el = document.createElement('article'), h = document.createElement('h3'), st = document.createElement('strong'), p = document.createElement('p'), b = document.createElement('span');
    el.className = 'glass route-card'; h.textContent = 'Optimised route (A*)'; p.className = 'small-muted'; b.className = 'data-status live';
    const r = optimise(o, d, VESSEL_LIMIT[$('vessel')?.value || 'ice'], bergs);
    if (r.error) { st.textContent = 'No route'; p.textContent = r.error; b.className = 'data-status error'; b.textContent = 'NOT AVAILABLE'; el.append(h, st, p, b); return el; }
    const sc = A().routeScore(r.points, bergs), ic = iceStats(r.points), direct = A().haversine(o, d);
    st.textContent = `${Math.round(sc.distanceKm)} km (${direct > 0 ? '+' + Math.round((sc.distanceKm / direct - 1) * 100) : 0}% vs great circle)`;
    p.textContent = `Searched real CDR ice grid (${ice.date}); avoids land cells, ice above the vessel limit and bergs within 20 km. Min berg clearance ${sc.minimumClearanceKm == null ? 'n/a' : Math.round(sc.minimumClearanceKm) + ' km'}; ice ≥15% on ${Math.round((ic?.edge || 0) * 100)}% of path, ≥70% on ${Math.round((ic?.close || 0) * 100)}%. Vessel limits are planning assumptions, not an ice class.`;
    b.textContent = 'OPTIMISED · DECISION SUPPORT ONLY'; el.append(h, st, p, b); return el;
  }

  function evaluateRoute() {
    const out = $('routeResult'); if (!out || !A()) return;
    try {
      const o = parsePoint($('routeOrigin').value), d = parsePoint($('routeDestination').value);
      const obs = (window.IGIcebergs || []).map(b => ({ lat: b.lat, lon: b.lon }));
      if (!obs.length) throw new Error('Iceberg feed not loaded yet; clearance cannot be computed.');
      const pred = (window.IGIcebergs || []).map(b => { const w = weatherFor(b); return w ? modelled(b, w) : null; }).filter(p => p && p.status === 'MODELLED_NOT_OBSERVED');
      const cards = corridors(o, d).map(points => ({ land: landHits(points), ice: iceStats(points), s: A().routeScore(points, [...obs, ...pred]) }))
        .sort((a, b) => ((a.land > 0) - (b.land > 0)) || ((a.ice?.close || 0) - (b.ice?.close || 0)) || ((a.ice?.edge || 0) - (b.ice?.edge || 0)) || ((a.s.hazardScore ?? 1) - (b.s.hazardScore ?? 1)) || (a.s.distanceKm - b.s.distanceKm));
      out.replaceChildren(optCard(o, d, [...obs, ...pred]), ...cards.map(({ land, ice: ic, s }, i) => {
        const el = document.createElement('article'), h = document.createElement('h3'), st = document.createElement('strong'), p = document.createElement('p'), b = document.createElement('span');
        const heavy = ic && ic.close > 0, blocked = land > 0; el.className = 'glass route-card'; h.textContent = `Corridor ${i + 1}`; st.textContent = `${Math.round(s.distanceKm)} km`; p.className = 'small-muted';
        p.textContent = [s.minimumClearanceKm == null ? 'Iceberg clearance unavailable' : `Min clearance to ${pred.length ? 'observed + modelled' : 'observed'} bergs: ${Math.round(s.minimumClearanceKm)} km`,
          land == null ? 'land check unavailable' : blocked ? `${land} samples cross land/ice shelf` : 'no land crossing (z5 tiles, coarse)',
          !ice ? `ice concentration unavailable${iceErr ? ` (${iceErr})` : ' (loading)'}` : ic?.n ? `ice ≥15 % on ${Math.round(ic.edge * 100)} % of path, ≥70 % on ${Math.round(ic.close * 100)} %, max ${Math.round(ic.max * 100)} % (CDR ${ice.date})` : 'no valid ice cells on path'].join(' · ');
        b.className = `data-status ${blocked ? 'error' : heavy || (s.hazardScore ?? 1) >= 0.7 ? 'stale' : 'live'}`; b.textContent = blocked ? 'BLOCKED BY LAND' : heavy ? 'HEAVY ICE · REVIEW REQUIRED' : ic == null ? 'ICE DATA MISSING · REVIEW' : s.decision;
        el.append(h, st, p, b); return el;
      }));
    } catch (e) { const el = document.createElement('article'), h = document.createElement('h3'), p = document.createElement('p'); el.className = 'glass route-card'; h.textContent = 'Route analysis unavailable'; p.className = 'small-muted'; p.textContent = e.message; el.append(h, p); out.replaceChildren(el); }
  }
  document.addEventListener('DOMContentLoaded', () => { $('optimizeRoute')?.addEventListener('click', evaluateRoute); addEventListener('iceguard:icebergs', refreshAI); addEventListener('iceguard:weather', refreshAI); setTimeout(refreshAI, 2500); loadIce(); });
})();
