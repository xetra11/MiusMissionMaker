// Reads building positions from the map tiles (*.polypack2) and groups them into settlements.
//
// Tile object list ("obj_quads"): u32 total, then records
//   [u32 fileLen, file (0 = same file)] [u32 nameLen, name (0 = same object)] f32 x, z, rot, 8 unknown bytes
// Mission coordinates are the local coordinates of the mission's centre tile; tiles are 2048 m.
const fs = require('fs');
const path = require('path');
const { parse } = require('./azcf');

const TILE = 2048;
const JOIN_DISTANCE = 120; // buildings closer than this belong to the same settlement

// polypacks are 32 MB each, so read only the entries we need
function readEntries(file, names) {
  const fd = fs.openSync(file, 'r');
  const h = Buffer.alloc(0x2000);
  fs.readSync(fd, h, 0, h.length, 0);
  const count = h.readUInt32LE(4), dir = 0x40 + h.readUInt32LE(8) * 8, out = {};
  for (let i = 0; i < count; i++) {
    const o = dir + i * 0x80;
    const name = h.subarray(o + 0x20, o + 0x40).toString('latin1').replace(/\0.*/s, '');
    if (!names.includes(name)) continue;
    const b = Buffer.alloc(h.readUInt32LE(o + 16));
    fs.readSync(fd, b, 0, b.length, h.readUInt32LE(o + 8));
    out[name] = b;
  }
  fs.closeSync(fd);
  return out;
}

function parseObjects(b) {
  const objects = [];
  const total = b.readUInt32LE(0);
  let o = 4, name = '';
  const str = () => {
    const l = b.readUInt32LE(o);
    o += 4;
    const s = b.toString('latin1', o, o + l);
    o += l;
    return s;
  };
  while (objects.length < total && o + 8 <= b.length) {
    str(); // file (not needed)
    name = str() || name;
    objects.push({ name, x: b.readFloatLE(o), z: b.readFloatLE(o + 4) });
    o += 20;
  }
  return objects;
}

function loadTiles(gameDir) {
  const dir = path.join(gameDir, 'data', 'oprum', 'shared', 'polygons', '6m_mius');
  const tiles = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.polypack2'))) {
    const e = readEntries(path.join(dir, f), ['obj_quads', 'cell_desc']);
    const params = parse(e.cell_desc).nodes[1].params;
    const cell = n => params.find(p => p.name === n).raw.readUInt32LE(0);
    tiles[f.split('_')[0].toLowerCase()] = {
      cx: cell('cell_x'), cz: cell('cell_y'),
      buildings: parseObjects(e.obj_quads).filter(o => /^(build|saray|church)/.test(o.name)),
    };
  }
  return tiles;
}

// all settlements in world coordinates
function settlements(tiles) {
  const all = Object.values(tiles).flatMap(t => t.buildings.map(b => ({
    x: t.cx * TILE + b.x, z: t.cz * TILE + b.z, house: b.name.startsWith('build') || b.name.startsWith('church'),
  })));
  const seen = new Array(all.length).fill(false);
  const groups = [];
  for (let i = 0; i < all.length; i++) {
    if (seen[i]) continue;
    seen[i] = true;
    const stack = [i], members = [];
    while (stack.length) {
      const a = all[stack.pop()];
      members.push(a);
      for (let j = 0; j < all.length; j++) {
        if (!seen[j] && Math.hypot(a.x - all[j].x, a.z - all[j].z) < JOIN_DISTANCE) { seen[j] = true; stack.push(j); }
      }
    }
    groups.push(members);
  }
  return groups.map(m => {
    const xs = m.map(b => b.x), zs = m.map(b => b.z);
    return {
      x: xs.reduce((a, b) => a + b) / m.length, z: zs.reduce((a, b) => a + b) / m.length,
      width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs),
      houses: m.filter(b => b.house).length, buildings: m.length,
    };
  });
}

// settlements within a mission's map, in mission coordinates, largest first
function missionSettlements(tiles, all, polygon, extent) {
  const tile = tiles[path.win32.basename(polygon).split('_')[0].toLowerCase()];
  return all
    .map(s => ({ ...s, x: Math.round(s.x - tile.cx * TILE), z: Math.round(s.z - tile.cz * TILE) }))
    .filter(s => s.houses >= 3 && s.x >= extent.x0 && s.x <= extent.x1 && s.z >= extent.z0 && s.z <= extent.z1)
    .sort((a, b) => b.houses - a.houses);
}

module.exports = { loadTiles, settlements, missionSettlements };
