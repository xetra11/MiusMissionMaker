// Installs .mispack files into the game directly, the same way the game's updater does:
//   data\common\<GUID>\desc.addpack
//   data\common\<GUID>\shared\missions\*.mispack
//   + GUID row in data\common\shared\config\paths.cfgpack
//
// usage:
//   node install_mission.js install   <gameDir> <modName> <file.mispack>...
//   node install_mission.js uninstall <gameDir> <modName>
//   node install_mission.js list      <gameDir>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse, serialize } = require('./azcf');

const pathsFile = gameDir => path.join(gameDir, 'data', 'common', 'shared', 'config', 'paths.cfgpack');
const commonDir = gameDir => path.join(gameDir, 'data', 'common');

// Stable GUID per mod name, so reinstalling replaces instead of duplicating.
const guidFor = name => {
  const h = crypto.createHash('md5').update('MiusMissionMaker:' + name).digest('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

function readManifest(gameDir, guid) {
  const f = path.join(commonDir(gameDir), guid, 'desc.addpack');
  if (!fs.existsSync(f)) return null;
  const cf = parse(fs.readFileSync(f));
  const p = Object.fromEntries(cf.nodes[1].params.map(v => [v.name, v.t === 2 ? v.str : v.raw.readUInt32LE(0)]));
  return { name: cf.nodes[0].slotA, ...p };
}

const loadPaths = gameDir => parse(fs.readFileSync(pathsFile(gameDir)));
function savePaths(gameDir, cf) {
  const f = pathsFile(gameDir), backup = f + '.bak';
  if (!fs.existsSync(backup)) fs.copyFileSync(f, backup);
  fs.writeFileSync(f, serialize(cf));
}
const pathRows = cf => cf.nodes.find(n => n.slotB === 'i_objman:objman');

// A mod installed by the game under the same name keeps its GUID, so it is updated in place.
const findGuid = (gameDir, name) => pathRows(loadPaths(gameDir)).table.map(r => r[0].str)
  .find(g => readManifest(gameDir, g)?.name === name || readManifest(gameDir, g)?.desc === name) ?? guidFor(name);

function gameRunning() {
  let out = '';
  try { out = require('child_process').execSync('tasklist /FI "IMAGENAME eq starter_x64.exe"', { encoding: 'utf8' }); } catch { /* no tasklist */ }
  return /starter_x64\.exe/i.test(out);
}

function ensureGameClosed() {
  if (gameRunning()) throw new Error('Mius-Front is still running - close the game first.');
}

function install(gameDir, modName, files) {
  if (!files.length) throw new Error('no .mispack given');
  ensureGameClosed();
  const guid = findGuid(gameDir, modName);
  const dir = path.join(commonDir(gameDir), guid);
  const prev = readManifest(gameDir, guid);
  const version = (prev?.version ?? 0) + 1;

  // manifest from the game-made template; only values change, names stay (hash tables untouched)
  const desc = parse(fs.readFileSync(path.join(__dirname, 'templates', 'desc.addpack')));
  desc.nodes[0].rawA = Buffer.alloc(0x20);
  desc.nodes[0].rawA.write(modName.slice(0, 0x1f), 'latin1');
  const set = (name, val) => {
    const v = desc.nodes[1].params.find(p => p.name === name);
    if (v.t === 2) v.str = val; else v.raw.writeUInt32LE(val, 0);
  };
  set('path', guid);
  set('desc', modName);
  set('authors', 'MiusMissionMaker');
  set('version', version);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'shared', 'missions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'desc.addpack'), serialize(desc));
  for (const f of files) fs.copyFileSync(f, path.join(dir, 'shared', 'missions', path.basename(f)));

  const cf = loadPaths(gameDir);
  const rows = pathRows(cf);
  if (!rows.table.some(r => r[0].str.toUpperCase() === guid)) {
    const str = { raw: Buffer.alloc(16), t: 2, pad: Buffer.alloc(12), str: guid, nul: true };
    const one = { raw: Buffer.alloc(16), t: 4, pad: Buffer.alloc(12) };
    one.raw.writeUInt32LE(1, 0);
    rows.table.push([str, one]);
    savePaths(gameDir, cf);
  }
  return { guid, version };
}

function uninstall(gameDir, modName) {
  ensureGameClosed();
  const guid = findGuid(gameDir, modName);
  fs.rmSync(path.join(commonDir(gameDir), guid), { recursive: true, force: true });
  const cf = loadPaths(gameDir);
  const rows = pathRows(cf);
  const before = rows.table.length;
  rows.table = rows.table.filter(r => r[0].str.toUpperCase() !== guid);
  if (rows.table.length !== before) savePaths(gameDir, cf);
  return guid;
}

function list(gameDir) {
  return pathRows(loadPaths(gameDir)).table.map(r => {
    const guid = r[0].str;
    const m = readManifest(gameDir, guid);
    const mis = path.join(commonDir(gameDir), guid, 'shared', 'missions');
    return { guid, manifest: m, missions: fs.existsSync(mis) ? fs.readdirSync(mis) : [] };
  });
}

module.exports = { install, uninstall, list, gameRunning };

if (require.main === module) {
  const [cmd, gameDir, modName, ...files] = process.argv.slice(2);
  try {
    if (cmd === 'install') {
      const { guid, version } = install(gameDir, modName, files);
      console.log(`installed '${modName}' as ${guid} (version ${version}):`);
      files.forEach(f => console.log('  ' + path.basename(f)));
    } else if (cmd === 'uninstall') {
      console.log(`removed '${modName}' (${uninstall(gameDir, modName)})`);
    } else if (cmd === 'list') {
      for (const { guid, manifest: m, missions } of list(gameDir)) {
        console.log(`${guid}  ${m ? `'${m.name}' v${m.version} by ${m.authors}` : '(no manifest)'}  ${missions.join(', ')}`);
      }
    } else {
      console.log('usage: install|uninstall|list <gameDir> [modName] [file.mispack...]');
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
