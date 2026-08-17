'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb, DATA_DIR } = require('../db');

const router = express.Router();

const VALID_STATUSES = ['new', 'under-assessment', 'selected', 'imported', 'rejected'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatElement(row) {
  if (!row) return null;
  return {
    id:              row.id,
    projectId:       row.project_id,
    title:           row.title,
    description:     row.description,
    layerId:         row.layer_id,
    sourceType:      row.source_type,
    processingState: row.processing_state,
    energyLevel:     row.energy_level,
    bpm:             row.bpm,
    key:             row.key,
    synth:           row.synth,
    bank:            row.bank,
    patch:           row.patch,
    tech:            row.tech,
    primaryFile:     row.primary_filename ? {
      filename:   row.primary_filename,
      type:       row.primary_type,
      sizeBytes:  row.primary_size,
      uploadedAt: row.primary_uploaded_at,
    } : null,
    audioFile: row.audio_filename ? {
      filename:   row.audio_filename,
      sizeBytes:  row.audio_size,
      uploadedAt: row.audio_uploaded_at,
    } : null,
    externalLink: row.external_link || '',
    status:      row.status,
    submittedBy: row.submitted_by,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

// Directory on the host volume where an element's files live.
// Matches the layout used by routes/files.js exactly — {DATA_DIR}/files/{projectId}/{elementId}
function elementDir(projectId, elementId) {
  return path.join(DATA_DIR, 'files', projectId, elementId);
}

// ── GET /api/projects/:projectId/elements ─────────────────────────────────────
// Supports filtering by status, layerId, sourceType, processingState, energyLevel.
router.get('/projects/:projectId/elements', (req, res) => {
  const db = getDb();

  // Verify project exists
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const conditions = ['project_id = ?'];
  const params = [req.params.projectId];

  const filters = {
    status:          'status',
    layerId:         'layer_id',
    sourceType:      'source_type',
    processingState: 'processing_state',
    energyLevel:     'energy_level',
  };

  for (const [queryKey, column] of Object.entries(filters)) {
    if (req.query[queryKey]) {
      conditions.push(`${column} = ?`);
      params.push(req.query[queryKey]);
    }
  }

  const rows = db.prepare(
    `SELECT * FROM elements WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`
  ).all(...params);

  res.json(rows.map(formatElement));
});

// ── GET /api/elements/:id ─────────────────────────────────────────────────────
router.get('/elements/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM elements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Element not found' });
  res.json(formatElement(row));
});

// ── GET /api/elements/:id/log ─────────────────────────────────────────────────
router.get('/elements/:id/log', (req, res) => {
  const db = getDb();
  const element = db.prepare('SELECT id FROM elements WHERE id = ?').get(req.params.id);
  if (!element) return res.status(404).json({ error: 'Element not found' });

  const entries = db.prepare(
    'SELECT * FROM status_log WHERE element_id = ? ORDER BY created_at ASC'
  ).all(req.params.id);
  res.json(entries);
});

// ── POST /api/projects/:projectId/elements ────────────────────────────────────
router.post('/projects/:projectId/elements', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const {
    title, description, layerId, sourceType, processingState,
    bpm, key, synth, bank, patch, tech, submittedBy, externalLink,
  } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }

  const id  = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO elements (
      id, project_id, title, description,
      layer_id, source_type, processing_state,
      bpm, key, synth, bank, patch, tech, external_link,
      primary_filename, primary_type, primary_size, primary_uploaded_at,
      audio_filename, audio_size, audio_uploaded_at,
      status, submitted_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      '', '', 0, '',
      '', 0, '',
      'new', ?, ?, ?
    )
  `).run(
    id, req.params.projectId, title.trim(), description || '',
    layerId || '', sourceType || '', processingState || '',
    bpm || '', key || '', synth || '', bank || '', patch || '', tech || '',
    externalLink || '',
    submittedBy || '', now, now,
  );

  res.status(201).json(formatElement(db.prepare('SELECT * FROM elements WHERE id = ?').get(id)));
});

// ── PATCH /api/elements/:id ───────────────────────────────────────────────────
// Updates metadata fields. Status changes must go through the dedicated
// status endpoint below so they always get a log entry.
router.patch('/elements/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM elements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Element not found' });

  const fields = [
    'title', 'description', 'layerId', 'sourceType', 'processingState',
    'bpm', 'key', 'synth', 'bank', 'patch', 'tech', 'submittedBy', 'externalLink',
  ];
  const columnMap = {
    title: 'title', description: 'description', layerId: 'layer_id',
    sourceType: 'source_type', processingState: 'processing_state',
    bpm: 'bpm', key: 'key',
    synth: 'synth', bank: 'bank', patch: 'patch', tech: 'tech',
    submittedBy: 'submitted_by', externalLink: 'external_link',
  };

  const setClauses = [];
  const params = [];
  const body = req.body || {};

  for (const field of fields) {
    if (body[field] !== undefined) {
      setClauses.push(`${columnMap[field]} = ?`);
      params.push(body[field]);
    }
  }

  if (!setClauses.length) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  const now = new Date().toISOString();
  setClauses.push('updated_at = ?');
  params.push(now);
  params.push(req.params.id);

  db.prepare(`UPDATE elements SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  res.json(formatElement(db.prepare('SELECT * FROM elements WHERE id = ?').get(req.params.id)));
});

// ── POST /api/elements/:id/status ─────────────────────────────────────────────
// The only way to change an element's status. Always creates a log entry.
// comment is required when the status actually changes; optional for notes
// that don't change the status (fromStatus === toStatus or toStatus is absent).
router.post('/elements/:id/status', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM elements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Element not found' });

  const { toStatus, comment, author } = req.body || {};

  const isStatusChange = toStatus && toStatus !== row.status;

  if (isStatusChange) {
    if (!VALID_STATUSES.includes(toStatus)) {
      return res.status(400).json({ error: `Invalid status: ${toStatus}` });
    }
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: 'comment is required when changing status' });
    }
  }

  const now = new Date().toISOString();

  const update = db.transaction(() => {
    if (isStatusChange) {
      db.prepare(
        'UPDATE elements SET status = ?, updated_at = ? WHERE id = ?'
      ).run(toStatus, now, req.params.id);
    }

    db.prepare(`
      INSERT INTO status_log (id, element_id, from_status, to_status, comment, author, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      req.params.id,
      isStatusChange ? row.status : null,
      isStatusChange ? toStatus   : null,
      (comment || '').trim(),
      (author  || '').trim(),
      now,
    );
  });
  update();

  const updated = db.prepare('SELECT * FROM elements WHERE id = ?').get(req.params.id);
  res.json({
    element: formatElement(updated),
    logEntry: db.prepare(
      'SELECT * FROM status_log WHERE element_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(req.params.id),
  });
});

// ── POST /api/elements/:id/move ───────────────────────────────────────────────
// Moves an element into a different project — reassigns project_id, relocates
// its files directory on the host volume, clears it as the old project's cover
// artwork if applicable, and (optionally) applies new BPM/Key values supplied
// by the caller. The element's status and log history travel with it unchanged;
// a freestanding log note records the move itself.
//
// Built for the "coffee shop capture" workflow described in the project brief:
// elements start in a general capture project with no fixed home, and later get
// moved into whichever real project they end up suiting — without re-uploading
// files or re-typing metadata.
router.post('/elements/:id/move', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM elements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Element not found' });

  const { targetProjectId, bpm, key } = req.body || {};
  if (!targetProjectId) {
    return res.status(400).json({ error: 'targetProjectId is required' });
  }
  if (targetProjectId === row.project_id) {
    return res.status(400).json({ error: 'Element is already in this project' });
  }

  const targetProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(targetProjectId);
  if (!targetProject) return res.status(404).json({ error: 'Target project not found' });

  const sourceProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.project_id);

  // Relocate the files directory on the host volume, if the element has one.
  // Uses rename (fast, same-volume move) with a copy+delete fallback in case
  // the data directory ever spans a filesystem boundary that disallows rename.
  const oldDir = elementDir(row.project_id, req.params.id);
  const newDir = elementDir(targetProjectId, req.params.id);

  if (fs.existsSync(oldDir)) {
    fs.mkdirSync(path.join(DATA_DIR, 'files', targetProjectId), { recursive: true });
    try {
      fs.renameSync(oldDir, newDir);
    } catch (err) {
      fs.cpSync(oldDir, newDir, { recursive: true });
      fs.rmSync(oldDir, { recursive: true, force: true });
    }
  }

  const now = new Date().toISOString();

  const move = db.transaction(() => {
    db.prepare(`
      UPDATE elements
      SET project_id = ?, bpm = ?, key = ?, updated_at = ?
      WHERE id = ?
    `).run(
      targetProjectId,
      bpm !== undefined ? bpm : row.bpm,
      key !== undefined ? key : row.key,
      now,
      req.params.id,
    );

    // If this element was the source project's cover artwork, clear that
    // reference — the file (and the element) no longer lives there.
    db.prepare(
      `UPDATE projects SET cover_element_id = '' WHERE id = ? AND cover_element_id = ?`
    ).run(row.project_id, req.params.id);

    // Freestanding log note recording the move — no status change, so
    // from_status/to_status stay null per the existing log convention.
    db.prepare(`
      INSERT INTO status_log (id, element_id, from_status, to_status, comment, author, created_at)
      VALUES (?, ?, NULL, NULL, ?, '', ?)
    `).run(
      uuidv4(),
      req.params.id,
      `Moved from "${sourceProject ? sourceProject.name : 'a previous project'}" to "${targetProject.name}".`,
      now,
    );
  });
  move();

  const updated = db.prepare('SELECT * FROM elements WHERE id = ?').get(req.params.id);
  res.json(formatElement(updated));
});

// ── DELETE /api/elements/:id ──────────────────────────────────────────────────
// Deletes the element and its log entries from the database.
// Does NOT delete files from disk — caller should delete files first via the
// files route if desired.
router.delete('/elements/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM elements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Element not found' });

  const del = db.transaction(() => {
    db.prepare('DELETE FROM status_log WHERE element_id = ?').run(req.params.id);
    db.prepare('DELETE FROM elements WHERE id = ?').run(req.params.id);
  });
  del();

  res.json({ ok: true });
});

module.exports = router;
