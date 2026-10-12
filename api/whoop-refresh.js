// Swaps a WHOOP refresh token for a fresh access token. Needs the
// client secret, which is why it can't be done from the browser.
const { tokenRequest } = require('./_whoop');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const refreshToken = body && body.refresh_token;
  if (!refreshToken) return res.status(400).json({ error: 'missing_refresh_token' });

  const result = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: String(refreshToken),
    scope: 'offline',
  });
  if (!result.ok) {
    const status = result.status >= 500 ? result.status : 401;
    return res.status(status).json({ error: result.error });
  }
  res.status(200).json(result.tokens);
};
