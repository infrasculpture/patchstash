'use strict';

// All migrations are idempotent — safe to run on every startup.
// New tables use CREATE TABLE IF NOT EXISTS.
// New columns use ALTER TABLE ... ADD COLUMN, guarded by a column existence check.
// Never DROP or rename existing columns — add new ones and leave old ones in place.

function runMigrations(db) {
  // ── Layers ────────────────────────────────────────────────────────────────
  // The configurable taxonomy. Seeded with Palette Arsenal defaults on first run
  // (see seed.js). Users can add, rename, recolour, reorder, archive, or delete.
  db.exec(`
    CREATE TABLE IF NOT EXISTS layers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      colour      TEXT NOT NULL DEFAULT '#888888',
      ord         INTEGER NOT NULL DEFAULT 0,
      archived    INTEGER NOT NULL DEFAULT 0
    );
  `);

  // ── Projects ──────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      bpm         TEXT NOT NULL DEFAULT '',
      key         TEXT NOT NULL DEFAULT '',
      flavours    TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      archived    INTEGER NOT NULL DEFAULT 0
    );
  `);

  // ── Elements ──────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS elements (
      id                  TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL REFERENCES projects(id),
      title               TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',

      layer_id            TEXT NOT NULL DEFAULT '',
      source_type         TEXT NOT NULL DEFAULT '',
      processing_state    TEXT NOT NULL DEFAULT '',
      energy_level        TEXT NOT NULL DEFAULT '',

      bpm                 TEXT NOT NULL DEFAULT '',
      key                 TEXT NOT NULL DEFAULT '',

      synth               TEXT NOT NULL DEFAULT '',
      bank                TEXT NOT NULL DEFAULT '',
      patch               TEXT NOT NULL DEFAULT '',
      tech                TEXT NOT NULL DEFAULT '',

      external_link       TEXT NOT NULL DEFAULT '',

      primary_filename    TEXT NOT NULL DEFAULT '',
      primary_type        TEXT NOT NULL DEFAULT '',
      primary_size        INTEGER NOT NULL DEFAULT 0,
      primary_uploaded_at TEXT NOT NULL DEFAULT '',

      audio_filename      TEXT NOT NULL DEFAULT '',
      audio_size          INTEGER NOT NULL DEFAULT 0,
      audio_uploaded_at   TEXT NOT NULL DEFAULT '',

      status              TEXT NOT NULL DEFAULT 'new',
      submitted_by        TEXT NOT NULL DEFAULT '',
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );
  `);

  // Safe additive migrations for columns added after initial release
  // (ALTER TABLE ADD COLUMN is idempotent via the try/catch pattern)
  const addColumnIfMissing = (table, column, definition) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch(_) {}
  };
  addColumnIfMissing('elements', 'external_link', `TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing('projects', 'cover_element_id', `TEXT NOT NULL DEFAULT ''`);

  // ── Status log ────────────────────────────────────────────────────────────
  // Append-only. from_status and to_status are both nullable — a null pair
  // means this is a freestanding note rather than a status transition.
  db.exec(`
    CREATE TABLE IF NOT EXISTS status_log (
      id          TEXT PRIMARY KEY,
      element_id  TEXT NOT NULL REFERENCES elements(id),
      from_status TEXT,
      to_status   TEXT,
      comment     TEXT NOT NULL DEFAULT '',
      author      TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );
  `);

  // ── Indexes ───────────────────────────────────────────────────────────────
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_elements_project ON elements(project_id);
    CREATE INDEX IF NOT EXISTS idx_elements_status  ON elements(status);
    CREATE INDEX IF NOT EXISTS idx_elements_layer   ON elements(layer_id);
    CREATE INDEX IF NOT EXISTS idx_log_element      ON status_log(element_id);
  `);
}

module.exports = { runMigrations };
