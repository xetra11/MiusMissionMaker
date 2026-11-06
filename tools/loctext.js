// English texts of the game (data/common/loc_eng, AZTX text tables).
//
// An AZTX table is a hash table: at 0x48 the offset of the first slot; the buckets are
// followed by overflow slots up to the first text list. A slot is 48 bytes, a 32-byte key
// followed by the number of texts and the offset of their list; each list entry is 16 bytes,
// text length and text offset. Unused slots have no key or a count with the high bit set.
const path = require('path');
const { readPack } = require('./azp3');

function readTable(t) {
  const texts = new Map();
  let end = t.length;
  for (let at = t.readUInt32LE(0x48); at + 48 <= end; at += 48) {
    const key = t.toString('latin1', at, Math.min(t.indexOf(0, at), at + 32));
    const n = t.readUInt32LE(at + 32), list = t.readUInt32LE(at + 36);
    if (!key || n & 0x80000000 || list < at + 48 || list + 16 * n > t.length) continue;
    end = Math.min(end, list);
    texts.set(key, [...Array(n)].map((_, k) => {
      const len = t.readUInt32LE(list + 16 * k), off = t.readUInt32LE(list + 16 * k + 4);
      return t.toString('utf8', off, off + len);
    }));
  }
  return texts;
}

// Map of table name -> Map of key -> [texts]
function loadTexts(gameDir) {
  const { entries } = readPack(path.join(gameDir, 'data', 'common', 'loc_eng', 'packed_data', 'text_loc.flatdata'));
  return new Map(entries.map(e => [e.names[0], readTable(e.payload)]));
}

module.exports = { loadTexts };
