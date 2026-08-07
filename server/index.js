'use strict';

const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');

const { requireAuth }  = require('./auth');
const loginRoutes      = require('./routes/login');
const layerRoutes      = require('./routes/layers');
const projectRoutes    = require('./routes/projects');
const elementRoutes    = require('./routes/elements');
const fileRoutes       = require('./routes/files');
const exportRoutes     = require('./routes/export');

// Initialise the database (runs migrations + seed) before the server starts
require('./db').getDb();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cookieParser());
app.use(express.json());

// Auth gate — sits in front of everything. Passes through to next handler
// if auth is disabled or if the session is valid.
app.use(requireAuth);

// ── API routes ─────────────────────────────────────────────────────────────────
app.use('/api',          loginRoutes);
app.use('/api/layers',   layerRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api',          elementRoutes);   // mounts /api/projects/:id/elements and /api/elements/:id
app.use('/api',          fileRoutes);      // mounts /api/elements/:id/files/:slot
app.use('/api/export',   exportRoutes);

// ── Static frontend ────────────────────────────────────────────────────────────
// Serves public/ for all non-API routes. The single-page app handles its own
// client-side routing.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Catch-all: return index.html for any non-API route so that direct navigation
// to a deep URL (e.g. /projects/abc) works without a 404.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const authMode = process.env.AUTH_PASSWORD ? 'password-protected' : 'open (no AUTH_PASSWORD set)';
  console.log(`[patchstash] Listening on port ${PORT} — ${authMode}`);
});
