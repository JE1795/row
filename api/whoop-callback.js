// WHOOP redirects here after login. Exchanges the one-time code for
// tokens, then hands them to health.html in the URL fragment (fragments
// are never sent to servers or written to request logs).
const { REDIRECT_URI, tokenRequest } = require('./_whoop');

module.exports = async (req, res) => {
  const q = req.query || {};
  const back = (frag) => {
    res.statusCode = 302;
    res.setHeader('Location', '/health.html#' + frag);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  };

  if (q.error || !q.code) {
    return back('whoop_error=' + encodeURIComponent(q.error_description || q.error || 'missing_code'));
  }

  const result = await tokenRequest({
    grant_type: 'authorization_code',
    code: String(q.code),
    redirect_uri: REDIRECT_URI,
  });
  if (!result.ok) return back('whoop_error=' + encodeURIComponent(result.error));

  const payload = Object.assign({ state: q.state ? String(q.state) : '' }, result.tokens);
  back('whoop_auth=' + Buffer.from(JSON.stringify(payload)).toString('base64url'));
};
