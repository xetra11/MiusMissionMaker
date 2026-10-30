// The game's unit database: quick-battle platoon templates (tabs: qbattle) and squad/unit
// definitions (tabs: div_units_*). Builds squad and soldier rows from them, in the same form
// the shipped missions store them.
const path = require('path');
const { readPack } = require('./azp3');
const { parse } = require('./azcf');

const u32 = (v, o = 0) => v.raw.readUInt32LE(o);
const code4 = v => (v?.raw ? v.raw.toString('latin1', 0, 4).replace(/\0/g, '') : '');
const num = b => (b ? b.readUInt32LE(0) : 0);

// Tables derived from all squads of the shipped missions (see docs/TECHNIK.md).
// Values marked "?" do not occur there and are taken from the most similar category.
const SQUAD_CLASS = {
  sq_com: 0, sq_inf: 1, sq_atr: 2, sq_mortar: 4, sq_gun: 4, sq_mg: 4, sq_sniper: 5, sq_scout: 5, sq_art_corr: 6,
  sq_apc: 7, sq_atspg: 7, sq_tank: 8, sq_atgun: 9, sq_sup: 11, sq_spam: 12,
  sq_spg: 7 /* ? */, sq_acar: 7 /* ? */, sq_atapc: 7 /* ? */, sq_spgapc: 7 /* ? */,
  sq_eng: 2 /* ? */, sq_flamer: 2 /* ? */, sq_pzgr: 1, /* ? */
};
const KNOWN_CLASSES = ['sq_com', 'sq_inf', 'sq_atr', 'sq_mortar', 'sq_gun', 'sq_mg', 'sq_sniper', 'sq_scout', 'sq_art_corr',
  'sq_apc', 'sq_atspg', 'sq_tank', 'sq_atgun', 'sq_sup', 'sq_spam'];
const ROLE_GROUP = { COM: 5, UNI: 0, SPEC: 3, IHW: 3, SCT: 2, SPOT: 3, SUPM: 3, STR: 1, SUP: 4, TRAN: 6, COMM: 3, MISC: 6, MINF: 0 /* ? */ };
const WEAPON_CLASS = { INF: 0, MG: 1, MORT: 2, GUN: 3 /* ? */, TANK: 4, SPG: 5, APC: 6, GUNL: 7, TEAM: 8, PBX: 8 /* ? */ };
const SUB_SLOT = { sq_mg: 2, sq_sup: 2, sq_com: 0, sq_inf: 1 };

function squadClass(d) {
  const type = d[2].str, role = code4(d[10]);
  if (role === 'COM') return 0;
  if (type === 'sq_apc' && role === 'TRAN') return 10;
  if (type === 'sq_atr' && code4(d[9]) !== 'INF') return 9;
  return SQUAD_CLASS[type] ?? 1;
}

// fields of a squad row that follow from the database row
function squadFields(d) {
  return {
    type: d[2].str, kind: d[5].str, role: d[6].raw, link: d[7].str, sub: d[3].str, mask: u32(d[4]),
    cls: squadClass(d), subSlot: d[3].str ? SUB_SLOT[d[3].str] ?? 2 : -1,
    heavy: code4(d[9]) === 'INF' ? 0 : 1,
    group: ROLE_GROUP[code4(d[10])] ?? 0, weapon: WEAPON_CLASS[code4(d[11])] ?? 0,
    value: u32(d[8], 0), rank: u32(d[8], 4),
  };
}

function loadUnitDb(gameDir) {
  const { entries } = readPack(path.join(gameDir, 'data', 'common', 'shared', 'packed_data', 'tabs_oprum.flatdata'));
  const entry = n => parse(entries.find(e => e.names[0] === n).payload);
  const dbs = ['div_units_ger', 'div_units_ussr', 'div_units_misc'].map(entry);
  const table = (cf, n) => cf.nodes.find(x => x.slotB === n)?.table ?? [];
  const squads = new Map(dbs.flatMap(c => table(c, 'squads').map(r => [r[0].str, r])));
  const units = new Map(dbs.flatMap(c => table(c, 'units').map(r => [r[0].str, r])));
  const randoms = new Map(dbs.flatMap(c => table(c, 'randoms').map(r => [r[0].str, r.slice(1).map(v => v.str).filter(Boolean)])));

  const qb = entry('qbattle');
  const params = n => Object.fromEntries(n.params.map(p => [p.name, p.t === 2 ? p.str : p.raw]));
  const pools = new Map(qb.nodes.filter(n => n.type === 1 && n.params?.some(p => p.name === 'sold_fams')).map(n => {
    const p = params(n);
    return [n.slotB, {
      key: n.slotB, code: num(p.code), name: p.name, fams: p.sold_fams, nams: p.sold_names, marks: p.marks_name,
      nation: p.side.toString('latin1', 0, 4).replace(/\0/g, ''),
      from: num(p.beg_date), to: num(p.end_date),
    }];
  }));
  const platoons = qb.nodes.filter(n => n.type === 1 && n.params?.some(p => p.name === 'str_sprite')).map(n => {
    const p = params(n);
    const rows = n.children.flatMap(c => qb.nodes[c].table).map(r => ({ name: r[0].str, count: u32(r[1]) }));
    return {
      key: n.slotB, name: p.name, icon: p.str_sprite, maxSquads: num(p.max_squads), pool: pools.get(p.pool),
      type: code4({ raw: p.type }), mobility: code4({ raw: p.mobility }), rows,
    };
  });
  return { squads, units, randoms, pools, platoons };
}

const squadRow = (db, name) => db.squads.get(db.randoms.get(name)?.[0] ?? name);

// [{unit row, count}] of a squad, nested crews resolved, in storage order
function composition(db, d) {
  const out = [];
  for (let c = 18; c <= 28; c += 2) {
    const n = d[c].str;
    if (!n) continue;
    const count = u32(d[c + 1]);
    const nested = db.squads.get(n);
    if (nested) for (let i = 0; i < count; i++) out.push(...composition(db, nested));
    else if (db.units.has(n)) out.push({ row: db.units.get(n), count });
    // members that exist in no table (typos in the game data, other theatres) are left out
  }
  return out;
}

// soldiers and vehicles of a squad as plain data
function members(db, d) {
  const list = [];
  for (const { row, count } of composition(db, d)) for (let i = 0; i < count; i++) list.push(row);
  const vehicle = list.find(r => r[2].str === 'i_techn');
  return list.map(r => ({
    techn: r[2].str === 'i_techn', db: r[3].str, model: r[4].str, ui: r[1].str, weapon: r[8].str, mark: u32(r[5]),
    skill: [r[7].raw.readFloatLE(0), r[7].raw.readFloatLE(4)], inVehicle: !!vehicle && r !== vehicle,
  }));
}

// a platoon's squads; "size" repeats the last squad type up to the wanted number of squads
function platoonSquads(db, tpl, size) {
  const names = tpl.rows.flatMap(r => Array(r.count).fill(r.name));
  while (size && names.length < size) names.push(names[names.length - 1]);
  return names.map(n => {
    const d = squadRow(db, n);
    if (!d) throw new Error(`platoon ${tpl.key}: unknown squad ${n}`);
    return d;
  });
}

// rough strength of a platoon, for the reference
function platoonSummary(db, tpl) {
  let men = 0;
  const vehicles = [];
  for (const d of platoonSquads(db, tpl)) {
    for (const m of members(db, d)) { if (m.techn) vehicles.push(m.model); else men++; }
  }
  return { men, vehicles };
}

// service period of a parent unit; dates are stored as 0xYYYYMMDD
function period(pool) {
  const text = v => { const h = v.toString(16); return h.slice(0, 4) + '-' + h.slice(4, 6); };
  return { from: pool.from, to: pool.to, text: text(pool.from) + ' to ' + text(pool.to) };
}

module.exports = { period, loadUnitDb, squadFields, members, platoonSquads, platoonSummary, squadRow, KNOWN_CLASSES };
