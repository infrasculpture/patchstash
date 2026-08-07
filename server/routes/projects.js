'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

const router = express.Router();

// ── GET /api/projects ─────────────────────────────────────────────────────────
// Returns active projects by default. Pass ?archived=1 to include archived ones.
router.get('/', (req, res) => {
  const db = getDb();
  const includeArchived = req.query.archived === '1';
  const rows = includeArchived
    ? db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY created_at DESC').all();

  // flavours is stored as a JSON string — parse it for the response
  const projects = rows.map(p => ({
    ...p,
    flavours: JSON.parse(p.flavours || '[]'),
    archived: !!p.archived,
  }));
  res.json(projects);
});

// ── GET /api/projects/:id ─────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Project not found' });
  res.json({ ...row, flavours: JSON.parse(row.flavours || '[]'), archived: !!row.archived });
});

// ── POST /api/projects ────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { name, bpm, key, flavours, description } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const db  = getDb();
  const id  = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, name, bpm, key, flavours, description, created_at, archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    id,
    name.trim(),
    bpm || '',
    key || '',
    JSON.stringify(Array.isArray(flavours) ? flavours : []),
    description || '',
    now,
  );

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.status(201).json({ ...row, flavours: JSON.parse(row.flavours), archived: false });
});

// ── PATCH /api/projects/:id ───────────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Project not found' });

  const { name, bpm, key, flavours, description, archived } = req.body || {};

  const updated = {
    name:        name        !== undefined ? name.trim()                                     : row.name,
    bpm:         bpm         !== undefined ? bpm                                              : row.bpm,
    key:         key         !== undefined ? key                                              : row.key,
    flavours:    flavours    !== undefined ? JSON.stringify(Array.isArray(flavours) ? flavours : []) : row.flavours,
    description: description !== undefined ? description                                      : row.description,
    archived:    archived    !== undefined ? (archived ? 1 : 0)                              : row.archived,
  };

  if (!updated.name) return res.status(400).json({ error: 'name cannot be empty' });

  db.prepare(`
    UPDATE projects SET name = ?, bpm = ?, key = ?, flavours = ?, description = ?, archived = ?
    WHERE id = ?
  `).run(updated.name, updated.bpm, updated.key, updated.flavours, updated.description, updated.archived, req.params.id);

  const out = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json({ ...out, flavours: JSON.parse(out.flavours), archived: !!out.archived });
});

// ── DELETE /api/projects/:id ──────────────────────────────────────────────────
// Hard-deletes a project and all its elements + log entries.
// Files on disk are NOT automatically removed here — that is handled by the
// files route. This is intentional: deletion is a two-step process and the UI
// should call the file cleanup endpoint first if needed.
router.delete('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Project not found' });

  const deleteAll = db.transaction(() => {
    // Delete log entries for all elements in this project
    db.prepare(`
      DELETE FROM status_log WHERE element_id IN (
        SELECT id FROM elements WHERE project_id = ?
      )
    `).run(req.params.id);
    db.prepare('DELETE FROM elements WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  });
  deleteAll();

  res.json({ ok: true });
});

module.exports = router;
