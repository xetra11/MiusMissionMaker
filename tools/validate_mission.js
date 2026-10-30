// Structural consistency checks for a .mispack (works on the shipped missions too).
// usage: node validate_mission.js <file.mispack>
const { readPack } = require('./azp3');
const { parse } = require('./azcf');

const u32 = (v, o = 0) => v.raw.readUInt32LE(o);
const hex8 = x => x.toString(16).padStart(8, '0');
const side = v => v.raw.toString('latin1', 12, 16).replace(/\0/g, '');

function validate(file) {
  const { entries } = readPack(file);
  const errors = [];
  const ok = (cond, msg) => { if (!cond) errors.push(msg); };

  for (const e of entries) {
    let s = 0; for (const b of e.payload) s = (s + b) >>> 0;
    ok(s === e.f1, `checksum ${e.names[0]}`);
  }
  const get = n => entries.find(e => e.names[0] + '|' + e.names[1] === n).payload;
  const tac = parse(get('tacgame_image|tacimage'));
  const N = n => tac.nodes.find(x => x.slotB === n);
  const userSide = N('i_gamespec:gamespec').params.find(p => p.name === 'user_side').raw.toString('latin1', 0, 4).replace(/\0/g, '');

  const plats = N('plats').table, squads = N('squads').table, units = N('units').table;
  const platIds = plats.map(r => u32(r[1]));
  const squadIds = squads.map(r => u32(r[1]));
  const unitIds = units.map(r => u32(r[3]));
  ok(new Set(platIds).size === platIds.length, 'duplicate platoon ids');
  ok(new Set(squadIds).size === squadIds.length, 'duplicate squad ids');
  ok(new Set(unitIds).size === unitIds.length, 'duplicate unit ids');
  ok(new Set(plats.map(r => r[10].str)).size === plats.length, 'duplicate callsigns');
  const ords = plats.map(r => u32(r[7], 12)).sort((a, b) => a - b);
  ok(ords.every((o, i) => o === i + 1), 'platoon ordinals not 1..n: ' + ords);

  const pools = N('pools').table.map(r => hex8(u32(r[1])) + r[1].raw.toString('latin1', 4, 8).replace(/\0/g, ''));
  ok(new Set(pools).size === pools.length, 'duplicate pool ids');
  plats.forEach(r => ok(pools.includes(hex8(u32(r[1]) & 0xff800000) + side(r[1])), 'platoon without pool ' + r[10].str));
  const platSide = new Map(plats.map(r => [u32(r[1]), side(r[1])]));
  squads.forEach(r => {
    const sid = u32(r[1]);
    ok(r[0].str === 'sq_' + hex8(sid), 'squad name/id mismatch ' + r[0].str);
    ok(platIds.includes(sid & ~0x1ff), 'squad without platoon ' + r[0].str);
    const rel = r[8].raw.toString('latin1', 0, 4);
    ok(rel === (platSide.get(sid & ~0x1ff) === userSide ? 'USER' : 'ENEM'), 'squad USER/ENEM flag wrong ' + r[0].str);
  });
  const names = new Set(units.map(r => r[0].str));
  units.forEach(r => {
    const uid = u32(r[3]);
    // vehicles are named after id+1 (same convention in the shipped missions)
    ok(r[0].str.endsWith('_' + hex8(uid + (r[0].str.startsWith('i_techn') ? 1 : 0))), 'unit name/id mismatch ' + r[0].str);
    ok(squadIds.includes(uid & ~0x1f), 'unit without squad ' + r[0].str);
    if (r[5].str) ok(names.has(r[5].str), 'dangling vehicle link ' + r[5].str);
  });
  N('brief').table.forEach(r => ok(platIds.includes(u32(r[0], 4)), 'marker for missing platoon ' + hex8(u32(r[0], 4))));
  (N('triggers')?.table ?? []).forEach(r => ok(ords.includes(u32(r[0], 8)), 'trigger for missing ordinal ' + u32(r[0], 8)));
  ok(N('brief').table.length === plats.length, 'marker count != platoon count');
  ok(!N('triggers') || N('triggers').table.length === plats.length, 'trigger count != platoon count');

  // script / text consistency
  const desc = parse(get('desc|config'));
  const lines = n => desc.nodes.find(x => x.slotB === n).table.map(r => r[0].str);
  const decode = s => {
    const b = Buffer.from(s, 'latin1'), n = b.readUInt32LE(5), base = 13 + n * 4, out = [];
    for (let i = 0; i < n; i++) { const o = base + b.readUInt32LE(13 + i * 4); out.push(b.toString('latin1', o, b.indexOf(0, o))); }
    return out;
  };
  ok(JSON.stringify(decode(N('usr_script_data').table[0][0].str)) === JSON.stringify(lines('script_data')), 'SCR1 != desc script');
  ok(JSON.stringify(decode(N('usr_local_data').table[0][0].str)) === JSON.stringify(lines('local_data')), 'LOC1 != desc text');
  ok(get('script|config').toString('latin1') === lines('script_data').join('\r\n'), 'script entry != desc script');
  const callsigns = plats.map(r => r[10].str);
  for (const l of lines('script_data')) {
    const m = l.match(/^\s*group\s+\w+\s+([^;]*);/);
    if (!m) continue;
    for (const tok of m[1].trim().split(/\s+/)) {
      const cs = tok.split(':')[0];
      if (cs.endsWith('*')) ok(callsigns.some(c => c.startsWith(cs.slice(0, -1))), 'script group matches nothing: ' + tok);
      else ok(callsigns.includes(cs), 'script references missing callsign ' + cs);
    }
  }

  const summary = {};
  plats.forEach(r => {
    const pid = u32(r[1]);
    const sq = squads.filter(s => (u32(s[1]) & ~0x1ff) === pid);
    const men = units.filter(u => (u32(u[3]) & ~0x1ff) === pid && u[0].str.startsWith('i_human'));
    (summary[side(r[1])] ??= []).push(`${r[10].str} ${r[0].str} (${sq.length} squads, ${men.length} men)`);
  });
  return { errors, summary, userSide };
}

module.exports = { validate };

if (require.main === module) {
  const file = process.argv[2];
  const { errors, summary, userSide } = validate(file);
  console.log(file.split(/[\\/]/).pop(), `(player: ${userSide})`);
  for (const [s, l] of Object.entries(summary)) console.log(' ', s, '\n    ' + l.join('\n    '));
  console.log(errors.length ? 'ERRORS:\n  ' + errors.join('\n  ') : 'all checks passed');
  process.exitCode = errors.length ? 1 : 0;
}
