// EdgeOne Pages Edge Function -> served at /api/sea-ice (same origin as the site, so no CORS problem).
// Relays the unmodified official NSIDC daily Southern Hemisphere extent CSV.
const URLS = [
  'https://noaadata.apps.nsidc.org/NOAA/G02135/south/daily/data/S_seaice_extent_daily_v4.0.csv',
  'https://masie_web.apps.nsidc.org/pub/DATASETS/NOAA/G02135/south/daily/data/S_seaice_extent_daily_v4.0.csv'
];
export default async function onRequest(context) {
  const errors = [];
  for (const url of URLS) {
    try {
      const upstream = await fetch(url);
      if (!upstream.ok) { errors.push(`HTTP ${upstream.status}`); continue; }
      const csv = await upstream.text();
      if (csv.length < 10000) { errors.push('response too short'); continue; }
      return new Response(csv, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'public, max-age=1800', 'access-control-allow-origin': '*' } });
    } catch (e) { errors.push(String(e && e.message || e).slice(0, 120)); }
  }
  return new Response('NSIDC unavailable: ' + errors.join(' | '), { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });
}
