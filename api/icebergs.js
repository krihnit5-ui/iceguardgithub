// Vercel serverless twin of edge-functions/api/icebergs.js
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
  try {
    const r = await fetch('https://www.scp.byu.edu/current_icebergs.html', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return res.status(502).send('BYU SCP HTTP ' + r.status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(200).send(await r.text());
  } catch (e) { return res.status(502).send('BYU SCP unavailable'); }
}
