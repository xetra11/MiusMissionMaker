// Reader/writer for Graviteam AZCF config blobs (found inside AZP3 packs).
//
// Layout (all little endian):
//   0x00 header 0x20: 'AZCF', nodeCount, 0x40, rootChildHashCount, rootChildHashOff, 0...
//   0x20 node records, 0x80 each: slotA[0x20] slotB[0x20] fields u32[16]
//        fields: type, cols, rows, fmtOff, dataOff, childListOff, childCount,
//                paramHashCount, paramHashOff, childHashCount, childHashOff, ...
//   data area: type 1 (params): rows records of 0x40 (value[16], type u32, pad[12], name[32])
//              type 2 (table):  rows*cols cells of 0x20 (value[16], type u32, pad[12])
//   hash tables (8 bytes per slot), child index lists (u32), then strings:
//   per node its format string followed by the string values it references.
// String values (cell type 2) are {len, absOffset}.
const fs = require('fs');

const T_STR = 2;

function cstr(buf, off, len) {
  const s = buf.subarray(off, off + len);
  const z = s.indexOf(0);
  return s.subarray(0, z < 0 ? len : z).toString('latin1');
}

function zstr(buf, off) {
  const z = buf.indexOf(0, off);
  return buf.subarray(off, z).toString('latin1');
}

function parse(buf) {
  if (buf.toString('latin1', 0, 4) !== 'AZCF') throw new Error('not AZCF');
  const n = buf.readUInt32LE(4);
  const header = Buffer.from(buf.subarray(0, 0x20));
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const r = 0x20 + i * 0x80;
    const f = [];
    for (let k = 0; k < 16; k++) f.push(buf.readUInt32LE(r + 0x40 + k * 4));
    const node = {
      slotA: cstr(buf, r, 0x20), slotB: cstr(buf, r + 0x20, 0x20),
      rawA: Buffer.from(buf.subarray(r, r + 0x20)), rawB: Buffer.from(buf.subarray(r + 0x20, r + 0x40)),
      type: f[0], cols: f[1], rows: f[2], fmt: zstr(buf, f[3]), extra: f.slice(11),
      children: [], params: null, table: null,
      paramHash: f[7] ? Buffer.from(buf.subarray(f[8], f[8] + f[7] * 8)) : null,
      childHash: f[9] ? Buffer.from(buf.subarray(f[10], f[10] + f[9] * 8)) : null,
      _f: f,
    };
    for (let k = 0; k < f[6]; k++) node.children.push(buf.readUInt32LE(f[5] + k * 4));
    const readVal = (o) => {
      const v = { raw: Buffer.from(buf.subarray(o, o + 16)), t: buf.readUInt32LE(o + 16), pad: Buffer.from(buf.subarray(o + 20, o + 32)) };
      if (v.t === T_STR) {
        const len = v.raw.readUInt32LE(0), off = v.raw.readUInt32LE(4);
        v.str = buf.subarray(off, off + len).toString('latin1');
        v.nul = buf[off + len] === 0; // binary blobs (compiled scripts) carry no terminator
      }
      return v;
    };
    if (node.type === 1) {
      node.params = [];
      for (let k = 0; k < node.rows; k++) {
        const o = f[4] + k * 0x40;
        const v = readVal(o);
        v.name = cstr(buf, o + 0x20, 0x20);
        v.rawName = Buffer.from(buf.subarray(o + 0x20, o + 0x40));
        node.params.push(v);
      }
    } else if (node.type === 2) {
      node.table = [];
      for (let k = 0; k < node.rows; k++) {
        const row = [];
        for (let c = 0; c < node.cols; c++) row.push(readVal(f[4] + (k * node.cols + c) * 0x20));
        node.table.push(row);
      }
    }
    nodes.push(node);
  }
  return { header, nodes, size: buf.length };
}

function serialize(cf) {
  const n = cf.nodes.length;
  const parts = [];
  // pass 1: sizes
  let pos = 0x20 + n * 0x80 + 0x20;
  const dataOff = [];
  for (const nd of cf.nodes) {
    dataOff.push(pos);
    if (nd.type === 1) pos += nd.params.length * 0x40;
    else if (nd.type === 2) pos += nd.table.length * nd.cols * 0x20;
  }
  const paramHashOff = [], childHashOff = [];
  for (let i = 0; i < n; i++) {
    const nd = cf.nodes[i];
    if (i === 0 && nd.childHash) { childHashOff[i] = pos; pos += nd.childHash.length; }
    if (nd.paramHash) { paramHashOff[i] = pos; pos += nd.paramHash.length; }
    if (i !== 0 && nd.childHash) { childHashOff[i] = pos; pos += nd.childHash.length; }
  }
  const childListOff = [];
  const listBase = pos;
  for (const nd of cf.nodes) { childListOff.push(nd.children.length ? pos : listBase); pos += nd.children.length * 4; }
  // strings
  const fmtOff = [];
  const strChunks = [];
  const addStr = (s, nul = true) => { const o = pos; const b = Buffer.from(nul ? s + '\0' : s, 'latin1'); strChunks.push(b); pos += b.length; return o; };
  const seen = new Map(); // value strings are pooled, format strings are not
  for (const nd of cf.nodes) {
    fmtOff.push(addStr(nd.fmt));
    const vals = nd.type === 1 ? nd.params : nd.type === 2 ? nd.table.flat() : [];
    for (const v of vals) if (v.t === T_STR) {
      const key = (v.nul !== false ? 'z' : 'b') + v.str;
      if (!seen.has(key)) seen.set(key, addStr(v.str, v.nul !== false));
      v._off = seen.get(key);
    }
  }
  const total = pos;
  const out = Buffer.alloc(total);
  cf.header.copy(out, 0);
  out.writeUInt32LE(n, 4);
  for (let i = 0; i < n; i++) {
    const nd = cf.nodes[i];
    const r = 0x20 + i * 0x80;
    nd.rawA.copy(out, r); nd.rawB.copy(out, r + 0x20);
    const rows = nd.type === 1 ? nd.params.length : nd.type === 2 ? nd.table.length : nd.rows;
    const f = [nd.type, nd.cols, rows, fmtOff[i], dataOff[i] ?? 0, childListOff[i], nd.children.length,
      nd.paramHash ? nd.paramHash.length / 8 : 0, nd.paramHash ? paramHashOff[i] : 0,
      nd.childHash ? nd.childHash.length / 8 : 0, nd.childHash ? childHashOff[i] : 0, ...nd.extra];
    // empty nodes still point at the running data position
    f.forEach((x, k) => out.writeUInt32LE(x >>> 0, r + 0x40 + k * 4));
    const writeVal = (o, v) => {
      v.raw.copy(out, o);
      if (v.t === T_STR) { out.writeUInt32LE(v.str.length, o); out.writeUInt32LE(v._off, o + 4); }
      out.writeUInt32LE(v.t, o + 16);
      v.pad.copy(out, o + 20);
    };
    if (nd.type === 1) nd.params.forEach((v, k) => { const o = dataOff[i] + k * 0x40; writeVal(o, v); v.rawName.copy(out, o + 0x20); });
    if (nd.type === 2) nd.table.forEach((row, k) => row.forEach((v, c) => writeVal(dataOff[i] + (k * nd.cols + c) * 0x20, v)));
    if (nd.paramHash) nd.paramHash.copy(out, paramHashOff[i]);
    if (nd.childHash) nd.childHash.copy(out, childHashOff[i]);
    nd.children.forEach((c, k) => out.writeUInt32LE(c, childListOff[i] + k * 4));
  }
  // header mirrors root child hash
  if (cf.nodes[0].childHash) { out.writeUInt32LE(cf.nodes[0].childHash.length / 8, 0x0c); out.writeUInt32LE(childHashOff[0], 0x10); }
  let p = fmtOff[0];
  for (const c of strChunks) { c.copy(out, p); p += c.length; }
  return out;
}

// Pretty value for dumps.
function show(v, fmtChar) {
  if (v.t === T_STR) return JSON.stringify(v.str);
  const r = v.raw;
  switch (fmtChar) {
    case 'u': { const x = r.readUInt32LE(0); const s = r.subarray(0, 4).toString('latin1'); return /^[A-Z@]{3,4}\0?$/.test(s.replace(/\0+$/, '')) && x > 0x1000000 ? `'${s.replace(/\0/g, '')}'` : String(x); }
    case 'f': return r.readFloatLE(0).toFixed(3);
    case 'b': return String(r.readUInt32LE(0));
    case 'v': return `(${[0, 4, 8].map(o => r.readFloatLE(o).toFixed(2)).join(',')})`;
    default: return r.toString('hex').replace(/(00)+$/, '') || '0';
  }
}

function dump(cf, opts = {}) {
  const lines = [];
  cf.nodes.forEach((nd, i) => {
    lines.push(`#${i} [${nd.slotA}|${nd.slotB}] type=${nd.type} cols=${nd.cols} rows=${nd.rows} fmt=${nd.fmt} children=${nd.children}`);
    if (nd.params) nd.params.forEach((v, k) => lines.push(`   ${v.name} = ${show(v, nd.fmt[k])} (t${v.t})`));
    if (nd.table) nd.table.slice(0, opts.maxRows ?? 1e9).forEach((row, k) =>
      lines.push(`   [${k}] ` + row.map((v, c) => show(v, nd.fmt[c])).join(' | ')));
  });
  return lines.join('\n');
}

module.exports = { parse, serialize, dump, T_STR };

if (require.main === module) {
  const [cmd, file, maxRows] = process.argv.slice(2);
  const buf = fs.readFileSync(file);
  const cf = parse(buf);
  if (cmd === 'dump') console.log(dump(cf, { maxRows: maxRows ? +maxRows : undefined }));
  if (cmd === 'roundtrip') {
    const out = serialize(cf);
    let diff = -1;
    for (let i = 0; i < Math.max(out.length, buf.length); i++) if (out[i] !== buf[i]) { diff = i; break; }
    console.log(file.split(/[\\/]/).pop(), 'in', buf.length, 'out', out.length, diff < 0 ? 'IDENTICAL' : 'first diff @0x' + diff.toString(16));
  }
}
