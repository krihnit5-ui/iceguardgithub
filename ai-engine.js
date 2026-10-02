/* IceGuard AI engine
 *
 * ML layer:
 *  - kNN anomaly detection over observed iceberg/environment feature vectors.
 *  - trainable polynomial regression for wind -> iceberg drift-speed residuals.
 *  - spherical trajectory projection (no flat-earth longitude approximation).
 *  - route corridor clearance using segment interpolation to avoid blind spots.
 *
 * Integrity rule: observed values and modelled values are never conflated.
 * A trajectory prediction requires valid wind data and a trained model. If a
 * trained model is unavailable, callers receive an explicit INSUFFICIENT_DATA
 * result rather than silently substituting missing values with zero.
 */
(function () {
  'use strict';

  const EARTH_RADIUS_KM = 6371;
  // |lat|, |lon|, wind km/h, sin(dir), cos(dir), pressure hPa
  const DEFAULT_SCALES = [10, 20, 20, 0.5, 0.5, 50];

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const finite = v => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v));
  const num = v => Number(v);

  function haversine(a, b) {
    if (!a || !b || !finite(a.lat) || !finite(a.lon) || !finite(b.lat) || !finite(b.lon)) return NaN;
    const p = Math.PI / 180;
    const dLat = (num(b.lat) - num(a.lat)) * p;
    const dLon = (num(b.lon) - num(a.lon)) * p;
    const lat1 = num(a.lat) * p;
    const lat2 = num(b.lat) * p;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  // Destination on a sphere. This remains well-behaved near the poles.
  function destinationPoint(origin, bearingDeg, distanceKm) {
    if (!origin || !finite(origin.lat) || !finite(origin.lon) || !finite(bearingDeg) || !finite(distanceKm)) return null;
    const p = Math.PI / 180;
    const lat1 = num(origin.lat) * p;
    const lon1 = num(origin.lon) * p;
    const brng = num(bearingDeg) * p;
    const delta = num(distanceKm) / EARTH_RADIUS_KM;
    const lat2 = Math.asin(clamp(
      Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(brng),
      -1,
      1
    ));
    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2)
    );
    return {
      lat: num((lat2 / p).toFixed(5)),
      lon: num((((lon2 / p) + 540) % 360 - 180).toFixed(5))
    };
  }

  /* Missing environmental values are NOT replaced with zero. */
  function featureVector(berg, weather = {}) {
    if (!berg || !finite(berg.lat) || !finite(berg.lon)) return null;
    if (!finite(weather.wind) || !finite(weather.dir) || !finite(weather.pressure)) return null;
    const r = num(weather.dir) * Math.PI / 180;
    return [Math.abs(num(berg.lat)), Math.abs(num(berg.lon)), num(weather.wind), Math.sin(r), Math.cos(r), num(weather.pressure)];
  }

  function normalizedDistance(a, b, scales = DEFAULT_SCALES) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return NaN;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const av = num(a[i]);
      const bv = num(b[i]);
      const scale = Math.max(1e-9, num(scales[i]) || 1);
      if (!Number.isFinite(av) || !Number.isFinite(bv)) return NaN;
      sum += ((av - bv) / scale) ** 2;
    }
    return Math.sqrt(sum);
  }

  function anomalyScore(rows, target, options = {}) {
    if (!Array.isArray(rows) || !Array.isArray(target)) {
      return { score: null, label: 'INSUFFICIENT DATA', confidence: 0, neighbors: 0 };
    }
    const k = clamp(Math.floor(num(options.k) || 5), 2, 15);
    const distances = rows
      .filter(row => row !== target)
      .map(row => normalizedDistance(row, target, options.scales || DEFAULT_SCALES))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (distances.length < Math.min(k, 2)) {
      return { score: null, label: 'INSUFFICIENT DATA', confidence: 0, neighbors: distances.length };
    }
    const nearest = distances.slice(0, Math.min(k, distances.length));
    const score = nearest.reduce((sum, d) => sum + d, 0) / nearest.length;
    const elevated = num(options.elevatedThreshold ?? 1.2);
    const anomalous = num(options.anomalyThreshold ?? 2.0);
    let label = 'NORMAL';
    if (score >= anomalous) label = 'ANOMALOUS';
    else if (score >= elevated) label = 'ELEVATED';
    return {
      score: Number(score.toFixed(3)),
      label,
      confidence: Number(clamp(1 / (1 + score), 0, 1).toFixed(3)),
      neighbors: nearest.length
    };
  }

  // 2x2 / 3x3 Gaussian elimination for a tiny regression model.
  function solveLinearSystem(A, b) {
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
      }
      if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('Singular regression matrix');
      [M[col], M[pivot]] = [M[pivot], M[col]];
      for (let row = col + 1; row < n; row++) {
        const factor = M[row][col] / M[col][col];
        for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let value = M[i][n];
      for (let j = i + 1; j < n; j++) value -= M[i][j] * x[j];
      x[i] = value / M[i][i];
    }
    return x;
  }

  /**
   * Train a polynomial regression model from REAL historical samples.
   * Each sample must contain windSpeedKmh and driftSpeedKmh.
   * Features: [1, wind, wind^2]. Ridge regularization stabilizes small datasets.
   */
  function trainTrajectoryModel(samples, options = {}) {
    if (!Array.isArray(samples)) throw new Error('Training samples must be an array');
    const usable = samples.filter(s => s && finite(s.windSpeedKmh) && finite(s.driftSpeedKmh));
    if (usable.length < 8) {
      return { status: 'INSUFFICIENT_TRAINING_DATA', model: null, samples: usable.length };
    }
    const lambda = Math.max(0, num(options.lambda ?? 0.01));
    const X = usable.map(s => {
      const w = num(s.windSpeedKmh);
      return [1, w, w * w];
    });
    const y = usable.map(s => num(s.driftSpeedKmh));
    const A = Array.from({ length: 3 }, () => [0, 0, 0]);
    const b = [0, 0, 0];
    for (let i = 0; i < X.length; i++) {
      for (let r = 0; r < 3; r++) {
        b[r] += X[i][r] * y[i];
        for (let c = 0; c < 3; c++) A[r][c] += X[i][r] * X[i][c];
      }
    }
    A[0][0] += lambda;
    A[1][1] += lambda;
    A[2][2] += lambda;
    const coefficients = solveLinearSystem(A, b);
    let sse = 0;
    for (let i = 0; i < X.length; i++) {
      const pred = X[i][0] * coefficients[0] + X[i][1] * coefficients[1] + X[i][2] * coefficients[2];
      sse += (pred - y[i]) ** 2;
    }
    const rmse = Math.sqrt(sse / X.length);
    return {
      status: 'TRAINED',
      samples: X.length,
      model: { type: 'POLYNOMIAL_REGRESSION_DEGREE_2', coefficients, rmseKmh: Number(rmse.toFixed(4)) }
    };
  }

  function predictDriftSpeed(model, windSpeedKmh) {
    if (!model || model.type !== 'POLYNOMIAL_REGRESSION_DEGREE_2') throw new Error('A trained trajectory model is required');
    const w = num(windSpeedKmh);
    if (!Number.isFinite(w)) throw new Error('Valid wind speed is required');
    const [b0, b1, b2] = model.coefficients;
    return Math.max(0, b0 + b1 * w + b2 * w * w);
  }

  /**
   * Predict using a TRAINED polynomial model. Wind is mandatory.
   * Open-Meteo direction is FROM-direction, so drift uses the opposite bearing.
   */
  function predict(berg, weather = {}, hours = 24, options = {}) {
    if (!berg || !finite(berg.lat) || !finite(berg.lon)) throw new Error('Invalid iceberg observation');
    if (!finite(weather.wind) || !finite(weather.dir)) {
      return { status: 'INSUFFICIENT_DATA', reason: 'Wind speed and direction are required; no zero-value imputation is permitted.' };
    }
    const model = options.model;
    if (!model) {
      return { status: 'MODEL_NOT_TRAINED', reason: 'No validated trajectory regression model is loaded.' };
    }
    const horizon = clamp(num(hours) || 24, 1, 168);
    const driftSpeedKmh = predictDriftSpeed(model, weather.wind);
    const distanceKm = driftSpeedKmh * horizon;
    const driftBearing = (num(weather.dir) + 180) % 360;
    const point = destinationPoint(berg, driftBearing, distanceKm);
    const modelRmse = Math.max(0, num(model.rmseKmh) || 0);
    const uncertaintyKm = clamp(modelRmse * horizon, 5, 250);
    return {
      ...point,
      hours: horizon,
      driftSpeedKmh: Number(driftSpeedKmh.toFixed(3)),
      uncertaintyKm: Number(uncertaintyKm.toFixed(1)),
      method: 'Polynomial regression trajectory model',
      status: 'MODELLED_NOT_OBSERVED'
    };
  }

  function routeScore(route, predictions = [], options = {}) {
    if (!Array.isArray(route) || route.length < 2) throw new Error('Route requires at least two points');
    let distanceKm = 0;
    let minimumClearanceKm = Infinity;
    const safetyRadiusKm = Math.max(1, num(options.safetyRadiusKm) || 20);
    const steps = clamp(Math.floor(num(options.interpolationSteps) || 10), 2, 100);

    for (let i = 1; i < route.length; i++) {
      const start = route[i - 1];
      const end = route[i];
      const segmentKm = haversine(start, end);
      if (!Number.isFinite(segmentKm)) continue;
      distanceKm += segmentKm;

      // Sample the complete segment, including both endpoints, to eliminate midpoint blind spots.
      for (let j = 0; j <= steps; j++) {
        const fraction = j / steps;
        const checkPoint = {
          lat: num(start.lat) + (num(end.lat) - num(start.lat)) * fraction,
          lon: num(start.lon) + (num(end.lon) - num(start.lon)) * fraction
        };
        for (const iceberg of predictions) {
          const p = iceberg?.prediction || iceberg;
          const d = haversine(checkPoint, p);
          if (Number.isFinite(d)) minimumClearanceKm = Math.min(minimumClearanceKm, d);
        }
      }
    }

    const clearance = Number.isFinite(minimumClearanceKm) ? minimumClearanceKm : null;
    const hazardScore = clearance == null ? null : Number(clamp(1 - clearance / (safetyRadiusKm * 5), 0, 1).toFixed(3));
    return {
      distanceKm: Number(distanceKm.toFixed(2)),
      minimumClearanceKm: clearance == null ? null : Number(clearance.toFixed(2)),
      hazardScore,
      decision: hazardScore == null ? 'INSUFFICIENT ICEBERG DATA' : hazardScore >= 0.7 ? 'REVIEW REQUIRED' : 'LOWER MODELLED ICE EXPOSURE',
      status: 'DECISION_SUPPORT_ONLY'
    };
  }

  // NSIDC South Polar Stereographic (EPSG:3412: lat_ts -70, lon0 0, Hughes 1980 ellipsoid). Maps lat/lon to the grid used by NOAA/NSIDC CDR concentration.
  function toPolarStereo(lat, lon) {
    const a = 6378273, e = 0.081816153, p = Math.PI / 180, phi = num(lat) * p, phic = -70 * p;
    if (!finite(lat) || !finite(lon) || num(lat) >= -50 || num(lat) < -90) return null;
    const t = f => Math.tan(Math.PI / 4 + f / 2) / Math.pow((1 + e * Math.sin(f)) / (1 - e * Math.sin(f)), e / 2);
    const m = f => Math.cos(f) / Math.sqrt(1 - e * e * Math.sin(f) ** 2);
    const rho = a * m(phic) * t(phi) / t(phic), l = num(lon) * p;
    return { x: rho * Math.sin(l), y: rho * Math.cos(l) };
  }

  /* Physics baseline (NOT trained): drift = ocean current + k * 10 m wind, k swept over 1-3 % (literature rule of thumb for iceberg wind drag).
   * Open-Meteo: wind dir = FROM, ocean current dir = heading TO. Coriolis/ice-pack/berg-shape effects ignored, so the output is a range, not a point. */
  function predictPhysical(berg, weather = {}, current = null, hours = 24) {
    if (!berg || !finite(berg.lat) || !finite(berg.lon)) throw new Error('Invalid iceberg observation');
    if (!weather || !finite(weather.wind) || !finite(weather.dir) || !current || !finite(current.speedKmh) || !finite(current.toDir)) {
      return { status: 'INSUFFICIENT_DATA', reason: 'Wind and ocean current are both required; nothing is imputed.' };
    }
    const h = clamp(num(hours) || 24, 1, 72), p = Math.PI / 180, wTo = (num(weather.dir) + 180) * p, cTo = num(current.toDir) * p;
    const at = k => {
      const e = num(current.speedKmh) * Math.sin(cTo) + k * num(weather.wind) * Math.sin(wTo), n = num(current.speedKmh) * Math.cos(cTo) + k * num(weather.wind) * Math.cos(wTo);
      return destinationPoint(berg, ((Math.atan2(e, n) / p) + 360) % 360, Math.hypot(e, n) * h);
    };
    const mid = at(0.02), lo = at(0.01), hi = at(0.03);
    return { ...mid, hours: h, uncertaintyKm: Number(Math.max(haversine(mid, lo), haversine(mid, hi)).toFixed(1)), method: 'Physics baseline: current + 1-3 % wind drag (unvalidated)', status: 'MODELLED_NOT_OBSERVED' };
  }

  function fromPolarStereo(x, y) {
    const a = 6378273, e = 0.081816153, p = Math.PI / 180, pc = 70 * p;
    const base = f => (1 - e * Math.sin(f)) / (1 + e * Math.sin(f));
    const t = f => Math.tan(Math.PI / 4 - f / 2) / Math.pow(base(f), e / 2);
    const m = f => Math.cos(f) / Math.sqrt(1 - e * e * Math.sin(f) ** 2);
    const tt = Math.hypot(x, y) * t(pc) / (a * m(pc));
    let f = Math.PI / 2 - 2 * Math.atan(tt);
    for (let i = 0; i < 8; i++) f = Math.PI / 2 - 2 * Math.atan(tt * Math.pow(base(f), e / 2));
    return { lat: -f / p, lon: Math.atan2(x, y) / p };
  }

  function quantile(values, q) {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return NaN;
    const i = clamp(q, 0, 1) * (v.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo);
  }

  /* Learned sea-ice extent forecaster (supervised): fits anomaly-persistence coefficient beta_h by least squares on training years,
   * forecast = climatology(t+h) + beta_h * anomaly(t). Final `testYears` are held out and scored against persistence and climatology. */
  const DAY = 864e5, doyOf = d => Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY);
  function trainExtentForecaster(recs, opts = {}) {
    const horizons = opts.horizons || [7, 30], testYears = opts.testYears || 3;
    if (!Array.isArray(recs) || recs.length < 2000) return { status: 'INSUFFICIENT_DATA' };
    const map = new Map(recs.map(r => [r.date.getTime(), r.extent])), last = recs[recs.length - 1].date;
    const cut = Date.UTC(last.getUTCFullYear() - testYears, last.getUTCMonth(), last.getUTCDate());
    const train = recs.filter(r => r.date.getTime() < cut), test = recs.filter(r => r.date.getTime() >= cut);
    const sum = new Array(366).fill(0), cnt = new Array(366).fill(0);
    train.forEach(r => { const k = doyOf(r.date); sum[k] += r.extent; cnt[k]++; });
    const raw = sum.map((s, i) => cnt[i] ? s / cnt[i] : null);
    const clim = raw.map((_, i) => { let s = 0, c = 0; for (let j = -3; j <= 3; j++) { const v = raw[(i + j + 366) % 366]; if (v != null) { s += v; c++; } } return c ? s / c : null; });
    const climAt = d => clim[doyOf(d)], anom = r => r.extent - climAt(r.date), res = { status: 'TRAINED', testFrom: new Date(cut), horizons: {} };
    for (const h of horizons) {
      let sxy = 0, sxx = 0;
      for (const r of train) { const f = map.get(r.date.getTime() + h * DAY); if (f == null) continue; const a0 = anom(r), a1 = f - climAt(new Date(r.date.getTime() + h * DAY)); if (Number.isFinite(a0) && Number.isFinite(a1)) { sxy += a0 * a1; sxx += a0 * a0; } }
      const beta = sxx > 0 ? sxy / sxx : 0; let n = 0, eP = 0, eC = 0, eM = 0;
      for (const r of test) { const td = new Date(r.date.getTime() + h * DAY), f = map.get(td.getTime()); if (f == null || climAt(td) == null) continue; n++; eP += Math.abs(f - r.extent); eC += Math.abs(f - climAt(td)); eM += Math.abs(f - (climAt(td) + beta * anom(r))); }
      res.horizons[h] = { beta, n, maePersistence: n ? eP / n : NaN, maeClimatology: n ? eC / n : NaN, maeModel: n ? eM / n : NaN };
    }
    res.forecast = h => { const l = recs[recs.length - 1], td = new Date(l.date.getTime() + h * DAY); return { date: td, extent: climAt(td) + res.horizons[h].beta * anom(l) }; };
    return res;
  }

  /* Drift backtest harness: cases = [{from:{lat,lon}, to:{lat,lon} (OBSERVED later position), ...inputs}], predictor(case) -> {lat,lon}.
   * Reports mean error vs the observed position and vs the no-move baseline. Needs real historical tracks + forcing to be meaningful. */
  function backtestDrift(cases, predictor) {
    const em = [], eb = [];
    for (const c of cases || []) { const p = predictor(c); if (!p || !finite(p.lat) || !finite(p.lon)) continue; em.push(haversine(p, c.to)); eb.push(haversine(c.from, c.to)); }
    if (!em.length) return { n: 0 };
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    return { n: em.length, maeModelKm: mean(em), maeNoMoveKm: mean(eb), skill: 1 - mean(em) / mean(eb) };
  }

  window.IceGuardAI = Object.freeze({
    fromPolarStereo, quantile, trainExtentForecaster, backtestDrift,
    toPolarStereo,
    predictPhysical,
    featureVector,
    normalizedDistance,
    anomalyScore,
    trainTrajectoryModel,
    predictDriftSpeed,
    destinationPoint,
    predict,
    routeScore,
    haversine,
    clamp
  });
})();
