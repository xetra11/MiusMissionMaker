// Minimal reader for Graviteam AZP3 pack files (.mispack, .campack2, .qbdesc ...)
const fs = require('fs');
const path = require('path');

const ENTRY_SIZE = 0x80;

function cstr(buf, off, len) {
  const s = buf.subarray(off, off + len);
  const z = s.indexOf(0);
  return s.subarray(0, z < 0 ? len : z).toString('latin1');
}

function readPack(file) {
  const data = fs.readFileSync(file);
  if (data.toString('latin1', 0, 4) !== 'AZP3') throw new Error('not an AZP3 pack');
  const entries = [];
  // directory follows the name hash table (header field 2 = number of 8-byte slots)
  for (let off = 0x40 + data.readUInt32LE(8) * 8; off + ENTRY_SIZE <= data.length; off += ENTRY_SIZE) {
    const typ = data.readUInt32LE(off);
    if (typ !== 9) break;
    const e = {
      dirOff: off,
      f1: data.readUInt32LE(off + 4),
      offset: data.readUInt32LE(off + 8),
      f3: data.readUInt32LE(off + 12),
      size: data.readUInt32LE(off + 16),
      names: [0, 1, 2].map(i => cstr(data, off + 0x20 + i * 0x20, 0x20)),
    };
    e.payload = data.subarray(e.offset, e.offset + e.size);
    entries.push(e);
  }
  return { data, entries };
}

module.exports = { readPack };

if (require.main === module) {
  const [file, out] = process.argv.slice(2);
  const { data, entries } = readPack(file);
  const hdr = [];
  for (let i = 0; i < 8; i++) hdr.push('0x' + data.readUInt32LE(i * 4).toString(16));
  console.log('header', hdr.join(' '), 'len', '0x' + data.length.toString(16));
  for (const e of entries) {
    console.log(`0x${e.dirOff.toString(16)} f1=0x${e.f1.toString(16)} off=0x${e.offset.toString(16)} f3=0x${e.f3.toString(16)} size=0x${e.size.toString(16)} ${e.names.join('|')}`);
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, e.names.filter(Boolean).join('__') + '.bin'), e.payload);
    }
  }
}
