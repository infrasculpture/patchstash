'use strict';

const crypto = require('crypto');

// ── Session store ─────────────────────────────────────────────────────────────
// In-memory map of sessionId → { createdAt }. Simple and correct for a single-
// process app with a small number of users. Sessions are lost on container
// restart, which just means the user has to log in again — acceptable.
const sessions = new Map();

const SESSION_COOKIE = 'ps_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function createSession() {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, { createdAt: Date.now() });
  return id;
}

function isValidSession(id) {
  if (!id) return false;
  const s = sessions.get(id);
  if (!s) return false;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return false;
  }
  return true;
}

function destroySession(id) {
  sessions.delete(id);
}

// ── Auth middleware ───────────────────────────────────────────────────────────
// If AUTH_PASSWORD is not set in the environment, authentication is completely
// disabled — correct for Tailscale-gated deployments where network membership
// is the security boundary.
//
// If AUTH_PASSWORD is set, every request is checked for a valid session cookie.
// Unauthenticated requests to API routes get a 401 JSON response.
// Unauthenticated requests to the frontend get the login page served instead.

function requireAuth(req, res, next) {
  const password = process.env.AUTH_PASSWORD;

  // Auth disabled — pass through unconditionally
  if (!password) return next();

  // Login endpoint is always open
  if (req.path === '/api/login') return next();

  // Check session cookie
  const sessionId = req.cookies && req.cookies[SESSION_COOKIE];
  if (isValidSession(sessionId)) return next();

  // Not authenticated
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // For browser navigation requests, serve the login page
  // (the frontend will show the login form when it sees no valid session)
  return next();
}

// ── Login / logout route handlers ─────────────────────────────────────────────
function handleLogin(req, res) {
  const password = process.env.AUTH_PASSWORD;

  // If auth is disabled, login always succeeds
  if (!password) {
    return res.json({ ok: true, authEnabled: false });
  }

  const { password: submitted } = req.body || {};
  if (!submitted || submitted !== password) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const sessionId = createSession();
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    // secure: true only when behind HTTPS — set this if you put nginx/Caddy in front
    maxAge: SESSION_TTL_MS,
  });

  return res.json({ ok: true, authEnabled: true });
}

function handleLogout(req, res) {
  const sessionId = req.cookies && req.cookies[SESSION_COOKIE];
  if (sessionId) destroySession(sessionId);
  res.clearCookie(SESSION_COOKIE);
  return res.json({ ok: true });
}

function handleAuthStatus(req, res) {
  const password = process.env.AUTH_PASSWORD;
  const sessionId = req.cookies && req.cookies[SESSION_COOKIE];
  return res.json({
    authEnabled: !!password,
    authenticated: !password || isValidSession(sessionId),
  });
}

module.exports = { requireAuth, handleLogin, handleLogout, handleAuthStatus };
