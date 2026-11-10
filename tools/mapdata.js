// Reads building positions from the map tiles (*.polypack2) and groups them into settlements,
// and puts together the map texture of a mission.
//
// Tile object list ("obj_quads"): u32 total, then records
//   [u32 fileLen, file (0 = same file)] [u32 nameLen, name (0 = same object)] f32 x, z, rot, 8 unknown bytes
// Mission coordinates are the local coordinates of the mission's centre tile; tiles are 2048 m.
// cell_x grows to +x, but cell_y grows to -z: the tile with cell_y + 1 lies south of a tile.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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
      file: path.join(dir, f), cx: cell('cell_x'), cz: cell('cell_y'),
      buildings: parseObjects(e.obj_quads).filter(o => /^(build|saray|church)/.test(o.name)),
    };
  }
  return tiles;
}

// all settlements in world coordinates
function settlements(tiles) {
  const all = Object.values(tiles).flatMap(t => t.buildings.map(b => ({
    x: t.cx * TILE + b.x, z: b.z - t.cz * TILE, house: b.name.startsWith('build') || b.name.startsWith('church'),
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
    .map(s => ({ ...s, x: Math.round(s.x - tile.cx * TILE), z: Math.round(s.z + tile.cz * TILE) }))
    .filter(s => s.houses >= 3 && s.x >= extent.x0 && s.x <= extent.x1 && s.z >= extent.z0 && s.z <= extent.z1)
    .sort((a, b) => b.houses - a.houses);
}

// The tile entry "back" is the game's top-down map texture: an "ATF1DXT1" header padded to 0x2000,
// then 512 x 512 pixels as DXT1 blocks, 4 m per pixel, row 0 at the tile's south edge (z = 0).
const BACK = 512, PX = TILE / BACK;
function readBack(file) {
  const b = readEntries(file, ['back']).back, rgb = Buffer.alloc(BACK * BACK * 3);
  const c565 = v => [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31];
  const mix = (p, q, a) => p.map((v, i) => v * a + q[i] * (1 - a));
  let o = 0x2000;
  for (let by = 0; by < BACK / 4; by++) {
    for (let bx = 0; bx < BACK / 4; bx++) {
      const a = b.readUInt16LE(o), c = b.readUInt16LE(o + 2), bits = b.readUInt32LE(o + 4);
      o += 8;
      const p0 = c565(a), p1 = c565(c);
      const pal = a > c ? [p0, p1, mix(p0, p1, 2 / 3), mix(p0, p1, 1 / 3)] : [p0, p1, mix(p0, p1, 0.5), [0, 0, 0]];
      for (let i = 0; i < 16; i++) {
        const px = pal[(bits >> (i * 2)) & 3], q = ((by * 4 + (i >> 2)) * BACK + bx * 4 + (i & 3)) * 3;
        rgb[q] = px[0]; rgb[q + 1] = px[1]; rgb[q + 2] = px[2];
      }
    }
  }
  return rgb;
}

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// map texture of a mission's extent as PNG, 4 m per pixel, north up
function terrainPng(tiles, polygon, extent) {
  const tile = tiles[path.win32.basename(polygon).split('_')[0].toLowerCase()];
  const byCell = new Map(Object.values(tiles).map(t => [t.cx + ',' + t.cz, t]));
  const backs = new Map();
  const w = Math.round((extent.x1 - extent.x0) / PX), h = Math.round((extent.z1 - extent.z0) / PX);
  const rgb = Buffer.alloc(w * h * 3, 0x80);
  for (let j = 0; j < h; j++) {
    const z = extent.z1 - (j + 0.5) * PX, dz = Math.floor(z / TILE);
    for (let i = 0; i < w; i++) {
      const x = extent.x0 + (i + 0.5) * PX, dx = Math.floor(x / TILE);
      const t = byCell.get((tile.cx + dx) + ',' + (tile.cz - dz));
      if (!t) continue;
      if (!backs.has(t)) backs.set(t, readBack(t.file));
      const col = Math.floor((x - dx * TILE) / PX), row = Math.floor((z - dz * TILE) / PX);
      backs.get(t).copy(rgb, (j * w + i) * 3, (row * BACK + col) * 3, (row * BACK + col) * 3 + 3);
    }
  }
  return png(w, h, rgb);
}

module.exports = { loadTiles, settlements, missionSettlements, terrainPng };
