// EdgeOne Pages Edge Function -> /api/icebergs. Relays the BYU/NASA SCP current Antarctic iceberg position page unchanged.
export default async function onRequest(context) {
  try {
    const r = await fetch('https://www.scp.byu.edu/current_icebergs.html');
    if (!r.ok) return new Response('BYU SCP HTTP ' + r.status, { status: 502, headers: { 'access-control-allow-origin': '*' } });
    return new Response(await r.text(), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' } });
  } catch (e) { return new Response('BYU SCP unavailable', { status: 502, headers: { 'access-control-allow-origin': '*' } }); }
}
