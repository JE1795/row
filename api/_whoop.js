// Shared WHOOP OAuth helpers for the /api functions.
// The client secret lives ONLY in the Vercel environment variable
// WHOOP_CLIENT_SECRET — never in this repo.
const CLIENT_ID = process.env.WHOOP_CLIENT_ID || '11e41849-8237-4b65-9a9a-653de4f22a77';
const REDIRECT_URI = process.env.WHOOP_REDIRECT_URI || 'https://row-jje9.vercel.app/api/whoop-callback';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

async function tokenRequest(params) {
  const secret = process.env.WHOOP_CLIENT_SECRET;
  if (!secret) return { ok: false, status: 500, error: 'server_not_configured' };
  const body = new URLSearchParams(Object.assign(
    { client_id: CLIENT_ID, client_secret: secret }, params));
  let r, json = null;
  try {
    r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    try { json = await r.json(); } catch (e) {}
  } catch (e) {
    return { ok: false, status: 502, error: 'whoop_unreachable' };
  }
  if (!r.ok || !json || !json.access_token) {
    return { ok: false, status: r.status, error: (json && (json.error_description || json.error)) || 'token_request_failed' };
  }
  return {
    ok: true,
    tokens: {
      access_token: json.access_token,
      refresh_token: json.refresh_token || null,
      expires_in: json.expires_in || 3600,
    },
  };
}

module.exports = { REDIRECT_URI, tokenRequest };
