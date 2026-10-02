import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../ai-engine.js', import.meta.url), 'utf8');
const context = { window: {}, Math, Number, Date, console };
vm.runInNewContext(source, context);
const AI = context.window.IceGuardAI;
assert(AI, 'AI engine must expose IceGuardAI');

const rows = [
  [-64.0, 55.0, 0, 10, 180, 1000],
  [-64.2, 55.1, 0, 11, 182, 1002],
  [-64.1, 55.3, 0, 9, 178, 999],
  [-64.3, 55.2, 0, 10, 181, 1001],
  [-64.2, 55.4, 0, 12, 179, 1000],
  [-70.0, 20.0, 0, 60, 30, 950]
];
const anomaly = AI.anomalyScore(rows, rows[5], { k: 4 });
assert(['ELEVATED', 'ANOMALOUS'].includes(anomaly.label));

// Missing environmental data must not be silently converted to zero.
assert.equal(AI.featureVector({ lat: -64, lon: 55, area: 10 }, { dir: 0, pressure: 1000 }), null);
assert.equal(AI.featureVector({ lat: -64, lon: 55, area: 10 }, { wind: 10, dir: 0, pressure: 1000 }).length, 6);

// Train a small polynomial regression from supplied REAL-style samples.
const samples = Array.from({ length: 12 }, (_, i) => {
  const wind = 5 + i * 2;
  return { windSpeedKmh: wind, driftSpeedKmh: 0.12 + 0.008 * wind + 0.0004 * wind * wind };
});
const trained = AI.trainTrajectoryModel(samples);
assert.equal(trained.status, 'TRAINED');
assert.equal(trained.model.type, 'POLYNOMIAL_REGRESSION_DEGREE_2');
assert(Number.isFinite(trained.model.rmseKmh));

const prediction = AI.predict(
  { lat: -64, lon: -55 },
  { wind: 20, dir: 90 },
  24,
  { model: trained.model }
);
assert.equal(prediction.status, 'MODELLED_NOT_OBSERVED');
assert(Number.isFinite(prediction.lat));
assert(Number.isFinite(prediction.lon));
assert(Number.isFinite(prediction.uncertaintyKm));

const missingPrediction = AI.predict({ lat: -64, lon: -55 }, { dir: 90 }, 24, { model: trained.model });
assert.equal(missingPrediction.status, 'INSUFFICIENT_DATA');

const noModel = AI.predict({ lat: -64, lon: -55 }, { wind: 20, dir: 90 }, 24);
assert.equal(noModel.status, 'MODEL_NOT_TRAINED');

// Route edge case: iceberg at the START of a long segment must be detected.
const route = AI.routeScore(
  [{ lat: -64, lon: -55 }, { lat: -64, lon: -50 }],
  [{ lat: -64, lon: -55 }],
  { safetyRadiusKm: 20, interpolationSteps: 10 }
);
assert.equal(route.status, 'DECISION_SUPPORT_ONLY');
assert.equal(route.minimumClearanceKm, 0);
assert.equal(route.decision, 'REVIEW REQUIRED');

// Polar projection sanity: longitude remains normalized and finite.
const polar = AI.destinationPoint({ lat: -89.5, lon: 0 }, 90, 50);
assert(Number.isFinite(polar.lat));
assert(Number.isFinite(polar.lon));
assert(polar.lon >= -180 && polar.lon <= 180);

console.log('PASS: AI anomaly, trained regression, missing-data guard, polar projection and route DSS tests');

// Polar stereographic: pole at origin, 70S at ~2.19e6 m, 0E on +y axis, 90E on +x axis.
const pole = AI.toPolarStereo(-90, 0); assert(Math.abs(pole.x) < 1 && Math.abs(pole.y) < 1);
const p70 = AI.toPolarStereo(-70, 0); assert(Math.abs(p70.x) < 1 && p70.y > 2.1e6 && p70.y < 2.3e6);
const p90 = AI.toPolarStereo(-70, 90); assert(p90.x > 2.1e6 && Math.abs(p90.y) < 1);
assert.equal(AI.toPolarStereo(10, 0), null);
// Physics baseline: eastward current only (toDir 90) moves the berg east; missing current fails closed; range is positive.
const ph = AI.predictPhysical({ lat: -64, lon: -55 }, { wind: 0, dir: 0 }, { speedKmh: 1, toDir: 90 }, 24);
assert.equal(ph.status, 'MODELLED_NOT_OBSERVED'); assert(ph.lon > -55 && Math.abs(ph.lat + 64) < 0.05);
assert.equal(AI.predictPhysical({ lat: -64, lon: -55 }, { wind: 10, dir: 0 }, null).status, 'INSUFFICIENT_DATA');
const wd = AI.predictPhysical({ lat: -64, lon: -55 }, { wind: 30, dir: 270 }, { speedKmh: 0.5, toDir: 90 }, 24); assert(wd.uncertaintyKm > 0);
console.log('PASS: polar projection and physics drift baseline');

// --- inverse projection round trip
for (const [la, lo] of [[-62.2, -58.6], [-75, 120], [-55, -170], [-85, 10]]) { const q = AI.toPolarStereo(la, lo), r = AI.fromPolarStereo(q.x, q.y); assert(Math.abs(r.lat - la) < 1e-6 && Math.abs(Math.abs(r.lon - lo) % 360) < 1e-6 || Math.abs(Math.abs(r.lon - lo) - 360) < 1e-6, `roundtrip ${la},${lo}`); }
assert.equal(AI.quantile([1, 2, 3, 4, 5], 0.5), 3);

// --- extent forecaster on a SYNTHETIC seasonal series (code-path test only; real data is used in the browser)
const recs = []; let noise = 0, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
for (let t = Date.UTC(1988, 0, 1); t <= Date.UTC(2024, 11, 31); t += 864e5) { const d = new Date(t), doy = (t - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5; noise = 0.97 * noise + 0.05 * rnd(); recs.push({ date: d, extent: 11 + 7 * Math.sin((doy - 100) / 365 * 2 * Math.PI) + noise }); }
const fm = AI.trainExtentForecaster(recs); assert.equal(fm.status, 'TRAINED');
assert(fm.horizons[30].n > 500 && fm.horizons[30].maeModel < fm.horizons[30].maePersistence, 'forecaster must beat persistence at 30 d on seasonal data');
assert(Number.isFinite(fm.forecast(7).extent));
assert.equal(AI.trainExtentForecaster(recs.slice(0, 50)).status, 'INSUFFICIENT_DATA');

// --- drift backtest metric: perfect predictor beats a no-move baseline
const bt = AI.backtestDrift([{ from: { lat: -64, lon: -55 }, to: { lat: -64.2, lon: -55 } }], c => c.to); assert.equal(bt.n, 1); assert(bt.maeModelKm < 1e-6 && bt.skill > 0.99);

// --- BYU parser: DMS strings copied from the live page (scp.byu.edu/current_icebergs.html, revised 09/14/26)
import fs2 from 'node:fs';
const src = fs2.readFileSync(new URL('../icebergs.js', import.meta.url), 'utf8'), dmsSrc = /const dms = (.*?);\n/.exec(src)[1], dms = eval(dmsSrc);
assert(Math.abs(dms("47 20'W") + 47.3333) < 1e-3 && Math.abs(dms("57 24'S") + 57.4) < 1e-6 && Math.abs(dms("143 13'E") - 143.2167) < 1e-3 && Number.isNaN(dms('n/a')));
console.log('PASS: inverse projection, extent forecaster, drift backtest harness, BYU DMS parsing');
