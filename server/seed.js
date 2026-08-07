'use strict';

// Seeds the five Palette Arsenal default layers if the layers table is empty.
// Safe to call on every startup — the rowcount check makes it a no-op once seeded.

const DEFAULT_LAYERS = [
  { id: 'foundation',  name: 'Foundation',        colour: '#ff2060', ord: 0 },
  { id: 'movement',    name: 'Movement',           colour: '#c8ff00', ord: 1 },
  { id: 'texture',     name: 'Texture',            colour: '#00deff', ord: 2 },
  { id: 'punctuation', name: 'Punctuation',        colour: '#ffaa00', ord: 3 },
  { id: 'psychedelic', name: 'Psychedelic Detail', colour: '#a855f7', ord: 4 },
];

function seedLayers(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM layers').get().n;
  if (count > 0) return; // already seeded

  const insert = db.prepare(
    'INSERT INTO layers (id, name, colour, ord, archived) VALUES (?, ?, ?, ?, 0)'
  );
  const insertMany = db.transaction((layers) => {
    for (const l of layers) insert.run(l.id, l.name, l.colour, l.ord);
  });
  insertMany(DEFAULT_LAYERS);
  console.log('[patchstash] Seeded default layers.');
}

module.exports = { seedLayers };
