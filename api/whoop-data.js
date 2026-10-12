// Fetches the latest recovery / sleep / cycle records from WHOOP using
// the access token the browser sends, and returns them as one payload.
const API = 'https://api.prod.whoop.com/developer/v2';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const auth = req.headers.authorization || '';
  if (auth.indexOf('Bearer ') !== 0) return res.status(401).json({ error: 'missing_token' });

  const get = async (path) => {
    const r = await fetch(API + path, { headers: { Authorization: auth } });
    let json = null;
    try { json = await r.json(); } catch (e) {}
    return { status: r.status, ok: r.ok, records: (json && json.records) || [] };
  };

  try {
    const [recovery, sleep, cycle] = await Promise.all([
      get('/recovery?limit=10'),
      get('/activity/sleep?limit=10'),
      get('/cycle?limit=1'),
    ]);
    const all = [recovery, sleep, cycle];
    if (all.some((x) => x.status === 401)) return res.status(401).json({ error: 'token_expired' });
    if (all.every((x) => !x.ok)) return res.status(502).json({ error: 'whoop_error', status: recovery.status });
    res.status(200).json({
      recovery: recovery.records,
      sleep: sleep.records,
      cycle: cycle.records[0] || null,
    });
  } catch (e) {
    res.status(502).json({ error: 'whoop_unreachable' });
  }
};
