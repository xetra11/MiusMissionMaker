// MiusMissionMaker scenario generator: JSON -> .mispack for Graviteam Tactics: Mius-Front.
//
//   node tools/scenario.js build     <scenario.json> [--install] [--start] [--game <dir>] [--out <file>]
//   node tools/scenario.js start     <mission.mispack> [--game <dir>]
//   node tools/scenario.js reference [--game <dir>]
//        regenerates the reference section of README.md, docs/UNITS.md and scenario.schema.json
//
// Map section, weather and player nation come from a shipped "base" mission; all forces,
// the mission script and the texts are rebuilt from the JSON. Platoons can be taken from
// any shipped mission or be built from the game's unit database; see docs/UNITS.md.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { readPack } = require('./azp3');
const { parse, serialize } = require('./azcf');
const { validate } = require('./validate_mission');
const installer = require('./install_mission');
const mapdata = require('./mapdata');
const unitdb = require('./unitdb');

const DEFAULT_GAME = 'C:/Program Files (x86)/Steam/steamapps/common/Graviteam Tactics Mius-Front';
const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- vocabulary
const NAME_RE = /^[a-z][a-z0-9_]{0,30}$/;
// callsign names from the game's localisation; others are allowed but may show oddly in-game
const CALLSIGN_NAMES = ('pine linden birch asp beech chestnut willow oak fir broom guelder cedar reed poplar cherry ' +
  'tiger jaguar leopard panther elefant lion beaver viper wolf fox bear lynx hawk eagle crocodile falcon').split(' ');
const RESERVED = ['own', 'foe', 'own_main', 'foe_main', 'main', 'deploy', 'process', 'goto', 'battle_victory',
  'battle_defeat', 'foe_later', 'own_later'];
// all movement modes the script parser knows (adv_game.codelib); descriptions are inferred
const MODES = {
  assault: 'aggressive advance, fighting through to the point',
  attack: 'attack the point',
  march: 'move in march order: fast, not ready to fight',
  fast_move: 'fast move',
  defence: 'move to the point and take up defence there',
  siege: 'surround and besiege the point',
  recon: 'reconnaissance move',
  hidden: 'concealed move',
  scan: 'observe the area',
  enter: 'mount vehicles',
  leave: 'dismount from vehicles',
};
const PLANS = { attack: 'ATAK', defend: 'DEF', hold: 'HOLD' };
const DEPLOY_TYPES = { trench: 'dug in at prepared positions', place: 'placed in the open' };
// all formations the script parser knows; "tested" = used by the shipped missions
const FORMATIONS = {
  columnlr: 'column, tested; default for place',
  line2: 'two lines, tested; default for trench',
  line: 'single line, tested',
  line1: 'single line, tested with anti-tank guns',
  battery: 'gun/mortar battery, tested',
  line3: 'three lines',
  column: 'column', col: 'column', columnl: 'column left', columnr: 'column right',
  coll: 'column left', colr: 'column right', collr: 'column',
};
// all script commands the parser knows; go, run, ret, def and delay are handled by the interpreter
const SCRIPT_COMMANDS = ['def', 'group', 'place', 'trench', 'ambush', 'detach', 'formation', 'move', '+move', 'defence', 'block_ai', 'track',
  'camera', 'map', 'skip', 'run', 'go', 'ret', 'delay', 'time', 'mark', 'unmark', 'chmark', 'event', 'blink', 'unblink', 'blink_tab', 'unblink_tab',
  'wait_sel', 'wait_sel1', 'wait_order', 'wait_orders', 'wait_in', 'wait_bal', 'wait_lost', 'wait_capt', 'endgame', 'setac', 'check', 'press',
  'achiv', 'clear_mem'];
const FACINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const ROLE_NAMES = {
  UNI: 'infantry', STR: 'armour', SCT: 'reconnaissance', SUP: 'support weapons', SUPM: 'mobile support',
  COM: 'battalion HQ', COMC: 'company HQ', REP: 'recovery/repair',
};
// platoon category bytes (plats column 1) by template type, from the shipped missions
const PLATOON_CATEGORY = { UNI: [0, 1], STR: [1, 2], SCT: [2, 3], SUP: [3, 4], SUPM: [3, 5], COM: [4, 6], COMC: [3, 7], REP: [4, 8] };
// shipped platoons whose rows serve as column templates for database-built platoons
const PROTO = {
  GER: { platoon: 'wer_mibn_1141_plat@tr04', vehicle: 'wer_pz_coy_plat1@tr06' },
  USSR: { platoon: 'ra_rbn_1242_plat2@tr04', vehicle: 'ra_tbr_42_bn2_sm_plat@tr04' },
};

// ---------------------------------------------------------------- helpers
const u32 = (v, o = 0) => v.raw.readUInt32LE(o);
const setU32 = (v, o, x) => v.raw.writeUInt32LE(x >>> 0, o);
const setVec = (v, xs) => xs.forEach((x, i) => v.raw.writeFloatLE(x, i * 4));
const code4 = (v, o = 0) => v.raw.toString('latin1', o, o + 4).replace(/\0/g, '');
const setCode4 = (v, o, s) => { v.raw.fill(0, o, o + 4); v.raw.write(s, o, 'latin1'); };
const hex8 = x => (x >>> 0).toString(16).padStart(8, '0');
const cloneVal = v => ({ ...v, raw: Buffer.from(v.raw), pad: Buffer.from(v.pad), rawName: v.rawName && Buffer.from(v.rawName) });
const cloneRow = r => r.map(cloneVal);
const node = (cf, name) => cf.nodes.find(n => n.slotB === name);
const param = (cf, sect, name) => node(cf, sect).params.find(p => p.name === name);
const platId = r => u32(r[1]);
const nationOf = r => code4(r[1], 12);
const POOL_MASK = 0xff800000;
const emptyCell = () => ({ raw: Buffer.alloc(16), t: 6, pad: Buffer.alloc(12) });
const baseId = m => m.name.split('_')[0];
const NATION_NAME = { GER: 'German', USSR: 'Soviet' };

let seed = 1;
const rnd = (lo, hi) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return lo + (seed >>> 8) % (hi - lo + 1); };

class SpecError extends Error {}
const fail = msg => { throw new SpecError(msg); };

// the game uses cp1251, which has no umlauts; keep texts plain ASCII
function gameText(s, where) {
  const t = String(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss').replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"').replace(/[\u2013\u2014]/g, '-');
  const bad = t.match(/[^\x20-\x7e]/);
  if (bad) fail(`${where}: only plain ASCII characters are allowed, found ${JSON.stringify(bad[0])}`);
  return t;
}

// ---------------------------------------------------------------- shipped missions
function loadMission(file) {
  const { data, entries } = readPack(file);
  const get = k => entries.find(e => e.names[0] + '|' + e.names[1] === k).payload;
  const m = {
    name: path.basename(file, '.mispack'), file, data, entries,
    tac: parse(get('tacgame_image|tacimage')), qb: parse(get('qbattle|config')), desc: parse(get('desc|config')),
    script: get('script|config').toString('latin1'),
  };
  m.userSide = code4(param(m.tac, 'i_gamespec:gamespec', 'user_side'));
  m.enemySide = code4(param(m.tac, 'i_gamespec:gamespec', 'enemy_side'));
  m.polygon = param(m.tac, 'i_gamespec:gamespec', 'polygon').str;
  m.date = parseInt(param(m.tac, 'i_gamespec:gamespec', 'ammo_id').str, 16); // 0xYYYYMMDD
  const text = get('desc|text').toString('latin1').split('\r\n');
  m.title = text[0];
  m.description = text[1];

  // battlefield grid: square cells, each owned by a side at the start (NEUT = no-man's land)
  m.cells = node(m.tac, 'ctrl_brief').table.map(r => ({ side: code4(r[0]), x: r[1].raw.readFloatLE(0), z: r[1].raw.readFloatLE(4) }));
  const xs = [...new Set(m.cells.map(c => c.x))].sort((a, b) => a - b);
  m.cellSize = xs[1] - xs[0];
  const h = m.cellSize / 2;
  m.extent = {
    x0: Math.min(...m.cells.map(c => c.x)) - h, x1: Math.max(...m.cells.map(c => c.x)) + h,
    z0: Math.min(...m.cells.map(c => c.z)) - h, z1: Math.max(...m.cells.map(c => c.z)) + h,
  };
  m.points = [...m.script.matchAll(/^\s*def\s+(\w+)\s+(-?[\d.]+)\s*,\s*-?[\d.]+\s*,\s*(-?[\d.]+)/gm)]
    .map(x => ({ name: x[1], x: +x[2], z: +x[3] }));
  return m;
}

// 'player' | 'enemy' | 'neutral' | 'outside' for a map position of a base
function areaOf(base, [x, z]) {
  const e = base.extent;
  if (x < e.x0 || x > e.x1 || z < e.z0 || z > e.z1) return 'outside';
  const h = base.cellSize / 2;
  const c = base.cells.find(c => Math.abs(x - c.x) <= h && Math.abs(z - c.z) <= h);
  if (!c || c.side === 'NEUT') return 'neutral';
  return c.side === base.userSide ? 'player' : 'enemy';
}

function loadMissions(gameDir) {
  const dir = path.join(gameDir, 'data', 'oprum', 'shared', 'missions');
  if (!fs.existsSync(dir)) fail(`game folder not found: ${dir} (use --game <dir>)`);
  return fs.readdirSync(dir).filter(f => f.endsWith('.mispack')).sort().map(f => loadMission(path.join(dir, f)));
}

// Builds a platoon that no shipped mission contains from the game's templates and unit database.
function platoonFromDb(tpl, db, shipped, size) {
  const nation = tpl.pool.nation;
  const proto = shipped.get(PROTO[nation].platoon);
  const protoHuman = proto.units.find(u => u[0].str.startsWith('i_human'));
  const protoTech = shipped.get(PROTO[nation].vehicle).units.find(u => u[0].str.startsWith('i_techn'));
  const pid = platId(proto.plat);
  const squads = [], units = [];
  let number = 100;
  unitdb.platoonSquads(db, tpl, size).forEach((d, i) => {
    const f = unitdb.squadFields(d);
    const sid = pid + 0x20 * (i + 1);
    const r = cloneRow(proto.squads[1]);
    r[0].str = 'sq_' + hex8(sid);
    setU32(r[1], 0, sid);
    r[2].str = f.type; r[4].str = f.type; r[3].str = f.kind;
    f.role.copy(r[9].raw);
    setU32(r[10], 0, 0); setU32(r[10], 4, f.cls); setU32(r[10], 8, f.subSlot);
    setU32(r[12], 0, f.heavy); setU32(r[12], 4, f.group); setU32(r[12], 8, f.value); setU32(r[12], 12, f.weapon);
    setU32(r[18], 12, f.rank);
    r[21].str = f.link; r[22].str = f.sub;
    setU32(r[23], 0, f.mask);
    squads.push(r);

    const list = unitdb.members(db, d);
    const vehicleIdx = list.findIndex(m => m.techn);
    const vehicleName = vehicleIdx >= 0 ? 'i_techn:tec_' + hex8(sid + vehicleIdx + 1) : '';
    list.forEach((m, j) => {
      const id = sid + j;
      const c = cloneRow(m.techn ? protoTech : protoHuman);
      c[1].str = m.db; c[2].str = m.model;
      setU32(c[3], 0, id);
      if (m.techn) {
        c[0].str = 'i_techn:tec_' + hex8(id + 1);
        setU32(c[7], 0, number++);
        c[8].str = tpl.pool.marks;
        setU32(c[18], 0, m.mark);
        c[19].str = m.ui;
      } else {
        c[0].str = 'i_human:hum_' + hex8(id);
        c[5].str = m.inVehicle ? vehicleName : '';
        c[6].str = m.weapon;
        setVec(c[12], [m.skill[0], 1, m.skill[1]]);
      }
      units.push(c);
    });
  });
  const pool = cloneRow(proto.pool);
  pool[0].str = tpl.pool.key;
  setU32(pool[1], 0, tpl.pool.code * 0x800000);
  pool[2].str = tpl.pool.name; pool[3].str = tpl.pool.fams; pool[4].str = tpl.pool.nams;
  const plat = cloneRow(proto.plat);
  plat[0].str = tpl.key; plat[2].str = tpl.icon; plat[3].str = tpl.name;
  (PLATOON_CATEGORY[tpl.type] ?? PLATOON_CATEGORY.SUP).forEach((b, i) => { plat[1].raw[8 + i] = b; });
  const around = proto.around && cloneRow(proto.around);
  if (around) { around[2].str = tpl.icon; around[7].str = tpl.pool.key; }
  return {
    key: tpl.key, template: tpl.key, nation, mission: 'unit database', callsign: '', icon: tpl.icon, pool, plat, squads, units,
    brief: undefined, trigger: undefined, around, fromDb: true,
    men: units.filter(u => u[0].str.startsWith('i_human')).length,
    vehicles: units.filter(u => u[0].str.startsWith('i_techn')).map(u => u[2].str),
    squadTypes: squads.map(r => r[3].str),
  };
}

// Every platoon type found in the shipped missions. Training missions ship thinned-out
// platoons, so "<template>" picks the strongest variant and "<template>@<mission>" a specific one.
function buildCatalog(missions, db) {
  const catalog = new Map();
  const variants = new Map();
  const nameMax = {};
  for (const m of missions) {
    const N = n => node(m.tac, n);
    const plats = N('plats').table, squads = N('squads').table, units = N('units').table;
    for (const s of squads) for (const c of [11, 16, 20]) {
      const [k, n] = s[c].str.split(':');
      if (n) nameMax[k] = Math.max(nameMax[k] ?? 0, +n);
    }
    for (const p of plats) {
      const key = p[0].str + '@' + baseId(m);
      if (catalog.has(key)) continue;
      const pid = platId(p), nation = nationOf(p);
      const sq = squads.filter(r => (u32(r[1]) & ~0x1ff) === pid);
      const un = units.filter(r => (u32(r[3]) & ~0x1ff) === pid);
      const ordinal = u32(p[7], 12);
      catalog.set(key, {
        key, template: p[0].str, nation, mission: m.name, callsign: p[10].str, icon: p[2].str,
        pool: N('pools').table.find(r => u32(r[1]) === (pid & POOL_MASK) && code4(r[1], 4) === nation),
        plat: p, squads: sq, units: un,
        brief: N('brief').table.find(r => u32(r[0], 4) === pid),
        trigger: N('triggers')?.table.find(r => u32(r[0], 8) === ordinal),
        around: node(m.qb, 'around')?.table.find(r => r[9].str === p[10].str),
        men: un.filter(u => u[0].str.startsWith('i_human')).length,
        vehicles: un.filter(u => u[0].str.startsWith('i_techn')).map(u => u[2].str),
        squadTypes: sq.map(r => r[3].str),
      });
      (variants.get(p[0].str) ?? variants.set(p[0].str, []).get(p[0].str)).push(catalog.get(key));
    }
  }
  for (const [template, list] of variants) {
    catalog.set(template, list.reduce((a, b) => (b.men + b.vehicles.length > a.men + a.vehicles.length ? b : a)));
  }
  for (const tpl of db.platoons) {
    if (!catalog.has(tpl.key)) {
      catalog.set(tpl.key, platoonFromDb(tpl, db, catalog));
      variants.set(tpl.key, []);
    }
  }
  return { catalog, variants, nameMax };
}

// ---------------------------------------------------------------- spec checks
function checkSpec(spec, base, catalog) {
  if (!spec.id || !/^[a-z0-9_]{1,40}$/.test(spec.id)) fail('"id" missing or invalid (a-z, 0-9, _ only; max. 40 characters)');
  if (!spec.title) fail('"title" missing');
  if (spec.menu && !['missions', 'training'].includes(spec.menu)) fail('"menu" must be "missions" or "training"');
  const points = spec.points ?? {};
  for (const [n, p] of Object.entries(points)) {
    if (!NAME_RE.test(n) || RESERVED.includes(n)) fail(`point name "${n}" is invalid or reserved`);
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) fail(`point "${n}" must be [x, z]`);
    if (areaOf(base, p) === 'outside') {
      const e = base.extent;
      fail(`point "${n}" [${p}] is outside the map of base ${baseId(base)} (x ${e.x0}..${e.x1}, z ${e.z0}..${e.z1})`);
    }
  }
  const needPoint = (n, where) => { if (!(n in points)) fail(`${where}: point "${n}" is not defined in "points"`); };
  const checkDeploy = (d, where, sideKey) => {
    needPoint(d.at, where);
    if (d.type && !DEPLOY_TYPES[d.type]) fail(`${where}: "type" must be ${Object.keys(DEPLOY_TYPES).join(' or ')}`);
    if (d.formation && !FORMATIONS[d.formation]) fail(`${where}: "formation" must be one of ${Object.keys(FORMATIONS).join(', ')}`);
    if (d.facing && !FACINGS.includes(d.facing)) fail(`${where}: "facing" must be one of ${FACINGS.join(', ')}`);
    const area = areaOf(base, points[d.at]);
    if (area !== sideKey) console.warn(`note: ${where} deploys at "${d.at}", which lies in the ${area} area, not in the ${sideKey} start area`);
  };
  const seen = new Set();
  for (const [sideKey, nation] of [['player', base.userSide], ['enemy', base.enemySide]]) {
    const side = spec.sides?.[sideKey];
    if (!side?.platoons?.length) fail(`"sides.${sideKey}.platoons" missing or empty`);
    for (const [i, p] of side.platoons.entries()) {
      const where = `sides.${sideKey}.platoons[${i}]`;
      if (!NAME_RE.test(p.callsign ?? '') || RESERVED.includes(p.callsign)) fail(`${where}: "callsign" missing or invalid (a-z, 0-9, _)`);
      if (seen.has(p.callsign)) fail(`${where}: callsign "${p.callsign}" used twice`);
      seen.add(p.callsign);
      if (!CALLSIGN_NAMES.includes(p.callsign.replace(/_\d+$/, ''))) {
        console.warn(`note: callsign "${p.callsign}" does not use a name from the game's callsign list (e.g. pine_01, panther_02)`);
      }
      const e = catalog.get(p.unit, p.size);
      if (!e) fail(`${where}: unit "${p.unit}" unknown (see docs/UNITS.md)`);
      if (e.nation !== nation) fail(`${where}: "${p.unit}" is ${e.nation}, but this side is ${nation} (base ${baseId(base)})`);
      if (p.position) {
        if (!(Array.isArray(p.position) && p.position.length === 2 && p.position.every(Number.isFinite))) fail(`${where}: "position" must be [x, z]`);
        if (areaOf(base, p.position) === 'outside') fail(`${where}: "position" is outside the map of base ${baseId(base)}`);
      }
      if (p.plan && !PLANS[p.plan]) fail(`${where}: "plan" must be ${Object.keys(PLANS).join(', ')}`);
      if (p.size && !(Number.isInteger(p.size) && p.size >= 1 && p.size <= 15)) fail(`${where}: "size" must be a whole number from 1 to 15`);
      if (e.period && (base.date < e.period.from || base.date > e.period.to)) {
        console.warn(`note: ${where}: "${p.unit}" is in service ${e.period.text}; the mission date of base ${baseId(base)} lies outside`);
      }
      if (p.deploy) checkDeploy(p.deploy, where + '.deploy', sideKey);
    }
    if (side.deploy) checkDeploy(side.deploy, `sides.${sideKey}.deploy`, sideKey);
    for (const [i, o] of (side.orders ?? []).entries()) {
      needPoint(o.to, `sides.${sideKey}.orders[${i}]`);
      if (o.mode && !MODES[o.mode]) fail(`sides.${sideKey}.orders[${i}]: "mode" must be one of ${Object.keys(MODES).join(', ')}`);
    }
    if (!side.deploy && side.platoons.some(p => !p.deploy && !p.position)) {
      fail(`sides.${sideKey}: without "deploy" every platoon needs "position" or "deploy"`);
    }
  }
  if (seen.size > 60) fail('at most 60 platoons per scenario');
  if (spec.defeat?.enemy_reaches) needPoint(spec.defeat.enemy_reaches, 'defeat.enemy_reaches');
  if (spec.victory?.own_reaches) needPoint(spec.victory.own_reaches, 'victory.own_reaches');
  if (spec.camera?.at) needPoint(spec.camera.at, 'camera.at');
  if (spec.camera?.direction && !FACINGS.includes(spec.camera.direction)) fail(`camera.direction must be one of ${FACINGS.join(', ')}`);
}

// ---------------------------------------------------------------- script + texts
function facingTo(from, to) {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 'E' : 'W') : (dz >= 0 ? 'N' : 'S');
}

function makeScript(spec) {
  const pts = spec.points ?? {};
  const fmt = n => Number.isInteger(n) ? n.toFixed(1) : String(n);
  const own = spec.sides.player, foe = spec.sides.enemy;
  const L = ['//generated by MiusMissionMaker', 'main()', '{'];
  for (const [n, [x, z]] of Object.entries(pts)) L.push(`\tdef ${n} ${fmt(x)}, 0.0, ${fmt(z)};`);
  L.push('');
  const groups = [['own', own], ['foe', foe]];
  for (const [g, s] of groups) L.push(`\tgroup ${g} ${s.platoons.map(p => p.callsign).join(' ')};`);
  for (const [g, s] of groups) {
    const rest = s.platoons.filter(p => !p.deploy);
    if (rest.length && rest.length !== s.platoons.length) L.push(`\tgroup ${g}_main ${rest.map(p => p.callsign).join(' ')};`);
  }
  L.push('');
  if (foe.orders?.length || foe.ai === false) L.push('\tblock_ai foe;');
  if (own.ai === false) L.push('\tblock_ai own;');
  L.push('');
  // where a side stands: its deploy point, else its first platoon
  const anchor = s => pts[s.deploy?.at] ?? s.platoons[0].position ?? pts[s.platoons[0].deploy?.at] ?? [0, 0];
  const deployLine = (target, d, from, other) => {
    const type = d.type ?? 'place';
    const formation = d.formation ?? (type === 'trench' ? 'line2' : 'columnlr');
    return `\t${type === 'trench' ? 'trench' : 'place'} ${target} ${d.at} ${formation} ${d.facing ?? facingTo(from, other)};`;
  };
  for (const [g, s, o] of [['own', own, foe], ['foe', foe, own]]) {
    const there = anchor(o);
    const rest = s.platoons.filter(p => !p.deploy);
    if (s.deploy && rest.length) L.push(deployLine(rest.length === s.platoons.length ? g : g + '_main', s.deploy, pts[s.deploy.at], there));
    for (const p of s.platoons.filter(p => p.deploy)) L.push(deployLine(p.callsign, p.deploy, pts[p.deploy.at], there));
  }
  L.push('');
  const cam = spec.camera ?? {};
  const camAt = cam.at ?? own.deploy?.at ?? own.platoons.find(p => p.deploy)?.deploy.at;
  if (camAt) L.push(`\tcamera ${camAt} ${cam.direction ?? 'NE'} ${cam.zoom ?? 0.3};`);
  if (own.deploy) L.push(`\ttrack own ${own.deploy.at};`);
  L.push('');
  const deployPhase = spec.deploy_phase !== false;
  L.push(deployPhase ? '\tskip endgame;' : '\tskip deploy endgame;', '', '\trun deploy;', '}', '');

  // briefing / deployment phase
  L.push('deploy()', '{');
  if (camAt) L.push(`\tgoto ${camAt} brief_own;`, '\tdelay 6.0;', '\tunmark brief_own;');
  const foeAt = foe.deploy?.at ?? foe.platoons.find(p => p.deploy)?.deploy.at;
  if (foeAt) L.push(`\tgoto ${foeAt} brief_foe;`, '\tdelay 6.0;', '\tunmark brief_foe;');
  if (camAt) L.push(`\tcamera ${camAt};`);
  L.push('');
  if (deployPhase) L.push('\tblink common pause info_end_deploy;', '', '\twait_order 1st_orders;');
  L.push('\tblink common pause info_1st_orders;', '', '\tgo process;', '}', '');

  // battle
  L.push('process()', '{');
  const orderLines = (g, s) => {
    const out = [];
    (s.orders ?? []).forEach((o, i) => {
      if (o.wait_s) out.push(`\tdelay ${fmt(o.wait_s)};`);
      const queued = i > 0 && !o.wait_s;
      out.push(`\t${queued ? '+' : ''}move ${g} ${o.to} ${o.mode ?? 'attack'};`);
    });
    return out;
  };
  const foeOrders = orderLines('foe', foe), ownOrders = orderLines('own', own);
  const firstFoeTarget = foe.orders?.[0]?.to;
  // orders without delays first, delayed ones run in parallel functions
  const split = lines => { const i = lines.findIndex(l => l.includes('delay')); return i < 0 ? [lines, []] : [lines.slice(0, i), lines.slice(i)]; };
  const [foeNow, foeLater] = split(foeOrders), [ownNow, ownLater] = split(ownOrders);
  L.push(...foeNow, ...ownNow);
  if (firstFoeTarget) L.push(`\tgoto ${firstFoeTarget} info_attack;`, '\tchmark info_attack info_attack 0xff0000;', '\tdelay 7.0;');
  if (spec.time_scale) L.push(`\ttime ${spec.time_scale};`);
  if (spec.victory) L.push('\tgo battle_victory;');
  if (spec.defeat) L.push('\tgo battle_defeat;');
  if (foeLater.length) L.push('\tgo foe_later;');
  if (ownLater.length) L.push('\tgo own_later;');
  if (firstFoeTarget) L.push('\tdelay 300.0;', '\tunmark info_attack;');
  L.push('}', '');
  if (foeLater.length) L.push('foe_later()', '{', ...foeLater, '}', '');
  if (ownLater.length) L.push('own_later()', '{', ...ownLater, '}', '');

  if (spec.victory) {
    L.push('battle_victory()', '{');
    if (spec.victory.after_s) L.push(`\tdelay ${fmt(spec.victory.after_s)};`);
    if (spec.victory.own_reaches) {
      L.push(`\twait_in own ${spec.victory.own_reaches} ${fmt(spec.victory.radius ?? 200)} ${spec.victory.share ?? 0.5};`);
    }
    if (spec.victory.balance) L.push(`\twait_bal ${fmt(spec.victory.balance)};`);
    L.push('\tendgame victory;', '}', '');
  }
  if (spec.defeat) {
    L.push('battle_defeat()', '{');
    if (spec.defeat.enemy_reaches) {
      L.push(`\twait_in foe ${spec.defeat.enemy_reaches} ${fmt(spec.defeat.radius ?? 200)} ${spec.defeat.share ?? 0.5};`);
    }
    L.push('\tendgame defeat;', '}', '');
  }
  L.push('goto()', '{', '\tmark @ @1;', '\tcamera @;', '\tevent @ @1;', '\tret;', '}');
  return L;
}

const DEFAULT_TEXTS = {
  brief_own: 'Your forces',
  brief_foe: 'Enemy forces',
  info_end_deploy: 'Redeploy your units if you want, then press [%do_pause] to finish deployment',
  info_1st_orders: 'Give initial orders if you want, and press [%do_pause] again to start battle',
  info_attack: 'The enemy attacks',
};

function makeTexts(spec) {
  const t = { ...DEFAULT_TEXTS, ...(spec.texts ?? {}) };
  for (const k of Object.keys(t)) if (!/^[a-z0-9_]+$/.test(k)) fail(`texts: key "${k}" invalid (a-z, 0-9, _)`);
  return [
    gameText(spec.title, 'title'),
    gameText(spec.description ?? '', 'description'),
    '',
    ...Object.entries(t).map(([k, v]) => `#${k} ${gameText(v, 'texts.' + k)}`),
  ];
}

function lineBlock(magic, lines) {
  const texts = lines.map(l => Buffer.from(l + '\0', 'latin1'));
  const h = Buffer.alloc(13 + lines.length * 4);
  h.write(magic, 0, 'latin1');
  h.writeUInt32LE(lines.length, 5);
  h.writeUInt32LE(texts.reduce((a, b) => a + b.length, 0), 9);
  let o = 0;
  texts.forEach((t, i) => { h.writeUInt32LE(o, 13 + i * 4); o += t.length; });
  return Buffer.concat([h, ...texts]).toString('latin1');
}

function setLines(nd, lines) {
  const proto = nd.table[0][0];
  nd.table = lines.map(s => [{ ...cloneVal(proto), str: s, nul: true }]);
}

// ---------------------------------------------------------------- forces
function buildForces(spec, base, tac, qb, catalog, nameMax) {
  const N = n => node(tac, n);
  const plats = N('plats'), squads = N('squads'), units = N('units'), pools = N('pools'), brief = N('brief');
  const trig = N('triggers'), around = node(qb, 'around');

  // relation templates (player = U, enemy = E) from the base before clearing it
  const baseRel = r => nationOf(r) === base.userSide ? 'U' : 'E';
  const ref = { U: {}, E: {} };
  for (const p of plats.table) {
    const rel = baseRel(p);
    ref[rel].plat ??= p;
    ref[rel].brief ??= brief.table.find(b => u32(b[0], 4) === platId(p));
    ref[rel].trigger ??= trig?.table.find(t => u32(t[0], 8) === u32(p[7], 12));
  }
  // AI plan/state flags are set per mission and side, not per platoon type: take the value
  // most common on that side of the base (keeps transplanted platoons consistent with it)
  const majority = list => {
    const n = new Map();
    for (const b of list) n.set(b.toString('hex'), (n.get(b.toString('hex')) ?? 0) + 1);
    const best = [...n].sort((a, b) => b[1] - a[1])[0];
    return best && Buffer.from(best[0], 'hex');
  };
  const platRel = new Map(plats.table.map(p => [platId(p), baseRel(p)]));
  for (const rel of ['U', 'E']) {
    const ps = plats.table.filter(p => baseRel(p) === rel);
    ref[rel].plan = majority(ps.map(p => p[5].raw));
    ref[rel].links = majority(ps.map(p => p[4].raw));
    ref[rel].squadFlag = majority(squads.table.filter(s => platRel.get(u32(s[1]) & ~0x1ff) === rel).map(s => s[15].raw));
    ref[rel].trigFlag = majority((trig?.table ?? []).filter(t => (code4(t[0], 12) === base.userSide ? 'U' : 'E') === rel).map(t => t[2].raw));
  }
  for (const t of [pools, plats, squads, units, brief, trig, N('bgs'), N('supports'), around]) if (t) t.table = [];

  const usedPools = new Set();
  const poolMap = new Map(), poolIdx = new Map();
  const allocPool = e => {
    const k = e.pool[0].str + '|' + e.nation;
    if (poolMap.has(k)) return poolMap.get(k);
    const src = u32(e.pool[1]);
    const nibbles = [(src >>> 20) & 0xf, 0x8, 0x0, 0x4, 0xc, 0x2, 0x6, 0xa, 0xe];
    const id = nibbles.map(n => ((src & 0xff000000) | (n << 20)) >>> 0).find(c => !usedPools.has(c + e.nation));
    if (id === undefined) fail(`too many pools of type ${hex8(src)} for ${e.nation}`);
    usedPools.add(id + e.nation);
    poolMap.set(k, id);
    const row = cloneRow(e.pool);
    setU32(row[1], 0, id);
    pools.table.push(row);
    return id;
  };
  const name = (key) => `${key}:${rnd(1, nameMax[key] ?? 50)}`;

  let seq = 0, ordinal = 0;
  const qbIndex = {};
  const counts = {};
  for (const [sideKey, rel] of [['player', 'U'], ['enemy', 'E']]) {
    const side = spec.sides[sideKey];
    counts[sideKey] = side.platoons.length;
    for (const p of side.platoons) {
      const e = catalog.get(p.unit, p.size);
      const poolId = allocPool(e);
      const idx = (poolIdx.get(poolId) ?? 0) + 1;
      poolIdx.set(poolId, idx);
      seq += 1; ordinal += 1;
      if (idx > 15) fail(`too many platoons from pool ${e.pool[0].str} (max. 15)`);
      const newId = ((poolId | 0x80000) + (seq << 13) + (idx << 9)) >>> 0;
      const srcId = platId(e.plat);
      const pos = p.position ?? spec.points[p.deploy?.at ?? side.deploy.at];
      const famKey = e.squads[0]?.[11].str.split(':')[0] ?? 'sn_ger_fams';
      const namKey = famKey.replace('fams', 'nams');

      // squads + soldiers/vehicles keep their offsets inside the platoon
      let leaderFam = null;
      for (const s of e.squads) {
        const r = cloneRow(s);
        const sid = newId + (u32(s[1]) - srcId);
        r[0].str = 'sq_' + hex8(sid);
        setU32(r[1], 0, sid);
        setCode4(r[8], 0, rel === 'U' ? 'USER' : 'ENEM');
        if (ref[rel].squadFlag) ref[rel].squadFlag.copy(r[15].raw);
        const fam = name(famKey);
        leaderFam ??= fam;
        r[11].str = fam; r[16].str = fam;
        r[20].str = name(namKey);
        squads.table.push(r);
      }
      const remap = s => s.replace(/_([0-9a-f]{8})$/, (_, h) => '_' + hex8(newId + (parseInt(h, 16) - srcId)));
      for (const u of e.units) {
        const r = cloneRow(u);
        setU32(r[3], 0, newId + (u32(u[3]) - srcId));
        r[0].str = remap(u[0].str);
        if (r[5].str) r[5].str = remap(u[5].str);
        units.table.push(r);
      }

      // platoon row (adapt column count between mission versions)
      const r = cloneRow(e.plat).slice(0, plats.cols);
      while (r.length < plats.cols) r.push(emptyCell());
      setU32(r[1], 0, newId);
      r[6].str = leaderFam ?? r[6].str; r[8].str = r[6].str;
      ref[rel].plat[7].raw.copy(r[7].raw, 0, 0, 8); // colour + player/enemy flag
      if (ref[rel].links) ref[rel].links.copy(r[4].raw);
      if (ref[rel].plan) ref[rel].plan.copy(r[5].raw);
      setU32(r[7], 12, ordinal);
      setVec(r[9], [pos[0], 0, pos[1]]);
      r[10].str = p.callsign;
      if (p.plan) setCode4(r[5], 8, PLANS[p.plan]);
      plats.table.push(r);

      // map marker
      const markerSrc = e.brief ?? ref[rel].brief ?? ref[rel === 'U' ? 'E' : 'U'].brief;
      if (!markerSrc) fail(`base ${base.name} has no map marker to copy`);
      const b = cloneRow(markerSrc);
      if (ref[rel].brief) ref[rel].brief[0].raw.copy(b[0].raw, 8, 8, 12); // marker colour
      setU32(b[0], 4, newId);
      b[1].raw.writeFloatLE(pos[0], 0); b[1].raw.writeFloatLE(pos[1], 4);
      brief.table.push(b);

      // deployment trigger (only in newer mission versions)
      if (trig) {
        const trigSrc = e.trigger ?? ref[rel].trigger ?? ref[rel === 'U' ? 'E' : 'U'].trigger;
        if (!trigSrc) fail(`base ${base.name} has no trigger to copy`);
        const t = cloneRow(trigSrc);
        setU32(t[0], 8, ordinal);
        setCode4(t[0], 12, e.nation);
        setVec(t[1], [pos[0], pos[1], 0]);
        if (ref[rel].trigFlag) ref[rel].trigFlag.copy(t[2].raw);
        trig.table.push(t);
      }

      // quick-battle editor list (kept consistent, not needed to play)
      if (around && e.around) {
        const a = cloneRow(e.around);
        a[9].str = p.callsign;
        qbIndex[e.nation] = (qbIndex[e.nation] ?? -1) + 1;
        setU32(a[3], 0, qbIndex[e.nation]);
        around.table.push(a);
      }
    }
  }
  if (seq > 63) fail('at most 63 platoons');
  return counts;
}

// ---------------------------------------------------------------- pack writer
function writePack(base, payloads, outFile) {
  const align = (x, a) => Math.ceil(x / a) * a;
  const header = Buffer.from(base.data.subarray(0, 0x10000));
  let pos = 0x10000;
  const blobs = [];
  for (const e of base.entries) {
    const body = payloads[e.names[0] + '|' + e.names[1]] ?? e.payload;
    let sum = 0;
    for (const b of body) sum = (sum + b) >>> 0;
    header.writeUInt32LE(sum, e.dirOff + 4);
    header.writeUInt32LE(pos, e.dirOff + 8);
    header.writeUInt32LE(body.length, e.dirOff + 16);
    blobs.push([pos, body]);
    pos = align(pos + body.length, 0x1000);
  }
  const out = Buffer.alloc(align(pos, 0x10000));
  header.copy(out, 0);
  for (const [o, b] of blobs) b.copy(out, o);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);
}

// ---------------------------------------------------------------- start a battle
// The game's menu writes the mission's battle state to tacgame_image.cfgpack and starts the
// tactical program with this command line; doing the same skips the menu.
function launchBattle(gameDir, missionFile) {
  const image = readPack(missionFile).entries.find(e => e.names[0] === 'tacgame_image').payload;
  const profile = fs.readFileSync(path.join(gameDir, 'users', 'profiles', 'cur_profile.engcfg'), 'latin1').match(/cur_id\s*=\s*(\w+)/)?.[1];
  if (!profile) fail('no game profile found - start the game once');
  fs.writeFileSync(path.join(gameDir, 'data', 'common', 'shared', 'config', 'tacgame_image.cfgpack'), image);
  // without this file the Steam API restarts the game through Steam and the arguments are lost
  const appId = path.join(gameDir, 'steam_appid.txt');
  if (!fs.existsSync(appId)) fs.writeFileSync(appId, '312980');
  const args = `root\\programs\\tacgame.progpack, data\\common\\shared\\config\\tacgame_image.cfgpack, users\\profiles, ${profile}, *:*, 0, 0`;
  spawn(path.join(gameDir, 'starter_x64.exe'), [args], { cwd: gameDir, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
}

function startBattle(gameDir, missionFile) {
  if (installer.gameRunning()) fail('Mius-Front is still running - close the game first.');
  launchBattle(gameDir, missionFile);
  console.log('  battle started');
}

// ---------------------------------------------------------------- build
function build(specFile, opts) {
  if ((opts.install || opts.start) && installer.gameRunning()) fail('Mius-Front is still running - close the game first.');
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const missions = loadMissions(opts.game);
  const db = unitdb.loadUnitDb(opts.game);
  const { catalog: all, nameMax } = buildCatalog(missions, db);
  const base = missions.find(m => m.name === spec.base || baseId(m) === spec.base);
  if (!base) fail(`"base" "${spec.base}" unknown. Valid: ${missions.map(baseId).join(', ')}`);
  // "unit" without @: strongest variant, the base mission's own variant wins a tie
  const strength = e => e.men + e.vehicles.length;
  const catalog = { get: (key, size) => {
    const tpl = db.platoons.find(t => t.key === key);
    if (size && tpl) return { ...platoonFromDb(tpl, db, all, size), period: unitdb.period(tpl.pool) };
    const best = all.get(key);
    const own = key.includes('@') ? null : all.get(key + '@' + baseId(base));
    const e = own && best && strength(own) >= strength(best) ? own : best;
    return e && tpl ? { ...e, period: unitdb.period(tpl.pool) } : e;
  } };
  checkSpec(spec, base, catalog);
  seed = [...spec.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

  // fresh copies of the base blocks
  const get = k => base.entries.find(e => e.names[0] + '|' + e.names[1] === k).payload;
  const tac = parse(get('tacgame_image|tacimage')), qb = parse(get('qbattle|config')), desc = parse(get('desc|config'));

  const counts = buildForces(spec, base, tac, qb, catalog, nameMax);
  const script = spec.script ?? makeScript(spec);
  const texts = makeTexts(spec);

  param(tac, 'i_gamespec:gamespec', 'op_name').str = gameText(spec.title, 'title');
  if (spec.max_minutes) param(tac, 'i_gamespec:gamespec', 'max_game_time').raw.writeFloatLE(spec.max_minutes * 60, 0);
  node(tac, 'usr_script_data').table[0][0].str = lineBlock('SCR1', script);
  node(tac, 'usr_local_data').table[0][0].str = lineBlock('LOC1', texts);

  const og = 'i_opgame:opgame';
  setU32(param(desc, og, 'chap_id'), 0, spec.menu === 'training' ? 3 : 2);
  setU32(param(desc, og, 'user_platoons'), 0, counts.player);
  setU32(param(desc, og, 'allied_platoons'), 0, counts.player);
  setU32(param(desc, og, 'enemy_platoons'), 0, counts.enemy);
  setLines(node(desc, 'local_data'), texts);
  setLines(node(desc, 'script_data'), script);

  const outFile = path.resolve(opts.out ?? path.join(ROOT, 'output', spec.id + '.mispack'));
  writePack(base, {
    'tacgame_image|tacimage': serialize(tac),
    'qbattle|config': serialize(qb),
    'desc|config': serialize(desc),
    'script|config': Buffer.from(script.join('\r\n'), 'latin1'),
    'desc|text': Buffer.from(texts.join('\r\n') + '\r\n', 'latin1'),
  }, outFile);

  const { errors, summary } = validate(outFile);
  console.log(`${path.relative(process.cwd(), outFile)}  (base ${baseId(base)}, player ${base.userSide})`);
  for (const [s, l] of Object.entries(summary)) console.log(`  ${s}\n    ${l.join('\n    ')}`);
  if (errors.length) { console.log('VALIDATION FAILED:\n  ' + errors.join('\n  ')); process.exitCode = 1; return; }
  console.log('  validation: ok');
  if (opts.install) {
    const { guid, version } = installer.install(opts.game, spec.mod ?? spec.id, [outFile]);
    console.log(`  installed as mod "${spec.mod ?? spec.id}" (${guid}, version ${version}) -> QUICK BATTLE / ${spec.menu === 'training' ? 'Training' : 'Missions'}`);
  }
  if (opts.start) startBattle(opts.game, outFile);
}

// ---------------------------------------------------------------- reference + schema
const BEGIN = '<!-- REFERENCE:BEGIN (generated by `node tools/scenario.js reference`, do not edit by hand) -->';
const END = '<!-- REFERENCE:END -->';

// docs/UNITS.md: every platoon the game knows, by nation and parent unit
function unitsDoc(missions, catalog, variants, db) {
  const count = list => Object.entries(list.reduce((a, v) => ({ ...a, [v]: (a[v] ?? 0) + 1 }), {})).map(([v, n]) => `${n}x ${v}`).join(', ');
  const out = ['# Mius-Front unit reference', '',
    'Generated by `node tools/scenario.js reference` from the game data. Do not edit by hand.', '',
    'Use the value of the `unit` column in a scenario file. Everything listed here can be built by the generator.', '',
    '- **Men** and **Vehicles/heavy weapons** describe the default strength. `max` is the largest `size` the game allows for that platoon; `size` repeats the last squad type.',
    '- **Source** `mission`: rows taken from a shipped mission (variants selectable with `unit@base`). `database`: built from the unit database; the column layout is verified against all shipped squads, but this exact platoon was not necessarily played.',
    '- All bases are set on 1 July 1943 (summer). Units whose service period excludes that date still build, with a warning.', ''];
  const vehicles = new Map();
  for (const nation of ['GER', 'USSR']) {
    out.push(`## ${NATION_NAME[nation]} (\`${nation}\`)`, '');
    for (const pool of [...db.pools.values()].filter(p => p.nation === nation).sort((a, b) => a.key.localeCompare(b.key))) {
      const list = db.platoons.filter(t => t.pool === pool);
      if (!list.length) continue;
      out.push(`### \`${pool.key}\` (${unitdb.period(pool).text})`, '',
        '| `unit` | Role | Squads | Men | Vehicles / heavy weapons | max | Source |', '|---|---|---|---|---|---|---|');
      for (const t of list) {
        const e = catalog.get(t.key);
        for (const v of new Set(e.vehicles)) (vehicles.get(v) ?? vehicles.set(v, new Set()).get(v)).add(t.key);
        const vars = (variants.get(t.key) ?? []).filter(v => v !== e).map(v => `\`${v.key}\` (${v.men})`).join(', ');
        out.push(`| \`${t.key}\` | ${ROLE_NAMES[t.type] ?? t.type} | ${count(e.squadTypes)} | ${e.men} | ${count(e.vehicles) || '-'} | ${t.maxSquads} | ${e.fromDb ? 'database' : 'mission' + (vars ? ', also ' + vars : '')} |`);
      }
      out.push('');
    }
  }
  out.push('## Vehicle and heavy-weapon index', '', 'Which platoons contain a given model.', '', '| Model | `unit` |', '|---|---|');
  for (const [v, set] of [...vehicles].sort((a, b) => a[0].localeCompare(b[0]))) out.push(`| ${v} | ${[...set].map(k => '`' + k + '`').join(', ')} |`);
  return out.join('\n') + '\n';
}

// docs/catalog.json: everything a tool needs to offer valid choices
function catalogJson(missions, catalog, variants, db) {
  return {
    enums: {
      menu: ['missions', 'training'], deployTypes: DEPLOY_TYPES, formations: FORMATIONS, facings: FACINGS, modes: MODES,
      plans: Object.keys(PLANS), callsigns: CALLSIGN_NAMES, reserved: RESERVED, defaultTexts: DEFAULT_TEXTS,
    },
    bases: missions.map(m => ({
      id: baseId(m), player: m.userSide, enemy: m.enemySide, title: m.title, description: m.description,
      extent: m.extent, cellSize: m.cellSize,
      cells: m.cells.filter(c => c.side !== 'NEUT').map(c => ({ side: c.side === m.userSide ? 'player' : 'enemy', x: c.x, z: c.z })),
      points: m.points.map(p => ({ ...p, area: areaOf(m, [p.x, p.z]) })),
      settlements: m.settlements.map(s => ({ ...s, width: Math.round(s.width), depth: Math.round(s.depth), area: areaOf(m, [s.x, s.z]) })),
    })),
    units: db.platoons.map(t => {
      const e = catalog.get(t.key);
      return {
        key: t.key, nation: t.pool.nation, role: ROLE_NAMES[t.type] ?? t.type, pool: t.pool.key, men: e.men, vehicles: e.vehicles,
        squads: e.squadTypes, maxSquads: t.maxSquads, source: e.fromDb ? 'database' : 'mission',
        period: unitdb.period(t.pool), variants: (variants.get(t.key) ?? []).filter(v => v !== e).map(v => ({ key: v.key, men: v.men })),
      };
    }),
  };
}

function scriptCommandRows(missions) {
  const all = missions.map(m => m.script).join('\n').split(/\r?\n/);
  return SCRIPT_COMMANDS.map(c => {
    const re = new RegExp('^\\s*' + c.replace('+', '\\+') + '\\b');
    const line = all.find(l => re.test(l));
    return `| \`${c}\` | ${line ? '\`' + line.trim().replace(/\|/g, '/') + '\`' : 'not used in the shipped missions'} |`;
  });
}

function referenceMarkdown(missions, db) {
  const out = [BEGIN, ''];
  out.push('### 6.1 Bases', '',
    'A base supplies the map section, weather, date/time and which nation the player commands. Its own troops are discarded.', '',
    '| `base` | Player | Enemy | Original mission | Map extent (x / z, metres) |', '|---|---|---|---|---|');
  for (const m of missions) {
    const e = m.extent;
    out.push(`| \`${baseId(m)}\` | ${NATION_NAME[m.userSide]} (${m.userSide}) | ${NATION_NAME[m.enemySide]} (${m.enemySide}) | ${m.title} | x ${e.x0}..${e.x1} / z ${e.z0}..${e.z1} |`);
  }
  for (const m of missions) {
    const e = m.extent, h = m.cellSize / 2;
    const area = side => m.cells.filter(c => c.side === side)
      .map(c => `x ${c.x - h}..${c.x + h} / z ${c.z - h}..${c.z + h}`).join('; ') || '-';
    out.push('', `#### Base \`${baseId(m)}\` – ${m.title}`, '',
      `- Player: **${NATION_NAME[m.userSide]}** (\`${m.userSide}\`), enemy: **${NATION_NAME[m.enemySide]}** (\`${m.enemySide}\`)`,
      `- Original mission: ${m.description}`,
      `- Map extent: x ${e.x0}..${e.x1}, z ${e.z0}..${e.z1}; grid of ${m.cellSize} m cells`,
      `- Player start area: ${area(m.userSide)}`,
      `- Enemy start area: ${area(m.enemySide)}`,
      `- Settlements: ${m.settlements.map(s => `${s.houses} houses around [${s.x}, ${s.z}], ${Math.round(s.width)} x ${Math.round(s.depth)} m (${areaOf(m, [s.x, s.z])} area)`).join('; ') || 'none'}`,
      '- Known points from the original mission script (tested positions; good anchors for your own points):', '',
      '| name | x | z | lies in |', '|---|---|---|---|');
    for (const p of m.points) out.push(`| ${p.name} | ${p.x} | ${p.z} | ${areaOf(m, [p.x, p.z])} area |`);
  }

  const nations = ['GER', 'USSR'].map(n => {
    const list = db.platoons.filter(t => t.pool.nation === n);
    const roles = Object.entries(list.reduce((a, t) => ({ ...a, [t.type]: (a[t.type] ?? 0) + 1 }), {}))
      .map(([k, c]) => `${c} ${ROLE_NAMES[k] ?? k}`).join(', ');
    return `- ${NATION_NAME[n]} (\`${n}\`): ${list.length} platoon types (${roles})`;
  });
  out.push('', '### 6.2 Unit types', '',
    'The complete list of all allowed `unit` values is in **[docs/UNITS.md](docs/UNITS.md)**: every platoon type of the game, grouped by parent unit, with composition, strength and service period, plus an index of all vehicles and heavy weapons.', '',
    ...nations, '');
  out.push('### 6.3 Enumerations', '',
    '| Field | Allowed values |', '|---|---|',
    `| \`base\` | ${missions.map(m => '`' + baseId(m) + '`').join(', ')} |`,
    '| `menu` | `missions` (default), `training` |',
    `| \`deploy.type\` | ${Object.entries(DEPLOY_TYPES).map(([k, v]) => `\`${k}\` (${v})`).join(', ')} |`,
    `| \`deploy.formation\` (complete list from the game's script parser) | ${Object.entries(FORMATIONS).map(([k, v]) => `\`${k}\` (${v})`).join(', ')} |`,
    `| \`deploy.facing\`, \`camera.direction\` | ${FACINGS.map(f => '`' + f + '`').join(', ')} |`,
    `| \`orders[].mode\` (complete list; meanings inferred) | ${Object.entries(MODES).map(([k, v]) => `\`${k}\` (${v})`).join(', ')} |`,
    `| \`platoons[].plan\` | ${Object.keys(PLANS).map(k => '`' + k + '`').join(', ')} |`,
    `| callsign names | ${CALLSIGN_NAMES.map(c => '`' + c + '`').join(', ')} – use as \`<name>_<two digits>\`, e.g. \`pine_01\` |`,
    `| reserved point/callsign names | ${RESERVED.map(c => '`' + c + '`').join(', ')} |`,
    `| default \`texts\` keys | ${Object.keys(DEFAULT_TEXTS).map(c => '`' + c + '`').join(', ')} |`,
    '', '### 6.4 Script commands', '',
    'All commands the game\'s script parser knows, for use in `"script"`, with the first usage found in the shipped missions.', '',
    '| Command | Example |', '|---|---|', ...scriptCommandRows(missions), '', END);
  return out.join('\n');
}

function schema(missions, catalog, variants, db) {
  const unitDoc = nation => db.platoons.filter(t => t.pool.nation === nation).flatMap(t => {
    const e = catalog.get(t.key);
    const role = ROLE_NAMES[t.type] ?? t.type;
    return [{ const: t.key, description: `${role}, ${e.men} men${e.vehicles.length ? ', ' + e.vehicles.join(' ') : ''}` },
      ...(variants.get(t.key) ?? []).filter(v => v !== e).map(v => ({ const: v.key, description: `${role}, ${v.men} men` }))];
  });
  const name = { type: 'string', pattern: NAME_RE.source, not: { enum: RESERVED } };
  const xz = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, z] in metres; x grows to the east' };
  const text = { type: 'string', pattern: '^[\\x20-\\x7e]*$', description: 'plain ASCII only' };
  const deploy = {
    type: 'object', required: ['at'], additionalProperties: false,
    properties: {
      at: { type: 'string', description: 'name of a point in "points"' },
      type: { enum: Object.keys(DEPLOY_TYPES), default: 'place' },
      formation: { enum: Object.keys(FORMATIONS) },
      facing: { enum: FACINGS },
    },
  };
  const platoon = nation => ({
    type: 'object', required: ['callsign', 'unit'], additionalProperties: false,
    properties: {
      callsign: { ...name, description: `unique; recommended: <name>_<nn> with name from ${CALLSIGN_NAMES.join(', ')}` },
      unit: { anyOf: unitDoc(nation) },
      position: xz,
      deploy,
      plan: { enum: Object.keys(PLANS) },
      size: { type: 'integer', minimum: 1, maximum: 15, description: 'number of squads; repeats the last squad type' },
    },
  });
  const side = nation => ({
    type: 'object', required: ['platoons'], additionalProperties: false,
    properties: {
      platoons: { type: 'array', minItems: 1, items: platoon(nation) },
      deploy,
      orders: {
        type: 'array',
        items: {
          type: 'object', required: ['to'], additionalProperties: false,
          properties: { to: { type: 'string' }, mode: { enum: Object.keys(MODES), default: 'attack' }, wait_s: { type: 'number', minimum: 0 } },
        },
      },
      ai: { type: 'boolean' },
    },
  });
  const byPlayer = nation => missions.filter(m => m.userSide === nation).map(baseId);
  const enemyOf = { GER: 'USSR', USSR: 'GER' };
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'scenario.schema.json',
    title: 'MiusMissionMaker scenario',
    description: 'Scenario description for tools/scenario.js. Generated by `node tools/scenario.js reference`.',
    type: 'object',
    required: ['id', 'title', 'base', 'points', 'sides'],
    properties: {
      $schema: { type: 'string' },
      id: { type: 'string', pattern: '^[a-z0-9_]{1,40}$', description: 'output file name and mod name' },
      title: text,
      description: text,
      base: { enum: missions.map(baseId), description: 'shipped mission providing map, weather and player nation' },
      menu: { enum: ['missions', 'training'], default: 'missions' },
      max_minutes: { type: 'number', exclusiveMinimum: 0 },
      time_scale: { type: 'number', exclusiveMinimum: 0 },
      deploy_phase: { type: 'boolean', default: true },
      mod: { type: 'string' },
      camera: {
        type: 'object', additionalProperties: false,
        properties: { at: { type: 'string' }, direction: { enum: FACINGS }, zoom: { type: 'number' } },
      },
      points: { type: 'object', minProperties: 1, propertyNames: name, additionalProperties: xz },
      sides: {
        type: 'object', required: ['player', 'enemy'], additionalProperties: false,
        properties: { player: { type: 'object' }, enemy: { type: 'object' } },
      },
      victory: {
        type: 'object', additionalProperties: false,
        properties: {
          balance: { type: 'number', exclusiveMinimum: 0 }, after_s: { type: 'number', minimum: 0 }, own_reaches: { type: 'string' },
          radius: { type: 'number', exclusiveMinimum: 0 }, share: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        },
      },
      defeat: {
        type: 'object', additionalProperties: false,
        properties: { enemy_reaches: { type: 'string' }, radius: { type: 'number', exclusiveMinimum: 0 }, share: { type: 'number', exclusiveMinimum: 0, maximum: 1 } },
      },
      texts: { type: 'object', propertyNames: { pattern: '^[a-z0-9_]+$' }, additionalProperties: text },
      script: { type: 'array', items: { type: 'string' } },
    },
    patternProperties: { '^_': {} },
    additionalProperties: false,
    // which nation may appear on which side depends on the base
    allOf: ['GER', 'USSR'].map(nation => ({
      if: { properties: { base: { enum: byPlayer(nation) } }, required: ['base'] },
      then: { properties: { sides: { properties: { player: side(nation), enemy: side(enemyOf[nation]) } } } },
    })),
  };
}

function reference(opts) {
  const missions = loadMissions(opts.game);
  const db = unitdb.loadUnitDb(opts.game);
  const { catalog, variants } = buildCatalog(missions, db);
  const tiles = mapdata.loadTiles(opts.game);
  const places = mapdata.settlements(tiles);
  for (const m of missions) m.settlements = mapdata.missionSettlements(tiles, places, m.polygon, m.extent);
  const readme = path.join(ROOT, 'README.md');
  const md = fs.readFileSync(readme, 'utf8');
  const a = md.indexOf(BEGIN), b = md.indexOf(END);
  if (a < 0 || b < 0) fail('README.md has no REFERENCE:BEGIN/END markers');
  fs.writeFileSync(readme, md.slice(0, a) + referenceMarkdown(missions, db) + md.slice(b + END.length));
  fs.writeFileSync(path.join(ROOT, 'docs', 'UNITS.md'), unitsDoc(missions, catalog, variants, db));
  fs.writeFileSync(path.join(ROOT, 'docs', 'catalog.json'), JSON.stringify(catalogJson(missions, catalog, variants, db)) + '\n');
  fs.writeFileSync(path.join(ROOT, 'scenario.schema.json'), JSON.stringify(schema(missions, catalog, variants, db), null, 2) + '\n');
  console.log(`README.md, docs/UNITS.md, scenario.schema.json: ${missions.length} bases, ${db.platoons.length} platoon types`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const flag = n => { const i = args.indexOf(n); return i >= 0 ? (args.splice(i, 1), true) : false; };
  const opts = { game: opt('--game') ?? DEFAULT_GAME, out: opt('--out'), install: flag('--install'), start: flag('--start') };
  const [cmd, file] = args;
  try {
    if (cmd === 'build' && file) build(file, opts);
    else if (cmd === 'start' && file) startBattle(opts.game, path.resolve(file));
    else if (cmd === 'reference') reference(opts);
    else console.log('usage:\n  node tools/scenario.js build <scenario.json> [--install] [--start] [--game <dir>] [--out <file>]\n  node tools/scenario.js start <mission.mispack> [--game <dir>]\n  node tools/scenario.js reference [--game <dir>]');
  } catch (e) {
    if (!(e instanceof SpecError)) throw e;
    console.error('error: ' + e.message);
    process.exitCode = 1;
  }
}

module.exports = { build, buildCatalog, loadMissions, launchBattle };
