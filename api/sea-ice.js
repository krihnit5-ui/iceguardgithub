// Same-origin proxy for the official NSIDC daily Southern Hemisphere extent CSV.
// Deploy on a host that supports Node.js serverless functions (for example Vercel).
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).send('Method Not Allowed'); }
  try {
    const upstream = await fetch('https://noaadata.apps.nsidc.org/NOAA/G02135/south/daily/data/S_seaice_extent_daily_v4.0.csv', { signal: AbortSignal.timeout(15000) });
    if (!upstream.ok) return res.status(502).send(`NSIDC upstream returned HTTP ${upstream.status}`);
    const csv = await upstream.text();
    if (!csv || csv.length < 1000) return res.status(502).send('NSIDC response was unexpectedly short');
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(502).send(`NSIDC data unavailable: ${String(error?.message || error).slice(0, 180)}`);
  }
}
