export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing bearer token' });
  const path = (req.query && req.query.path) || '';
  if (!path || !path.startsWith('/')) return res.status(400).json({ error: 'path required' });
  const fwd = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k !== 'path') fwd.set(k, String(v));
  }
  const qs = fwd.toString();
  const V1 = 'https://api.prod.whoop.com/developer/v1';
  const V2 = 'https://api.prod.whoop.com/developer/v2';
  const isCycle = path.startsWith('/cycle');
  const call = (base) => fetch(base + path + (qs ? '?' + qs : ''), {
    headers: { 'Authorization': auth, 'Accept': 'application/json' },
  });
  try {
    let r = await call(isCycle ? V1 : V2);
    // If WHOOP has retired the v1 cycle endpoint, fall back to v2.
    if (isCycle && !r.ok && r.status !== 401 && r.status !== 429) r = await call(V2);
    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json');
    return res.send(text);
  } catch (e) {
    return res.status(500).json({ error: 'proxy fetch failed: ' + (e.message || String(e)) });
  }
}
