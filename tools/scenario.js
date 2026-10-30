// MiusMissionMaker scenario generator: JSON -> .mispack for Graviteam Tactics: Mius-Front.
//
//   node tools/scenario.js build     <scenario.json> [--install] [--game <dir>] [--out <file>]
//   node tools/scenario.js reference [--game <dir>]
//        regenerates the reference section of README.md and scenario.schema.json
//
// Map section, weather and player nation come from a shipped "base" mission; all forces,
// the mission script and the texts are rebuilt from the JSON. Platoons can be taken from
// any shipped mission (see the reference) and are re-numbered for the new mission.
const fs = require('fs');
const path = require('path');
const { readPack } = require('./azp3');
const { parse, serialize } = require('./azcf');
const { validate } = require('./validate_mission');
const installer = require('./install_mission');

const DEFAULT_GAME = 'C:/Program Files (x86)/Steam/steamapps/common/Graviteam Tactics Mius-Front';
const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- vocabulary
const NAME_RE = /^[a-z][a-z0-9_]{0,30}$/;
// callsign names from the game's localisation; others are allowed but may show oddly in-game
const CALLSIGN_NAMES = ('pine linden birch asp beech chestnut willow oak fir broom guelder cedar reed poplar cherry ' +
  'tiger jaguar leopard panther elefant lion beaver viper wolf fox bear lynx hawk eagle crocodile falcon').split(' ');
const RESERVED = ['own', 'foe', 'own_main', 'foe_main', 'main', 'deploy', 'process', 'goto', 'battle_victory',
  'battle_defeat', 'foe_later', 'own_later'];
const MODES = {
  assault: 'aggressive advance, fighting through to the point',
  attack: 'attack the point',
  march: 'move in march order: fast, not ready to fight',
  defence: 'move to the point and take up defence there',
  siege: 'surround and besiege the point',
};
const PLANS = { attack: 'ATAK', defend: 'DEF', hold: 'HOLD' };
const DEPLOY_TYPES = { trench: 'dug in at prepared positions', place: 'placed in the open' };
const FORMATIONS = {
  line2: 'two lines; default for trench',
  line: 'single line',
  columnlr: 'column; default for place',
  battery: 'gun/mortar battery layout',
};
const FACINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// role + description for every platoon template found in the shipped missions
const UNIT_INFO = {
  wer_mibn_1141_comcoy: ['HQ', 'Infantry company HQ: company commander and radio/telephone squad; the strongest variant adds an anti-tank rifle squad, a PzB 41 team and a truck'],
  wer_mibn_1141_plat: ['infantry', 'Rifle platoon: platoon HQ, 4 rifle squads with light machine guns, 5 cm light mortar'],
  wer_mibn_1141_at_plat: ['anti-tank gun', 'Anti-tank gun section: one 5 cm Pak 38 with crew and fire-control squad'],
  wer_minf1141_igcoy_lfpl: ['artillery', 'Infantry gun platoon: 2x 7.5 cm le.IG 18 with battery/platoon command and telephone squad'],
  wer_pz_coy_plat1: ['tank', 'Panzer III platoon: 1x Pz III J (long gun) and 3x Pz III M'],
  wer_mar_43_plat: ['tank destroyer', 'Marder platoon (1943): 1x Marder III and 1x Marder II self-propelled anti-tank guns'],
  wer_mar_42_plat: ['tank destroyer', 'Marder platoon (1942): 1x Marder II, 2x Marder III, 1x Sd.Kfz. 250 half-track'],
  wer_spg_bn_43_spam: ['support', 'Assault-gun battalion support section with 2 Opel Blitz trucks; no combat value'],
  ra_rbn_1242_comcoy: ['HQ', 'Rifle company HQ: company commander, political officer, runner and a sniper team'],
  ra_rbn_1242_plat2: ['infantry', 'Rifle platoon: platoon HQ and 4 rifle squads with light machine guns (training variant: 2 squads)'],
  ra_rbn_1242_combat: ['HQ', 'Rifle battalion HQ: battalion commander and telephone squad'],
  ra_rbn_1242_hmg: ['machine gun', 'Heavy machine-gun squad: 1x Maxim HMG with crew'],
  ra_rr1242_smg_hq: ['HQ', 'Submachine-gun company HQ (3 men)'],
  ra_rr1242_smg_plat: ['infantry', 'Submachine-gun platoon: platoon HQ and 3 SMG squads (assault infantry)'],
  ra_rr1242_foot_scout: ['recon', 'Foot reconnaissance platoon: platoon HQ, 3 scout squads and an artillery observer'],
  ra_ssq_0143_comsq: ['HQ', 'Cavalry squadron HQ: commander, political officer, telephone squad'],
  ra_ssq_0143_plat: ['infantry', 'Cavalry sabre platoon fighting dismounted: platoon HQ and 2 squads'],
  ra_ssq_0143_atr: ['anti-tank', 'Cavalry anti-tank rifle platoon: platoon HQ and 3 anti-tank rifle squads (dismounted)'],
  ra_cr_0143_mt82_com: ['HQ', 'Mortar battery HQ: commander and telephone squad; no weapons of its own'],
  ra_cr_0143_mt82_fplat: ['mortar', '82 mm mortar platoon: 3 mortars with fire-control squad'],
  ra_tbr_42_bn1_t34_plat: ['tank', 'T-34 platoon: 3x T-34 model 1942 (training variant: 1 tank)'],
  ra_tbr_42_bn1_t34_cc: ['tank', 'T-34 company commander tank (1 tank)'],
  ra_tbr_42_bn2_sm_plat: ['tank', 'T-70 light tank platoon: 3x T-70M'],
  ra_ogvtpp_42_plat: ['tank', 'KV-1S heavy tank platoon: 2 tanks'],
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

// Every platoon type found in the shipped missions. Training missions ship thinned-out
// platoons, so "<template>" picks the strongest variant and "<template>@<mission>" a specific one.
function buildCatalog(missions) {
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
      const e = catalog.get(p.unit);
      if (!e) fail(`${where}: unit "${p.unit}" unknown (see README, unit types)`);
      if (e.nation !== nation) fail(`${where}: "${p.unit}" is ${e.nation}, but this side is ${nation} (base ${baseId(base)})`);
      if (p.position) {
        if (!(Array.isArray(p.position) && p.position.length === 2 && p.position.every(Number.isFinite))) fail(`${where}: "position" must be [x, z]`);
        if (areaOf(base, p.position) === 'outside') fail(`${where}: "position" is outside the map of base ${baseId(base)}`);
      }
      if (p.plan && !PLANS[p.plan]) fail(`${where}: "plan" must be ${Object.keys(PLANS).join(', ')}`);
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
      const e = catalog.get(p.unit);
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

// ---------------------------------------------------------------- build
function build(specFile, opts) {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const missions = loadMissions(opts.game);
  const { catalog: all, nameMax } = buildCatalog(missions);
  const base = missions.find(m => m.name === spec.base || baseId(m) === spec.base);
  if (!base) fail(`"base" "${spec.base}" unknown. Valid: ${missions.map(baseId).join(', ')}`);
  // "unit" without @: strongest variant, the base mission's own variant wins a tie
  const strength = e => e.men + e.vehicles.length;
  const catalog = { get: key => {
    const best = all.get(key);
    const own = key.includes('@') ? null : all.get(key + '@' + baseId(base));
    return own && best && strength(own) >= strength(best) ? own : best;
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
}

// ---------------------------------------------------------------- reference + schema
const BEGIN = '<!-- REFERENCE:BEGIN (generated by `node tools/scenario.js reference`, do not edit by hand) -->';
const END = '<!-- REFERENCE:END -->';

function unitRows(variants, catalog, nation) {
  const count = list => Object.entries(list.reduce((a, v) => ({ ...a, [v]: (a[v] ?? 0) + 1 }), {}))
    .map(([v, n]) => `${n}x ${v}`).join(', ');
  return [...variants].filter(([t]) => catalog.get(t).nation === nation).map(([template, list]) => {
    const e = catalog.get(template);
    const [role, text] = UNIT_INFO[template] ?? ['?', ''];
    return { template, role, text, e, list, vehicles: count(e.vehicles) || '-', squads: count(e.squadTypes) };
  }).sort((a, b) => a.role.localeCompare(b.role) || a.template.localeCompare(b.template));
}

function referenceMarkdown(missions, catalog, variants) {
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
      '- Known points from the original mission script (tested positions; good anchors for your own points):', '',
      '| name | x | z | lies in |', '|---|---|---|---|');
    for (const p of m.points) out.push(`| ${p.name} | ${p.x} | ${p.z} | ${areaOf(m, [p.x, p.z])} area |`);
  }

  for (const nation of ['GER', 'USSR']) {
    out.push('', `### 6.${nation === 'GER' ? 2 : 3} Unit types – ${NATION_NAME[nation]} (\`${nation}\`)`, '',
      'Use the value in the `unit` column. Without suffix the strongest variant is used; add `@<base>` for a specific variant (listed with men count).', '',
      '| `unit` | Role | Description | Men | Vehicles / heavy weapons | Variants |', '|---|---|---|---|---|---|');
    for (const r of unitRows(variants, catalog, nation)) {
      const vars = r.list.map(v => `\`${v.key}\` (${v.men})`).join(', ');
      out.push(`| \`${r.template}\` | ${r.role} | ${r.text} | ${r.e.men} | ${r.vehicles} | ${vars} |`);
    }
  }

  out.push('', '### 6.4 Enumerations', '',
    '| Field | Allowed values |', '|---|---|',
    `| \`base\` | ${missions.map(m => '`' + baseId(m) + '`').join(', ')} |`,
    '| `menu` | `missions` (default), `training` |',
    `| \`deploy.type\` | ${Object.entries(DEPLOY_TYPES).map(([k, v]) => `\`${k}\` (${v})`).join(', ')} |`,
    `| \`deploy.formation\` (values used by the original missions) | ${Object.entries(FORMATIONS).map(([k, v]) => `\`${k}\` (${v})`).join(', ')} |`,
    `| \`deploy.facing\`, \`camera.direction\` | ${FACINGS.map(f => '`' + f + '`').join(', ')} |`,
    `| \`orders[].mode\` (meanings inferred from the original missions) | ${Object.entries(MODES).map(([k, v]) => `\`${k}\` (${v})`).join(', ')} |`,
    `| \`platoons[].plan\` | ${Object.keys(PLANS).map(k => '`' + k + '`').join(', ')} |`,
    `| callsign names | ${CALLSIGN_NAMES.map(c => '`' + c + '`').join(', ')} – use as \`<name>_<two digits>\`, e.g. \`pine_01\` |`,
    `| reserved point/callsign names | ${RESERVED.map(c => '`' + c + '`').join(', ')} |`,
    `| default \`texts\` keys | ${Object.keys(DEFAULT_TEXTS).map(c => '`' + c + '`').join(', ')} |`,
    '', END);
  return out.join('\n');
}

function schema(missions, catalog, variants) {
  const unitDoc = nation => [...variants].filter(([t]) => catalog.get(t).nation === nation).flatMap(([t, list]) => {
    const [role, text] = UNIT_INFO[t] ?? ['?', ''];
    const best = catalog.get(t);
    return [{ const: t, description: `${role}: ${text} (${best.men} men, strongest variant)` },
      ...list.map(v => ({ const: v.key, description: `${role}: ${text} (variant from ${v.mission}, ${v.men} men)` }))];
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
        properties: { balance: { type: 'number', exclusiveMinimum: 0 }, after_s: { type: 'number', minimum: 0 } },
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
  const { catalog, variants } = buildCatalog(missions);
  const missing = [...variants.keys()].filter(t => !UNIT_INFO[t]);
  if (missing.length) console.warn('note: no description for ' + missing.join(', '));

  const readme = path.join(ROOT, 'README.md');
  const md = fs.readFileSync(readme, 'utf8');
  const a = md.indexOf(BEGIN), b = md.indexOf(END);
  if (a < 0 || b < 0) fail('README.md has no REFERENCE:BEGIN/END markers');
  fs.writeFileSync(readme, md.slice(0, a) + referenceMarkdown(missions, catalog, variants) + md.slice(b + END.length));
  fs.writeFileSync(path.join(ROOT, 'scenario.schema.json'), JSON.stringify(schema(missions, catalog, variants), null, 2) + '\n');
  console.log(`README.md reference + scenario.schema.json: ${missions.length} bases, ${variants.size} unit types`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const flag = n => { const i = args.indexOf(n); return i >= 0 ? (args.splice(i, 1), true) : false; };
  const opts = { game: opt('--game') ?? DEFAULT_GAME, out: opt('--out'), install: flag('--install') };
  const [cmd, file] = args;
  try {
    if (cmd === 'build' && file) build(file, opts);
    else if (cmd === 'reference') reference(opts);
    else console.log('usage:\n  node tools/scenario.js build <scenario.json> [--install] [--game <dir>] [--out <file>]\n  node tools/scenario.js reference [--game <dir>]');
  } catch (e) {
    if (!(e instanceof SpecError)) throw e;
    console.error('error: ' + e.message);
    process.exitCode = 1;
  }
}

module.exports = { build, buildCatalog, loadMissions };
