'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

const router = express.Router();

function formatProject(row) {
  return {
    ...row,
    flavours:       JSON.parse(row.flavours || '[]'),
    archived:       !!row.archived,
    coverElementId: row.cover_element_id || '',
  };
}

// ── GET /api/projects ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const includeArchived = req.query.archived === '1';
  const rows = includeArchived
    ? db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY created_at DESC').all();
  res.json(rows.map(formatProject));
});

// ── GET /api/projects/:id ─────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db  = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Project not found' });
  res.json(formatProject(row));
});

// ── POST /api/projects ────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { name, bpm, key, flavours, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

  const db  = getDb();
  const id  = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, name, bpm, key, flavours, description, created_at, archived, cover_element_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, '')
  `).run(
    id, name.trim(), bpm || '', key || '',
    JSON.stringify(Array.isArray(flavours) ? flavours : []),
    description || '', now,
  );

  res.status(201).json(formatProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(id)));
});

// ── PATCH /api/projects/:id ───────────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  const db  = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Project not found' });

  const { name, bpm, key, flavours, description, archived, coverElementId } = req.body || {};

  const updated = {
    name:             name            !== undefined ? name.trim()                                              : row.name,
    bpm:              bpm             !== undefined ? bpm                                                      : row.bpm,
    key:              key             !== undefined ? key                                                      : row.key,
    flavours:         flavours        !== undefined ? JSON.stringify(Array.isArray(flavours) ? flavours : [])  : row.flavours,
    description:      description     !== undefined ? description                                              : row.description,
    archived:         archived        !== undefined ? (archived ? 1 : 0)                                      : row.archived,
    cover_element_id: coverElementId  !== undefined ? coverElementId                                          : (row.cover_element_id || ''),
  };

  if (!updated.name) return res.status(400).json({ error: 'name cannot be empty' });

  db.prepare(`
    UPDATE projects
    SET name=?, bpm=?, key=?, flavours=?, description=?, archived=?, cover_element_id=?
    WHERE id=?
  `).run(
    updated.name, updated.bpm, updated.key, updated.flavours,
    updated.description, updated.archived, updated.cover_element_id,
    req.params.id,
  );

  res.json(formatProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)));
});

// ── DELETE /api/projects/:id ──────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const db  = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Project not found' });

  const deleteAll = db.transaction(() => {
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
