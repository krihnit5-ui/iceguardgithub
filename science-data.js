/* Official NSIDC Sea Ice Index adapter. Real data only: if every source fails, the value stays "Unavailable". */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const official = 'https://noaadata.apps.nsidc.org/NOAA/G02135/south/daily/data/S_seaice_extent_daily_v4.0.csv';
  // Same-origin function first, then the official URL,  that return the unmodified official CSV.
  const sources = [
    ['same-origin /api/sea-ice', '/api/sea-ice'],
    ['NSIDC (direct)', official]
  ];
  // Last resort: NOAA CoastWatch ERDDAP (CORS-enabled) serving the NOAA/NSIDC sea-ice concentration grid. Extent is DERIVED here (cells >= 15% x 625 km2).
  const erddapBase = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/nsidcG10016v3sh1day';
  async function erddapExtent() {
    const r = await fetch(`${erddapBase}.csv?cdr_seaice_conc[(last)][(4337500.0):1:(-3937500.0)][(-3937500.0):1:(3937500.0)]`, { signal: AbortSignal.timeout(40000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const lines = (await r.text()).split('\n'); let n = 0, valid = 0, iso = null;
    for (let i = 2; i < lines.length; i++) {
      const c = lines[i].split(','); if (c.length < 4) continue;
      const v = parseFloat(c[3]); if (!iso) iso = c[0];
      if (Number.isFinite(v)) { valid++; if (v >= 0.15) n++; }
    }
    if (!iso || valid < 20000) throw new Error('unexpected ERDDAP response');
    return { date: new Date(iso), extent: n * 0.000625, valid };
  }
  function forecast(recs) {
    const el = $('fcBox'), AI = window.IceGuardAI; if (!el || !AI) return;
    const m = AI.trainExtentForecaster(recs);
    if (m.status !== 'TRAINED') { el.textContent = 'Forecast unavailable: not enough history.'; return; }
    const f = h => { const x = m.forecast(h); return `${h} d (${x.date.toISOString().slice(0, 10)}): ${x.extent.toFixed(2)} M km²`; };
    const s = h => { const r = m.horizons[h]; return `${h} d: model ${r.maeModel.toFixed(3)} · persistence ${r.maePersistence.toFixed(3)} · climatology ${r.maeClimatology.toFixed(3)} (n=${r.n})`; };
    el.textContent = `MODELLED forecast of hemispheric extent, ${f(7)}; ${f(30)}. Held-out test since ${m.testFrom.toISOString().slice(0, 10)}, mean absolute error in M km² (lower is better) — ${s(7)} | ${s(30)}. Learned on this NSIDC series in your browser; extent only, not a concentration map.`;
  }
  let chart = null;
  function status(kind, message) { const el = $('extentStatus'); el.className = `data-status ${kind}`; el.textContent = message; }
  function parseCsv(text) {
    const data = [];
    for (const row of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const c = row.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      if (c.length < 4) continue;
      const [year, month, day, extent] = c.slice(0, 4).map(Number);
      if (!Number.isInteger(year) || year < 1978 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31 || !Number.isFinite(extent) || extent <= 0 || extent > 40) continue;
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) data.push({ date, extent });
    }
    return data.sort((a, b) => a.date - b.date);
  }
  async function getRecords() {
    const errors = [];
    for (const [label, url] of sources) {
      try {
        const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const recs = parseCsv(await r.text());
        if (recs.length < 400) throw new Error('not a valid NSIDC extent CSV');
        return { recs, label };
      } catch (e) { errors.push(`${label}: ${e.message}`); }
    }
    throw new Error(errors.join(' | '));
  }
  function drawChart(recs) {
    const cv = $('cExtent'); if (!cv || !window.Chart) return;
    const cy = recs[recs.length - 1].date.getUTCFullYear(), series = y => {
      const a = new Array(366).fill(null);
      recs.filter(r => r.date.getUTCFullYear() === y).forEach(r => { a[Math.floor((r.date - Date.UTC(y, 0, 1)) / 864e5)] = r.extent; });
      return a;
    };
    const labels = Array.from({ length: 366 }, (_, i) => new Date(Date.UTC(2020, 0, 1 + i)).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
    const mk = (l, d, c, dash) => ({ label: l, data: d, borderColor: c, borderDash: dash ? [6, 4] : [], pointRadius: 0, tension: .2, spanGaps: false, borderWidth: 2 });
    if (chart) chart.destroy();
    chart = new Chart(cv, { type: 'line', data: { labels, datasets: [mk(`${cy - 1} (NSIDC daily)`, series(cy - 1), '#ffbf5e', true), mk(`${cy} (NSIDC daily)`, series(cy), '#4cc9f0')] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1400, easing: 'easeOutQuart' }, interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { title: { display: true, text: 'Extent (million km²)' } } } } });
  }
  async function load() {
    status('loading', 'Loading official NSIDC data…');
    $('extentValue').textContent = 'Unavailable'; $('extentDate').textContent = 'Waiting for a verified source response';
    $('extentMetric').textContent = 'Not calculated'; $('extentMetricNote').textContent = 'No historical evaluation is calculated until valid source rows load.';
    let res;
    try { res = await getRecords(); }
    catch (e1) {
      status('loading', 'NSIDC CSV blocked; trying NOAA CoastWatch concentration grid…');
      try {
        const g = await erddapExtent();
        $('extentValue').textContent = `${g.extent.toFixed(3)} million km²`;
        $('extentDate').textContent = `Derived from NOAA/NSIDC CDR concentration grid (cells ≥15%, ${g.valid.toLocaleString()} ocean cells) · grid date ${g.date.toISOString().slice(0, 10)} UTC · via NOAA CoastWatch ERDDAP`;
        $('extentMetric').textContent = 'Not calculated'; $('extentMetricNote').textContent = 'A single grid does not give a time series; the official CSV routes failed: ' + e1.message;
        $('extentDelta').textContent = 'Derived estimate; may differ slightly from the official NSIDC Sea Ice Index extent.';
        const age = (Date.now() - g.date.getTime()) / 864e5;
        status(age > 10 ? 'stale' : 'live', age > 10 ? `Real data loaded; grid is ${Math.round(age)} days old (source lag)` : 'Real data loaded (derived from concentration grid)');
        return;
      } catch (e2) { status('error', 'Scientific data unavailable (all routes failed)'); $('extentDate').textContent = `No verified observation loaded. CSV: ${e1.message} | ERDDAP: ${e2.message}`; return; }
    }
    const { recs, label } = res, latest = recs[recs.length - 1];
    $('extentValue').textContent = `${latest.extent.toFixed(3)} million km²`;
    $('extentDate').textContent = `Latest observation in source: ${latest.date.toISOString().slice(0, 10)} UTC · NSIDC daily extent · route: ${label}`;
    const diffs = []; for (let i = recs.length - 30; i < recs.length; i++) diffs.push(Math.abs(recs[i].extent - recs[i - 1].extent));
    $('extentMetric').textContent = `${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(3)} million km² MAE`;
    $('extentMetricNote').textContent = `One-day persistence baseline across ${diffs.length} sequential comparisons; not an IceGuard forecast.`;
    const ly = recs.find(r => r.date.getTime() === Date.UTC(latest.date.getUTCFullYear() - 1, latest.date.getUTCMonth(), latest.date.getUTCDate()));
    $('extentDelta').textContent = ly ? `Same date last year (${ly.date.toISOString().slice(0, 10)}): ${ly.extent.toFixed(3)} million km² · difference ${(latest.extent - ly.extent >= 0 ? '+' : '') + (latest.extent - ly.extent).toFixed(3)}` : 'Same-date record for last year not present in source.';
    drawChart(recs); forecast(recs);
    const age = (Date.now() - latest.date.getTime()) / 864e5;
    status(age > 10 ? 'stale' : 'live', age > 10 ? 'Source loaded; latest record is older than 10 days' : 'Official source loaded');
  }
  const run = () => load().catch(e => { status('error', 'Scientific data unavailable'); $('extentDate').textContent = e.message; });
  $('retryExtent')?.addEventListener('click', run); run();
})();
