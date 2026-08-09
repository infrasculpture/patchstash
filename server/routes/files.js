'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const Busboy  = require('busboy');
const { getDb, DATA_DIR } = require('../db');

const router = express.Router();

// Maximum upload size in bytes. 500 MB is generous for patches + zips + audio.
const MAX_BYTES = 500 * 1024 * 1024;

// ── Helpers ───────────────────────────────────────────────────────────────────

function elementDir(projectId, elementId) {
  return path.join(DATA_DIR, 'files', projectId, elementId);
}

function safeName(filename) {
  // Strip path components and replace anything that isn't alphanumeric,
  // dash, underscore, or dot with an underscore.
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
}

// ── POST /api/elements/:id/files/:slot ────────────────────────────────────────
// slot is 'primary' or 'audio'.
// Streams the upload directly to disk — never held in memory.
// The file type field (for primary slot) is sent as a form field alongside
// the file.
router.post('/elements/:id/files/:slot', (req, res) => {
  const { id, slot } = req.params;
  if (slot !== 'primary' && slot !== 'audio') {
    return res.status(400).json({ error: 'slot must be primary or audio' });
  }

  const db      = getDb();
  const element = db.prepare('SELECT * FROM elements WHERE id = ?').get(id);
  if (!element) return res.status(404).json({ error: 'Element not found' });

  const dir = elementDir(element.project_id, id);
  fs.mkdirSync(dir, { recursive: true });

  let fileType     = '';
  let savedName    = '';
  let savedSize    = 0;
  let writeStream  = null;
  let uploadError  = null;
  let fileReceived = false;

  const bb = Busboy({
    headers: req.headers,
    limits: { fileSize: MAX_BYTES },
  });

  bb.on('field', (name, val) => {
    if (name === 'type' && slot === 'primary') fileType = val;
  });

  bb.on('file', (fieldname, stream, info) => {
    if (fileReceived) {
      // Only accept one file per request
      stream.resume();
      return;
    }
    fileReceived = true;

    const filename = safeName(info.filename || `${slot}_upload`);
    const destPath = path.join(dir, `${slot}_${filename}`);
    savedName      = `${slot}_${filename}`;
    writeStream    = fs.createWriteStream(destPath);

    stream.on('limit', () => {
      uploadError = `File exceeds maximum size of ${MAX_BYTES / 1024 / 1024} MB`;
      stream.resume();
      writeStream.destroy();
      try { fs.unlinkSync(destPath); } catch (_) {}
    });

    stream.on('data', (chunk) => { savedSize += chunk.length; });
    stream.pipe(writeStream);
  });

  bb.on('finish', () => {
    if (uploadError) {
      return res.status(413).json({ error: uploadError });
    }
    if (!fileReceived || !savedName) {
      return res.status(400).json({ error: 'No file received' });
    }

    writeStream.on('finish', () => {
      const now = new Date().toISOString();

      if (slot === 'primary') {
        db.prepare(`
          UPDATE elements
          SET primary_filename = ?, primary_type = ?, primary_size = ?,
              primary_uploaded_at = ?, updated_at = ?
          WHERE id = ?
        `).run(savedName, fileType || 'other', savedSize, now, now, id);
      } else {
        db.prepare(`
          UPDATE elements
          SET audio_filename = ?, audio_size = ?, audio_uploaded_at = ?, updated_at = ?
          WHERE id = ?
        `).run(savedName, savedSize, now, now, id);
      }

      const updated = db.prepare('SELECT * FROM elements WHERE id = ?').get(id);
      const fileInfo = slot === 'primary'
        ? { filename: updated.primary_filename, type: updated.primary_type, sizeBytes: updated.primary_size, uploadedAt: updated.primary_uploaded_at }
        : { filename: updated.audio_filename,   sizeBytes: updated.audio_size,  uploadedAt: updated.audio_uploaded_at };

      res.status(201).json({ ok: true, slot, file: fileInfo });
    });

    writeStream.on('error', (err) => {
      console.error('[patchstash] Write error:', err);
      res.status(500).json({ error: 'Failed to save file' });
    });
  });

  bb.on('error', (err) => {
    console.error('[patchstash] Busboy error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Upload error' });
  });

  req.pipe(bb);
});

// ── GET /api/elements/:id/files/:slot ─────────────────────────────────────────
// Streams the file back for download or in-browser audio playback.
// Sets Content-Disposition: inline for audio (so the browser plays it)
// and attachment for primary files (so it downloads).
router.get('/elements/:id/files/:slot', (req, res) => {
  const { id, slot } = req.params;
  if (slot !== 'primary' && slot !== 'audio') {
    return res.status(400).json({ error: 'slot must be primary or audio' });
  }

  const db      = getDb();
  const element = db.prepare('SELECT * FROM elements WHERE id = ?').get(id);
  if (!element) return res.status(404).json({ error: 'Element not found' });

  const filename = slot === 'primary' ? element.primary_filename : element.audio_filename;
  if (!filename) return res.status(404).json({ error: 'No file uploaded for this slot' });

  const filePath = path.join(elementDir(element.project_id, id), filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  // Strip the slot prefix to get a cleaner download name
  const downloadName = filename.replace(/^(primary|audio)_/, '');

  // Derive a Content-Type from the file extension so browsers can play audio
  // inline without guessing. Falls back to octet-stream for unknown types.
  const ext = path.extname(downloadName).toLowerCase();
  const MIME_TYPES = {
    '.mp3':  'audio/mpeg',
    '.wav':  'audio/wav',
    '.ogg':  'audio/ogg',
    '.flac': 'audio/flac',
    '.aac':  'audio/aac',
    '.m4a':  'audio/mp4',
    '.aif':  'audio/aiff',
    '.aiff': 'audio/aiff',
    '.zip':  'application/zip',
    '.7z':   'application/x-7z-compressed',
    '.pdf':  'application/pdf',
  };
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);

  if (slot === 'audio') {
    res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  }

  // Support range requests for audio seeking in the browser player
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range && slot === 'audio') {
    const parts  = range.replace(/bytes=/, '').split('-');
    const start  = parseInt(parts[0], 10);
    const end    = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range',  `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Accept-Ranges',  'bytes');
    res.setHeader('Content-Length', chunkSize);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(filePath).pipe(res);
  }
});

// ── DELETE /api/elements/:id/files/:slot ──────────────────────────────────────
// Removes the file from disk and clears the metadata from the element row.
router.delete('/elements/:id/files/:slot', (req, res) => {
  const { id, slot } = req.params;
  if (slot !== 'primary' && slot !== 'audio') {
    return res.status(400).json({ error: 'slot must be primary or audio' });
  }

  const db      = getDb();
  const element = db.prepare('SELECT * FROM elements WHERE id = ?').get(id);
  if (!element) return res.status(404).json({ error: 'Element not found' });

  const filename = slot === 'primary' ? element.primary_filename : element.audio_filename;
  if (filename) {
    const filePath = path.join(elementDir(element.project_id, id), filename);
    try { fs.unlinkSync(filePath); } catch (_) { /* already gone — that's fine */ }
  }

  const now = new Date().toISOString();
  if (slot === 'primary') {
    db.prepare(
      `UPDATE elements SET primary_filename='', primary_type='', primary_size=0,
       primary_uploaded_at='', updated_at=? WHERE id=?`
    ).run(now, id);
  } else {
    db.prepare(
      `UPDATE elements SET audio_filename='', audio_size=0,
       audio_uploaded_at='', updated_at=? WHERE id=?`
    ).run(now, id);
  }

  res.json({ ok: true });
});

module.exports = router;
