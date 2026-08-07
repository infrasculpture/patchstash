'use strict';

const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// The five Palette Arsenal fixed layer IDs. Custom layers must be mapped to
// one of these at export time.
const PA_LAYERS = ['foundation', 'movement', 'texture', 'punctuation', 'psychedelic'];

// ── POST /api/export ──────────────────────────────────────────────────────────
// Body:
//   elementIds:  string[]   — IDs of elements to export
//   layerMap:    object     — { [customLayerId]: paLayerId } mapping for any
//                             non-standard layers. Only required when elements
//                             use custom layers not in PA_LAYERS.
//
// Returns a JSON structure compatible with Palette Arsenal v11's sound object
// schema, grouped by the target Palette Arsenal layer. This can be imported
// into Palette Arsenal once the "import sounds only" companion feature is built.
router.post('/', (req, res) => {
  const { elementIds, layerMap } = req.body || {};

  if (!Array.isArray(elementIds) || !elementIds.length) {
    return res.status(400).json({ error: 'elementIds must be a non-empty array' });
  }

  const db = getDb();

  // Fetch requested elements
  const placeholders = elementIds.map(() => '?').join(',');
  const elements = db.prepare(
    `SELECT * FROM elements WHERE id IN (${placeholders})`
  ).all(...elementIds);

  if (!elements.length) {
    return res.status(404).json({ error: 'No matching elements found' });
  }

  // Resolve each element's Palette Arsenal layer
  const resolvedLayerMap = layerMap || {};
  const customLayersNeeded = [];

  for (const el of elements) {
    const targetLayer = PA_LAYERS.includes(el.layer_id)
      ? el.layer_id
      : resolvedLayerMap[el.layer_id];

    if (!targetLayer) {
      customLayersNeeded.push(el.layer_id);
    }
  }

  // If any custom layers still need mapping, tell the caller which ones
  if (customLayersNeeded.length) {
    const uniqueUnmapped = [...new Set(customLayersNeeded)];
    const layerRows = db.prepare(
      `SELECT * FROM layers WHERE id IN (${uniqueUnmapped.map(() => '?').join(',')})`
    ).all(...uniqueUnmapped);

    return res.status(422).json({
      error:          'Some elements use custom layers that need mapping',
      unmappedLayers: layerRows.map(l => ({ id: l.id, name: l.name })),
    });
  }

  // Build the export structure — sounds grouped by Palette Arsenal layer,
  // shaped exactly like Palette Arsenal v11's state.sounds[layer] entries.
  const sounds = {
    foundation:  [],
    movement:    [],
    texture:     [],
    punctuation: [],
    psychedelic: [],
  };

  for (const el of elements) {
    const targetLayer = PA_LAYERS.includes(el.layer_id)
      ? el.layer_id
      : resolvedLayerMap[el.layer_id];

    sounds[targetLayer].push({
      name:    el.title,
      synth:   el.synth    || '',
      bank:    el.bank     || '',
      patch:   el.patch    || '',
      file:    '',           // left blank — user places the downloaded file themselves
      desc:    el.description || '',
      tech:    el.tech     || '',
      savedAt: el.created_at,
    });
  }

  // Wrap in the same top-level shape importJSON() expects, but scoped to
  // sounds only — the companion "import sounds only" feature in Palette Arsenal
  // reads this and merges rather than replacing.
  const exportPayload = {
    _patchstash_export: true,
    _export_date:       new Date().toISOString(),
    _element_count:     elements.length,
    sounds,
  };

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="patchstash-export-${Date.now()}.json"`
  );
  res.json(exportPayload);
});

// ── GET /api/export/check ─────────────────────────────────────────────────────
// Pre-flight check: given a list of element IDs, returns which (if any) use
// custom layers that will need mapping before export can proceed.
// The UI uses this to decide whether to show the layer mapping step.
router.get('/check', (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean);
  if (!ids.length) return res.json({ needsMapping: false, unmappedLayers: [] });

  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const elements = db.prepare(
    `SELECT DISTINCT layer_id FROM elements WHERE id IN (${placeholders})`
  ).all(...ids);

  const customLayers = elements
    .map(e => e.layer_id)
    .filter(lid => lid && !PA_LAYERS.includes(lid));

  if (!customLayers.length) {
    return res.json({ needsMapping: false, unmappedLayers: [] });
  }

  const uniqueCustom = [...new Set(customLayers)];
  const layerRows = db.prepare(
    `SELECT * FROM layers WHERE id IN (${uniqueCustom.map(() => '?').join(',')})`
  ).all(...uniqueCustom);

  res.json({
    needsMapping: true,
    unmappedLayers: layerRows.map(l => ({ id: l.id, name: l.name })),
  });
});

module.exports = router;
