'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

const router = express.Router();

// ── GET /api/layers ───────────────────────────────────────────────────────────
// Returns all layers ordered by ord. Archived layers are included so the UI
// can display them greyed-out where elements still reference them.
router.get('/', (req, res) => {
  const db = getDb();
  const layers = db.prepare(
    'SELECT * FROM layers ORDER BY ord ASC, name ASC'
  ).all();
  res.json(layers);
});

// ── POST /api/layers ──────────────────────────────────────────────────────────
// Create a new layer.
router.post('/', (req, res) => {
  const { name, colour } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const db = getDb();

  // Place the new layer at the end of the current order
  const maxOrd = db.prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM layers').get().m;

  const id = uuidv4();
  db.prepare(
    'INSERT INTO layers (id, name, colour, ord, archived) VALUES (?, ?, ?, ?, 0)'
  ).run(id, name.trim(), colour || '#888888', maxOrd + 1);

  const layer = db.prepare('SELECT * FROM layers WHERE id = ?').get(id);
  res.status(201).json(layer);
});

// ── PATCH /api/layers/:id ─────────────────────────────────────────────────────
// Update name, colour, ord, or archived flag. Partial update — only supplied
// fields are changed.
router.patch('/:id', (req, res) => {
  const db = getDb();
  const layer = db.prepare('SELECT * FROM layers WHERE id = ?').get(req.params.id);
  if (!layer) return res.status(404).json({ error: 'Layer not found' });

  const { name, colour, ord, archived } = req.body || {};

  const updated = {
    name:     name     !== undefined ? name.trim()      : layer.name,
    colour:   colour   !== undefined ? colour            : layer.colour,
    ord:      ord      !== undefined ? Number(ord)       : layer.ord,
    archived: archived !== undefined ? (archived ? 1 : 0) : layer.archived,
  };

  if (!updated.name) return res.status(400).json({ error: 'name cannot be empty' });

  db.prepare(`
    UPDATE layers SET name = ?, colour = ?, ord = ?, archived = ? WHERE id = ?
  `).run(updated.name, updated.colour, updated.ord, updated.archived, req.params.id);

  res.json(db.prepare('SELECT * FROM layers WHERE id = ?').get(req.params.id));
});

// ── DELETE /api/layers/:id ────────────────────────────────────────────────────
// Hard-deletes a layer only if no elements currently reference it.
// If elements still reference it, returns a 409 with a count so the UI
// can offer the archive or migrate options instead.
router.delete('/:id', (req, res) => {
  const db = getDb();
  const layer = db.prepare('SELECT * FROM layers WHERE id = ?').get(req.params.id);
  if (!layer) return res.status(404).json({ error: 'Layer not found' });

  const refCount = db.prepare(
    'SELECT COUNT(*) AS n FROM elements WHERE layer_id = ?'
  ).get(req.params.id).n;

  if (refCount > 0) {
    return res.status(409).json({
      error: 'Layer is still referenced by elements',
      elementCount: refCount,
    });
  }

  db.prepare('DELETE FROM layers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── POST /api/layers/:id/migrate ─────────────────────────────────────────────
// Moves all elements from one layer to another, then hard-deletes the source.
// Used by the "migrate then delete" flow in Layer Management.
router.post('/:id/migrate', (req, res) => {
  const { targetLayerId } = req.body || {};
  if (!targetLayerId) {
    return res.status(400).json({ error: 'targetLayerId is required' });
  }

  const db = getDb();
  const source = db.prepare('SELECT * FROM layers WHERE id = ?').get(req.params.id);
  const target = db.prepare('SELECT * FROM layers WHERE id = ?').get(targetLayerId);

  if (!source) return res.status(404).json({ error: 'Source layer not found' });
  if (!target) return res.status(404).json({ error: 'Target layer not found' });
  if (source.id === target.id) {
    return res.status(400).json({ error: 'Source and target must be different' });
  }

  const migrate = db.transaction(() => {
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE elements SET layer_id = ?, updated_at = ? WHERE layer_id = ?'
    ).run(targetLayerId, now, req.params.id);
    db.prepare('DELETE FROM layers WHERE id = ?').run(req.params.id);
  });
  migrate();

  res.json({ ok: true });
});

module.exports = router;
