/* IceGuard: source-backed terrain and Open-Meteo model output only.
 * No generated weather, synthetic terrain, or synthetic risk scores are used.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!window.THREE) return;

  const sites = [
    { name: 'King George Island', lat: -62.2, lon: -58.6 },
    { name: 'Deception Island', lat: -63.0, lon: -60.6 },
    { name: 'Palmer area', lat: -64.8, lon: -64.1 },
    { name: 'Marguerite Bay', lat: -68.0, lon: -68.0 },
    { name: 'Weddell Sea edge', lat: -64.5, lon: -52.0 },
    { name: 'Elephant Island', lat: -61.1, lon: -55.2 },
    { name: 'Larsen Ice Shelf region', lat: -67.5, lon: -62.5 }
  ];
  const state = sites.map(site => ({ ...site, data: null, error: 'Not loaded' }));
  window.IGSites = sites;
  const fmt = (v, n) => Number.isFinite(v) ? v.toFixed(n) : 'n/a';
  let selected = 0, terrainReady = false, chartLine = null, chartBar = null, renderer = null, initialWeatherDone = false;
  let scene = null, camera = null, controls = null, markers = [], markerRings = [], mapVisible = true;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setPill(text, ok) {
    const pill = $('pill'); pill.textContent = text; pill.classList.toggle('alert', !ok);
  }
  function setMapStatus(text, show = true) {
    const el = $('mapStatus'); if (el) { el.textContent = text; el.hidden = !show; }
  }
  function temperatureColor(temp) {
    if (!Number.isFinite(temp)) return new THREE.Color('#7f93a8');
    return new THREE.Color(temp <= 0 ? '#4cc9f0' : '#ffbf5e');
  }
  function mercator(lat, lon, zoom, tileX, tileY) {
    const rad = lat * Math.PI / 180;
    const n = 2 ** zoom;
    const x = (lon + 180) / 360 * n;
    const y = (1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n;
    return [(x - tileX) / 3 * 10 - 5, (y - tileY) / 3 * 10 - 5];
  }
  async function fetchTerrain() {
    const zoom = 5, tx = 9, ty = 22;
    const tiles = await Promise.all(Array.from({ length: 9 }, (_, k) => new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img); img.onerror = () => reject(new Error('Elevation tile failed to load'));
      img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx + k % 3}/${ty + Math.floor(k / 3)}.png`;
    })));
    const c = document.createElement('canvas'); c.width = c.height = 768;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    tiles.forEach((img, k) => ctx.drawImage(img, (k % 3) * 256, Math.floor(k / 3) * 256));
    const pixels = ctx.getImageData(0, 0, 768, 768).data;
    const size = 192, heights = new Float32Array((size + 1) ** 2);
    for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) {
      const offset = (Math.round(y / size * 767) * 768 + Math.round(x / size * 767)) * 4;
      heights[y * (size + 1) + x] = pixels[offset] * 256 + pixels[offset + 1] + pixels[offset + 2] / 256 - 32768;
    }
    return { heights, size, real: true };
  }
  async function fetchWeather(site) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: String(site.lat), longitude: String(site.lon),
      current: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl', hourly: 'temperature_2m,wind_speed_10m',
      past_days: '1', forecast_days: '1', timezone: 'UTC'
    }).toString();
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const json = await response.json();
    const temp = json.current?.temperature_2m, wind = json.current?.wind_speed_10m;
    if (!Number.isFinite(temp) || !Number.isFinite(wind) || !Array.isArray(json.hourly?.time) || !Array.isArray(json.hourly?.temperature_2m)) {
      throw new Error('Open-Meteo response missing expected weather fields');
    }
    return {
      temperature: temp, wind, dir: json.current.wind_direction_10m, gust: json.current.wind_gusts_10m, pressure: json.current.pressure_msl, time: json.current.time || null,
      hourlyTime: json.hourly.time, hourlyTemp: json.hourly.temperature_2m,
      source: 'Open-Meteo forecast model', fetchedAt: new Date().toISOString()
    };
  }
  async function refreshWeather() {
    $('refreshWeather').disabled = true;
    $('feedNote').textContent = 'Requesting current and hourly Open-Meteo model output for seven Antarctic Peninsula locations…';
    const results = await Promise.allSettled(state.map(s => fetchWeather(s)));
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') { state[i].data = result.value; state[i].error = null; }
      else { state[i].data = null; state[i].error = result.reason?.message || 'Weather source unavailable'; }
    });
    const loaded = state.filter(s => s.data).length;
    const times = state.filter(s => s.data?.time).map(s => s.data.time).sort();
    $('feedNote').textContent = `Source: Open-Meteo forecast model. ${loaded}/7 locations loaded. Model output is not an in-situ station observation; timestamps are UTC.`;
    $('sT').textContent = `${loaded} / ${state.length}`;
    const available = state.filter(s => s.data);
    $('sA').textContent = available.length ? `${(available.reduce((sum, s) => sum + s.data.temperature, 0) / available.length).toFixed(1)}°C` : 'Unavailable';
    $('sW').textContent = available.length ? `${Math.max(...available.map(s => s.data.wind)).toFixed(1)}` : 'Unavailable';
    $('sL').textContent = available.length ? `${available.filter(s => s.data.temperature <= 0).length} / ${available.length}` : 'Unavailable';
    $('weatherUpdated').textContent = times.length ? `Model timestamps: ${times[0]}–${times[times.length - 1]} UTC · refreshed ${new Date().toISOString()}` : 'No successful response; no values are substituted.';
    setPill(loaded === state.length ? 'WEATHER MODEL · 7/7 LOCATIONS' : `WEATHER MODEL · ${loaded}/7 LOCATIONS`, loaded > 0);
    updateCharts(); updateSelection(); updateMarkers();
    if (!initialWeatherDone) { initialWeatherDone = true; window.IG?.done('Weather source checked'); }
    $('refreshWeather').disabled = false;
  }
  function initCharts() {
    if (!window.Chart) return;
    Chart.defaults.color = '#9fb8cc'; Chart.defaults.borderColor = 'rgba(120,190,230,.12)';
    chartLine = new Chart($('cLine'), { type: 'line', data: { labels: [], datasets: [{ label: 'Hourly temperature (°C)', data: [], borderColor: '#4cc9f0', backgroundColor: '#4cc9f026', fill: true, spanGaps: false, pointRadius: 0, tension: .2 }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: true } }, scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { title: { display: true, text: '°C' } } } } });
    chartBar = new Chart($('cBar'), { type: 'bar', data: { labels: state.map(s => s.name), datasets: [{ label: 'Current temperature (°C)', data: [], backgroundColor: '#4cc9f0', spanGaps: false }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { y: { title: { display: true, text: '°C' } } } } });
  }
  function updateCharts() {
    if (!chartLine || !chartBar) return;
    const chosen = state[selected], d = chosen.data;
    chartLine.data.labels = d ? d.hourlyTime.map(t => t.slice(5, 16).replace('T', ' ')) : [];
    chartLine.data.datasets[0].data = d ? d.hourlyTemp : [];
    chartLine.data.datasets[0].label = `${chosen.name} hourly model temperature (°C)`;
    chartLine.update('none');
    chartBar.data.datasets[0].data = state.map(s => s.data ? s.data.temperature : null);
    chartBar.data.datasets[0].backgroundColor = state.map(s => s.data ? temperatureColor(s.data.temperature).getStyle() : '#526173');
    chartBar.update('none');
  }
  function updateSelection() {
    const s = state[selected], d = s.data;
    $('lt').textContent = `${s.name} · hourly model temperature`;
    $('sel').innerHTML = d
      ? `<div><span>Location</span><b>${s.name}</b></div><div><span>Latitude / longitude</span><b>${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}</b></div><div><span>Model temperature</span><b>${d.temperature.toFixed(1)}°C</b></div><div><span>Model wind</span><b>${d.wind.toFixed(1)} km/h</b></div><div><span>Wind from / gusts</span><b>${fmt(d.dir, 0)}° / ${fmt(d.gust, 1)} km/h</b></div><div><span>Sea-level pressure</span><b>${fmt(d.pressure, 1)} hPa</b></div><div><span>Model timestamp (UTC)</span><b>${d.time || 'Not supplied'}</b></div>`
      : `<div><span>Location</span><b>${s.name}</b></div><div><span>Data status</span><b>Unavailable</b></div><div><span>Source error</span><b>${String(s.error || 'No response').replace(/[<>&"']/g, '')}</b></div>`;
    if (chartLine) updateCharts();
  }
  function updateMarkers() {
    markers.forEach((marker, i) => {
      const d = state[i].data; const color = temperatureColor(d ? d.temperature : NaN);
      marker.material.color.copy(color); marker.material.emissive.copy(color);
      marker.visible = terrainReady;
      marker.scale.y = d ? Math.max(.12, Math.min(2, .45 + Math.abs(d.temperature) / 15)) : .12;
      marker.position.y = marker.userData.baseY;
      if (markerRings[i]) { markerRings[i].material.color.copy(color); markerRings[i].visible = terrainReady; }
    });
  }
  function initTerrain(terrain) {
    const canvas = $('map3d');
    if (!terrain) {
      window.IG?.done('Elevation source checked'); $('terr').textContent = 'Terrain unavailable'; setMapStatus('Published elevation tiles could not be loaded. No procedural terrain is shown.');
      canvas.setAttribute('aria-label', 'Terrain unavailable because published elevation data could not be loaded'); return;
    }
    const size = terrain.size, W = 10, H = 10, heights = terrain.heights;
    const hAt = (x, z) => heights[Math.max(0, Math.min(size, Math.round((z + W / 2) / W * size))) * (size + 1) + Math.max(0, Math.min(size, Math.round((x + W / 2) / W * size)))];
    const R = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer = R; R.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const S = new THREE.Scene(); scene = S; S.background = new THREE.Color(0x07101f); S.fog = new THREE.Fog(0x07101f, 14, 30);
    const cam = new THREE.PerspectiveCamera(45, 1, .1, 80); camera = cam; cam.position.set(0, 6.5, 9);
    const ctl = new THREE.OrbitControls(cam, canvas); controls = ctl; Object.assign(ctl, { enableDamping: true, dampingFactor: .07, minDistance: 2.5, maxDistance: 16, maxPolarAngle: Math.PI * .48 });
    S.add(new THREE.HemisphereLight(0xbfe9ff, 0x0a1830, .9)); const sun = new THREE.DirectionalLight(0xffffff, .9); sun.position.set(5, 8, 4); S.add(sun);
    const geom = new THREE.PlaneGeometry(W, W, size, size); geom.rotateX(-Math.PI / 2); const pos = geom.attributes.position, colors = [];
    for (let i = 0; i < pos.count; i++) {
      const elev = heights[i]; const y = elev > 0 ? elev / 1000 * .7 : 0; pos.setY(i, y);
      const c = new THREE.Color(); if (elev <= 0) c.set('#0a1e3d').lerp(new THREE.Color('#0d3b6b'), Math.max(0, 1 + elev / 4000)); else c.set('#7fa3c4').lerp(new THREE.Color('#ffffff'), Math.min(1, elev / 2200)); colors.push(c.r, c.g, c.b);
    }
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geom.computeVertexNormals(); S.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85 })));
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(W, W).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2aa7d0, transparent: true, opacity: .18 })); sea.position.y = .01; S.add(sea);
    sites.forEach((s, i) => {
      const [x, z] = mercator(s.lat, s.lon, 5, 9, 22); const y = hAt(x, z) > 0 ? hAt(x, z) / 1000 * .7 : .03;
      const marker = new THREE.Mesh(new THREE.BoxGeometry(.22, 1, .22).translate(0, .5, 0), new THREE.MeshStandardMaterial({ color: 0x7f93a8, emissive: 0x7f93a8, emissiveIntensity: .3 }));
      marker.position.set(x, y + .1, z); marker.userData.index = i; marker.userData.baseY = y + .1; S.add(marker); markers.push(marker);
      const ring = new THREE.Mesh(new THREE.RingGeometry(.22, .31, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7f93a8, transparent: true, opacity: .7, side: THREE.DoubleSide })); ring.position.set(x, y + .12, z); S.add(ring); markerRings.push(ring);
    });
    const chips = $('chips');
    [['Overview', -1], ...sites.map((s, i) => [s.name, i])].forEach(([name, index]) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = name; b.setAttribute('aria-pressed', String(index === -1));
      b.addEventListener('click', () => { if (index >= 0) selected = index; chips.querySelectorAll('button').forEach((el, i) => el.setAttribute('aria-pressed', String(index === -1 ? i === 0 : i === index + 1))); updateSelection(); updateMarkers(); const p = index >= 0 ? markers[index].position : new THREE.Vector3(0, 0, 0); const target = index >= 0 ? new THREE.Vector3(p.x + 1.4, p.y + 1.8, p.z + 2.4) : new THREE.Vector3(0, 6.5, 9); if (!reducedMotion && window.gsap) { gsap.to(cam.position, { x: target.x, y: target.y, z: target.z, duration: 1.2 }); gsap.to(ctl.target, { x: p.x, y: p.y, z: p.z, duration: 1.2 }); } else { cam.position.copy(target); ctl.target.copy(p); } }); chips.appendChild(b);
    });
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $('tip'); let pointerDown = null;
    function pick(e) { const r = canvas.getBoundingClientRect(); mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(mouse, cam); return ray.intersectObjects(markers)[0]?.object?.userData?.index; }
    canvas.addEventListener('pointermove', e => { const i = pick(e); canvas.style.cursor = i != null ? 'pointer' : 'grab'; if (i == null) { tip.hidden = true; return; } const r = canvas.getBoundingClientRect(), d = state[i]; tip.hidden = false; tip.style.left = `${e.clientX - r.left}px`; tip.style.top = `${e.clientY - r.top}px`; tip.textContent = d.data ? `${d.name} · ${d.data.temperature.toFixed(1)}°C · ${d.data.wind.toFixed(1)} km/h · model ${d.data.time || 'time unavailable'} UTC` : `${d.name} · weather data unavailable`; });
    canvas.addEventListener('pointerleave', () => { tip.hidden = true; }); canvas.addEventListener('pointerdown', e => { pointerDown = [e.clientX, e.clientY]; }); canvas.addEventListener('pointerup', e => { if (pointerDown && Math.hypot(e.clientX - pointerDown[0], e.clientY - pointerDown[1]) < 6) { const i = pick(e); if (i != null) { selected = i; updateSelection(); chips.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i + 1))); } } pointerDown = null; });
    terrainReady = true; window.IG?.done('Elevation source loaded'); $('terr').textContent = 'Terrain: published elevation tiles · particles: Open-Meteo model wind, interpolated between sites, time-compressed'; setMapStatus('', false); updateMarkers();
    const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    new ResizeObserver(resize).observe(canvas); resize();
    const observer = new IntersectionObserver(entries => { mapVisible = entries[0].isIntersecting; }); observer.observe(canvas);
    // Real iceberg positions (BYU/NASA SCP) drawn as white markers when inside the map window.
    const bergMeshes = [];
    window.IGBergs = list => { bergMeshes.forEach(m => S.remove(m)); bergMeshes.length = 0; list.forEach(b => { const [x, z] = mercator(b.lat, b.lon, 5, 9, 22); if (Math.abs(x) > W / 2 || Math.abs(z) > W / 2) return; const m = new THREE.Mesh(new THREE.IcosahedronGeometry(.1, 0), new THREE.MeshStandardMaterial({ color: 0xe8f7ff, emissive: 0x7fd8ff, emissiveIntensity: .6, flatShading: true })); m.position.set(x, .07, z); m.userData.phase = bergMeshes.length; S.add(m); bergMeshes.push(m); }); return bergMeshes.length; };
    if (window.IGBergsPending) window.IGBergs(window.IGBergsPending);
    // VFX: wind particles driven by real Open-Meteo wind speed/direction (inverse-distance interpolation between the 7 sites).
    const NP = 1600, wp = new Float32Array(NP * 3), life = new Float32Array(NP); let seed = 1, last = 0;
    const hash = k => { const s = Math.sin(k * 12.9898) * 43758.5453; return s - Math.floor(s); };
    const elevY = (x, z) => { const e = hAt(x, z); return (e > 0 ? e / 1000 * .7 : 0) + .06; };
    const spawn = i => { const x = (hash(seed++) - .5) * W, z = (hash(seed++) - .5) * W; wp[i * 3] = x; wp[i * 3 + 2] = z; wp[i * 3 + 1] = elevY(x, z); life[i] = 1 + hash(seed++) * 3; };
    for (let i = 0; i < NP; i++) spawn(i);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
    const windPts = new THREE.Points(wg, new THREE.PointsMaterial({ color: 0xcfefff, size: .045, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false })); S.add(windPts);
    const windAt = (x, z) => { let u = 0, v = 0, sw = 0; markers.forEach((m, i) => { const d = state[i].data; if (!d || !Number.isFinite(d.dir) || !Number.isFinite(d.wind)) return; const w = 1 / ((m.position.x - x) ** 2 + (m.position.z - z) ** 2 + .3), r = d.dir * Math.PI / 180; u += w * -d.wind * Math.sin(r); v += w * -d.wind * Math.cos(r); sw += w; }); return sw ? [u / sw, -v / sw] : [0, 0]; };
    (function render(t) {
      requestAnimationFrame(render); if (!mapVisible) return;
      const dt = Math.min(.05, (t - last) / 1000 || 0); last = t; windPts.visible = state.some(s => s.data);
      if (windPts.visible && !reducedMotion) {
        for (let i = 0; i < NP; i++) { const [dx, dz] = windAt(wp[i * 3], wp[i * 3 + 2]); wp[i * 3] += dx * dt * .012; wp[i * 3 + 2] += dz * dt * .012; life[i] -= dt; const x = wp[i * 3], z = wp[i * 3 + 2]; if (life[i] <= 0 || Math.abs(x) > W / 2 || Math.abs(z) > W / 2) spawn(i); else wp[i * 3 + 1] = elevY(x, z); }
        wg.attributes.position.needsUpdate = true;
        markerRings.forEach((r, i) => { const w = state[i].data?.wind || 0; r.scale.setScalar(1 + .35 * Math.sin(t / (900 - Math.min(w, 60) * 8) + i)); });
      }
      if (!reducedMotion) bergMeshes.forEach(m => { m.rotation.y = t / 2000 + m.userData.phase; m.position.y = .07 + .02 * Math.sin(t / 700 + m.userData.phase); });
      controls.update(); R.render(scene, camera);
    })(0);
  }
  async function init() {
    initCharts(); $('refreshWeather').addEventListener('click', refreshWeather); await refreshWeather();
    try { const terrain = await fetchTerrain(); initTerrain(terrain); }
    catch (error) { initTerrain(null); console.warn('Published elevation source unavailable:', error); }
  }
  init().catch(error => { console.error(error); setPill('DATA SOURCE ERROR', false); });
  // Refresh model data on a sensible cadence, never by fabricating rapid values.
  setInterval(() => { if (!document.hidden) refreshWeather().catch(error => console.warn('Weather refresh failed', error)); }, 15 * 60 * 1000);
})();
