// MiusMissionMaker scenario generator: JSON -> .mispack for Graviteam Tactics: Mius-Front.
//
//   node tools/scenario.js build   <scenario.json> [--install] [--game <dir>]
//   node tools/scenario.js catalog [--game <dir>] [--out docs/KATALOG.md]
//
// Map section, weather and player nation come from a shipped "base" mission; all forces,
// the mission script and the texts are rebuilt from the JSON. Platoons can be taken from
// any shipped mission (see the catalogue) and are re-numbered for the new mission.
const fs = require('fs');
const path = require('path');
const { readPack } = require('./azp3');
const { parse, serialize } = require('./azcf');
const { validate } = require('./validate_mission');
const installer = require('./install_mission');

const DEFAULT_GAME = 'C:/Program Files (x86)/Steam/steamapps/common/Graviteam Tactics Mius-Front';
const ROOT = path.join(__dirname, '..');

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

let seed = 1;
const rnd = (lo, hi) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return lo + (seed >>> 8) % (hi - lo + 1); };

class SpecError extends Error {}
const fail = msg => { throw new SpecError(msg); };

// cp1251 has no umlauts; keep texts ASCII-safe
function gameText(s, where) {
  const t = String(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2013\u2014]/g, '-');
  if (/[^\x20-\x7e]/.test(t)) fail(`${where}: nur einfache Zeichen erlaubt (ASCII), gefunden: ${JSON.stringify(t.match(/[^\x20-\x7e]/)[0])}`);
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
  m.points = [...m.script.matchAll(/^\s*def\s+(\w+)\s+(-?[\d.]+)\s*,\s*-?[\d.]+\s*,\s*(-?[\d.]+)/gm)]
    .map(x => ({ name: x[1], x: +x[2], z: +x[3] }));
  return m;
}

function loadMissions(gameDir) {
  const dir = path.join(gameDir, 'data', 'oprum', 'shared', 'missions');
  if (!fs.existsSync(dir)) fail(`Spielordner nicht gefunden: ${dir} (Option --game <Ordner>)`);
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
      const key = p[0].str + '@' + m.name.split('_')[0];
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
const NAME_RE = /^[a-z][a-z0-9_]{0,30}$/;
// callsign names from the game's localisation; others are allowed but may show oddly in-game
const KNOWN_CALLSIGNS = new Set(('pine linden birch asp beech chestnut willow oak fir broom guelder cedar reed poplar cherry ' +
  'tiger jaguar leopard panther elefant lion beaver viper wolf fox bear lynx hawk eagle crocodile falcon').split(' '));
const RESERVED = new Set(['own', 'foe', 'own_main', 'foe_main', 'main', 'deploy', 'process', 'goto', 'battle_victory', 'battle_defeat']);
const MODES = ['assault', 'attack', 'march', 'defence', 'siege'];
const PLANS = { attack: 'ATAK', defend: 'DEF', hold: 'HOLD' };

function checkSpec(spec, base, catalog) {
  if (!spec.id || !/^[a-z0-9_]{1,40}$/.test(spec.id)) fail('"id" fehlt oder ungueltig (nur a-z, 0-9, _; max. 40 Zeichen)');
  if (!spec.title) fail('"title" fehlt');
  if (spec.menu && !['missions', 'training'].includes(spec.menu)) fail('"menu" muss "missions" oder "training" sein');
  const points = spec.points ?? {};
  for (const [n, p] of Object.entries(points)) {
    if (!NAME_RE.test(n) || RESERVED.has(n)) fail(`Punktname "${n}" ungueltig oder reserviert`);
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) fail(`Punkt "${n}" muss [x, z] sein`);
  }
  const needPoint = (n, where) => { if (!(n in points)) fail(`${where}: Punkt "${n}" ist nicht unter "points" definiert`); };
  const seen = new Set();
  for (const [sideKey, nation] of [['player', base.userSide], ['enemy', base.enemySide]]) {
    const side = spec.sides?.[sideKey];
    if (!side?.platoons?.length) fail(`"sides.${sideKey}.platoons" fehlt oder ist leer`);
    for (const [i, p] of side.platoons.entries()) {
      const where = `sides.${sideKey}.platoons[${i}]`;
      if (!NAME_RE.test(p.callsign ?? '') || RESERVED.has(p.callsign)) fail(`${where}: "callsign" fehlt/ungueltig (a-z, 0-9, _)`);
      if (seen.has(p.callsign)) fail(`${where}: Rufname "${p.callsign}" doppelt`);
      seen.add(p.callsign);
      if (!KNOWN_CALLSIGNS.has(p.callsign.replace(/_\d+$/, ''))) {
        console.warn(`Hinweis: Rufname "${p.callsign}" nutzt keinen Namen aus der Rufnamenliste des Spiels (z. B. pine_01, panther_02).`);
      }
      const e = catalog.get(p.unit);
      if (!e) fail(`${where}: Zugtyp "${p.unit}" unbekannt (siehe docs/KATALOG.md)`);
      if (e.nation !== nation) fail(`${where}: "${p.unit}" ist ${e.nation}, diese Seite ist aber ${nation} (Basis ${base.name})`);
      if (p.position && !(Array.isArray(p.position) && p.position.length === 2)) fail(`${where}: "position" muss [x, z] sein`);
      if (p.plan && !PLANS[p.plan]) fail(`${where}: "plan" muss attack, defend oder hold sein`);
      if (p.deploy) needPoint(p.deploy.at, where + '.deploy');
    }
    if (side.deploy) needPoint(side.deploy.at, `sides.${sideKey}.deploy`);
    for (const [i, o] of (side.orders ?? []).entries()) {
      needPoint(o.to, `sides.${sideKey}.orders[${i}]`);
      if (o.mode && !MODES.includes(o.mode)) fail(`sides.${sideKey}.orders[${i}]: "mode" muss ${MODES.join(', ')} sein`);
    }
    if (!side.deploy && side.platoons.some(p => !p.deploy && !p.position)) {
      fail(`sides.${sideKey}: ohne "deploy" braucht jeder Zug "position" oder "deploy"`);
    }
  }
  if (seen.size > 60) fail('maximal 60 Zuege pro Szenario');
  if (spec.defeat?.enemy_reaches) needPoint(spec.defeat.enemy_reaches, 'defeat.enemy_reaches');
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

function makeTexts(spec) {
  const t = {
    brief_own: 'Your forces',
    brief_foe: 'Enemy forces',
    info_end_deploy: 'Redeploy your units if you want, then press [%do_pause] to finish deployment',
    info_1st_orders: 'Give initial orders if you want, and press [%do_pause] again to start battle',
    info_attack: 'The enemy attacks',
    ...(spec.texts ?? {}),
  };
  for (const k of Object.keys(t)) if (!/^[a-z0-9_]+$/.test(k)) fail(`texts: Schluessel "${k}" ungueltig (a-z, 0-9, _)`);
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
    if (id === undefined) fail(`zu viele Pools vom Typ ${hex8(src)} fuer ${e.nation}`);
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
      if (idx > 15) fail(`zu viele Zuege aus Pool ${e.pool[0].str} (max. 15)`);
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
      if (!markerSrc) fail(`Basis ${base.name} hat keine Kartenmarker als Vorlage`);
      const b = cloneRow(markerSrc);
      if (ref[rel].brief) ref[rel].brief[0].raw.copy(b[0].raw, 8, 8, 12); // marker colour
      setU32(b[0], 4, newId);
      b[1].raw.writeFloatLE(pos[0], 0); b[1].raw.writeFloatLE(pos[1], 4);
      brief.table.push(b);

      // deployment trigger (only in newer mission versions)
      if (trig) {
        const trigSrc = e.trigger ?? ref[rel].trigger ?? ref[rel === 'U' ? 'E' : 'U'].trigger;
        if (!trigSrc) fail(`Basis ${base.name} hat keine Ausloeser als Vorlage`);
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
  if (seq > 63) fail('maximal 63 Zuege');
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

// ---------------------------------------------------------------- commands
function build(specFile, opts) {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const missions = loadMissions(opts.game);
  const { catalog: all, nameMax } = buildCatalog(missions);
  const base = missions.find(m => m.name === spec.base || m.name.startsWith(spec.base + '_'));
  if (!base) fail(`"base" "${spec.base}" unbekannt. Moeglich: ${missions.map(m => m.name.split('_')[0]).join(', ')}`);
  // "unit" without @: strongest variant, the base mission's own variant wins a tie
  const strength = e => e.men + e.vehicles.length;
  const catalog = { get: key => {
    const best = all.get(key);
    const own = key.includes('@') ? null : all.get(key + '@' + base.name.split('_')[0]);
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
  console.log(`${path.relative(process.cwd(), outFile)}  (Basis ${base.name}, Spieler ${base.userSide})`);
  for (const [s, l] of Object.entries(summary)) console.log(`  ${s}\n    ${l.join('\n    ')}`);
  if (errors.length) { console.log('PRUEFUNG FEHLGESCHLAGEN:\n  ' + errors.join('\n  ')); process.exitCode = 1; return; }
  console.log('  Pruefung: ok');
  if (opts.install) {
    const { guid, version } = installer.install(opts.game, spec.mod ?? spec.id, [outFile]);
    console.log(`  installiert als Mod "${spec.mod ?? spec.id}" (${guid}, Version ${version}) -> QUICK BATTLE / ${spec.menu === 'training' ? 'Training' : 'Missions'}`);
  }
}

function catalogDoc(opts) {
  const missions = loadMissions(opts.game);
  const { catalog, variants } = buildCatalog(missions);
  const out = ['# Katalog', '', 'Automatisch erzeugt mit `node tools/scenario.js catalog`. Nicht von Hand bearbeiten.', '',
    '## Basen (Kartenausschnitt und Spielerseite)', '',
    '| `base` | Spieler | Gegner | Kartenausschnitt | Punkte aus dem Originalskript (x, z) |', '|---|---|---|---|---|'];
  for (const m of missions) {
    const pts = m.points.map(p => `${p.name} (${p.x}, ${p.z})`).join(', ');
    out.push(`| \`${m.name.split('_')[0]}\` | ${m.userSide} | ${m.enemySide} | ${path.basename(m.polygon, '.polypack2')} | ${pts} |`);
  }
  for (const nation of ['GER', 'USSR']) {
    out.push('', `## Zugtypen ${nation === 'GER' ? 'Deutsch' : 'Sowjetisch'} (${nation})`, '',
      '`unit` ohne Zusatz nimmt die staerkste Variante; eine bestimmte Variante waehlt man mit `unit@mission`.', '',
      '| `unit` | Symbol | Gruppen | Mann | Fahrzeuge/Waffen | Gruppentypen | Varianten (Mann) |', '|---|---|---|---|---|---|---|');
    const count = list => Object.entries(list.reduce((a, v) => ({ ...a, [v]: (a[v] ?? 0) + 1 }), {})).map(([v, n]) => `${n}x ${v}`).join(', ');
    for (const [template, list] of variants) {
      const e = catalog.get(template);
      if (e.nation !== nation) continue;
      const vars = list.map(v => `${v === e ? '**' : ''}\`${v.key}\` (${v.men})${v === e ? '**' : ''}`).join('<br>');
      out.push(`| \`${template}\` | ${e.icon} | ${e.squads.length} | ${e.men} | ${count(e.vehicles) || '-'} | ${count(e.squadTypes)} | ${vars} |`);
    }
  }
  const file = path.resolve(opts.out ?? path.join(ROOT, 'docs', 'KATALOG.md'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out.join('\n') + '\n');
  console.log(`${path.relative(process.cwd(), file)}: ${missions.length} Basen, ${variants.size} Zugtypen`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const flag = n => { const i = args.indexOf(n); return i >= 0 ? (args.splice(i, 1), true) : false; };
  const opts = { game: opt('--game') ?? DEFAULT_GAME, out: opt('--out'), install: flag('--install') };
  const [cmd, file] = args;
  try {
    if (cmd === 'build' && file) build(file, opts);
    else if (cmd === 'catalog') catalogDoc(opts);
    else console.log('usage:\n  node tools/scenario.js build <scenario.json> [--install] [--game <dir>] [--out <file>]\n  node tools/scenario.js catalog [--game <dir>] [--out <file>]');
  } catch (e) {
    if (!(e instanceof SpecError)) throw e;
    console.error('Fehler: ' + e.message);
    process.exitCode = 1;
  }
}

module.exports = { build, buildCatalog, loadMissions };
