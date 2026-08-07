'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');
const { seedLayers } = require('./seed');

// DATA_DIR is the host-mounted volume: /app/data inside the container.
// When running outside Docker for local dev, it falls back to a ./data directory
// next to the repository root.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'patchstash.db');

let _db = null;

function getDb() {
  if (_db) return _db;

  // Ensure the data directory exists (belt-and-suspenders — Docker entrypoint
  // also creates it, but this makes local dev work without extra steps)
  const fs = require('fs');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'files'), { recursive: true });

  _db = new Database(DB_PATH);

  // WAL mode: better concurrent read performance, safer crash recovery
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  runMigrations(_db);
  seedLayers(_db);

  console.log(`[patchstash] Database ready at ${DB_PATH}`);
  return _db;
}

module.exports = { getDb, DATA_DIR };
