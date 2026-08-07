import fs from 'fs';
import path from 'path';

const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';
const { decodeDatabase, decodeMapUnit, decodeTreeMap, EventCommandCode, MoveCommandCode } = await import('rpgrt');

const latin1 = { decode(b) { return Buffer.from(b).toString('latin1'); }, encode(s) { return new Uint8Array(Buffer.from(s, 'latin1')); } };
const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: latin1 });

// 加载 treeMap（MapInfo 里的 backgroundName 和 music）
let treeMap = null;
const treeMapPath = path.join(GAME_DIR, 'RPG_RT.lmt');
if (fs.existsSync(treeMapPath)) {
  treeMap = decodeTreeMap(new Uint8Array(fs.readFileSync(treeMapPath)), { engine: '2k', transcoder: latin1 });
}

// ====== 分类 ======
const CATEGORY_DIRS = {
  CharSet: 'CharSet',
  FaceSet: 'FaceSet',
  System: 'System',
  Picture: 'Picture',
  Chipset: 'ChipSet',
  Animation: 'Animation',
  BattleChar: 'Monster',
  BGM: 'Music',
  BGS: 'Music',  // BGS 也在 Music 文件夹
  ME: 'Music',
  SE: 'Sound',
  Movie: 'Movie',
  Panorama: 'Panorama',
  Background: 'Background',
};

const CATEGORY_EXTS = {
  CharSet: ['.png', '.xyz'],
  FaceSet: ['.png', '.xyz'],
  System: ['.png', '.xyz'],
  Picture: ['.png', '.xyz'],
  Chipset: ['.png', '.xyz'],
  Animation: ['.png', '.xyz'],
  BattleChar: ['.png', '.xyz'],
  BGM: ['.mid', '.wav', '.ogg'],
  BGS: ['.mid', '.wav', '.ogg'],
  ME: ['.mid', '.wav', '.ogg'],
  SE: ['.wav', '.ogg'],
  Movie: ['.avi', '.mpg'],
  Panorama: ['.png', '.xyz'],
  Background: ['.png', '.xyz'],
};

// ====== 扫描磁盘素材 ======
const diskAssets = {};
for (const [cat, dir] of Object.entries(CATEGORY_DIRS)) {
  const dirPath = path.join(GAME_DIR, dir);
  if (!fs.existsSync(dirPath)) { diskAssets[cat] = new Set(); continue; }
  const files = fs.readdirSync(dirPath).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return CATEGORY_EXTS[cat].includes(ext);
  }).map(f => path.parse(f).name.toLowerCase());
  diskAssets[cat] = new Set(files);
}

console.log('=== 磁盘素材统计 ===');
for (const [cat, set] of Object.entries(diskAssets)) {
  console.log(`  ${cat.padEnd(12)}: ${set.size} 个`);
}

// ====== 递归扫描所有素材引用 ======
const refs = {}; // cat -> Set<name>
function addRef(cat, name) {
  if (!name) return;
  if (!refs[cat]) refs[cat] = new Set();
  refs[cat].add(name.toLowerCase());
}

// -- Database System --
const sys = db.system;
if (sys) {
  for (const f of ['boatName', 'shipName', 'airshipName']) addRef('CharSet', sys[f]);
  for (const f of ['titleName', 'gameoverName', 'systemName', 'system2Name', 'frameName']) addRef('System', sys[f]);
  addRef('Picture', sys.battletestBackground);

  // Music 子对象
  for (const f of ['titleMusic', 'battleMusic', 'battleEndMusic', 'innMusic', 'boatMusic', 'shipMusic', 'airshipMusic', 'gameoverMusic']) {
    addRef('BGM', sys[f]?.name);
  }
  // Sound 子对象
  for (const f of ['cursorSe', 'decisionSe', 'cancelSe', 'buzzerSe', 'battleSe', 'escapeSe', 'enemyAttackSe', 'enemyDamagedSe', 'actorDamagedSe', 'dodgeSe', 'enemyDeathSe', 'itemSe']) {
    addRef('SE', sys[f]?.name);
  }
}

// -- Actors --
for (const a of db.actors ?? []) {
  addRef('CharSet', a.characterName);
  addRef('FaceSet', a.faceName);
  // battlerAnimation -> BattlerAnimation -> pose.battlerName / weapon.weaponName
  if (a.battlerAnimation >= 0) {
    const ba = db.battleranimations?.[a.battlerAnimation];
    if (ba) {
      for (const pose of ba.poses ?? []) addRef('BattleChar', pose.battlerName);
      for (const wep of ba.weapons ?? []) addRef('BattleChar', wep.weaponName);
    }
  }
}

// -- Enemies --
for (const e of db.enemies ?? []) addRef('BattleChar', e.battlerName);

// -- Terrains --
for (const t of db.terrains ?? []) {
  addRef('Panorama', t.backgroundName);
  addRef('Background', t.backgroundAName);
  addRef('Background', t.backgroundBName);
  addRef('SE', t.footstep?.name);
}

// -- Chipsets --
for (const c of db.chipsets ?? []) addRef('Chipset', c.chipsetName);

// -- Animations --
for (const anim of db.animations ?? []) {
  addRef('Animation', anim.animationName);
  for (const timing of anim.timings ?? []) addRef('SE', timing.se?.name);
}

// -- Skills --
for (const sk of db.skills ?? []) {
  addRef('SE', sk.soundEffect?.name);
  if (sk.animationId >= 0) addRef('Animation', db.animations?.[sk.animationId]?.animationName);
}

// -- Items --
for (const it of db.items ?? []) {
  if (it.animationId >= 0) addRef('Animation', db.animations?.[it.animationId]?.animationName);
}

// -- MapInfo --
if (treeMap?.maps) {
  for (const mi of treeMap.maps) {
    if (mi.musicType === 2) addRef('BGM', mi.music?.name);
    addRef('Picture', mi.backgroundName);
  }
}

// -- EventCommand scan helper --
function parseMC(params, startOffset = 4) {
  const cmds = [];
  let i = startOffset;
  while (i < params.length) {
    const cmdId = params[i++];
    if (cmdId === 0) break;
    const mc = { commandId: cmdId, parameterString: null };
    switch (cmdId) {
      case 34: {
        const strLen = params[i++];
        const bytes = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = String.fromCharCode(...bytes);
        i++; break;
      }
      case 35: {
        const strLen = params[i++];
        const bytes = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = String.fromCharCode(...bytes);
        i += 3; break;
      }
      case 32: case 33: i++; break;
    }
    cmds.push(mc);
  }
  return cmds;
}

function scanEventCmds(cmds) {
  for (const cmd of cmds ?? []) {
    const p = cmd.parameters ?? [];
    switch (cmd.code) {
      case 10130: addRef('FaceSet', cmd.string); break;
      case 10630: addRef('CharSet', cmd.string); break;
      case 10640: addRef('FaceSet', cmd.string); break;
      case 10650: addRef('CharSet', cmd.string); break;
      case 10660: addRef('BGM', cmd.string); break;
      case 10670: addRef('SE', cmd.string); break;
      case 10680: addRef('System', cmd.string); break;
      case 10690: addRef('System', cmd.string); break;
      case 11110: addRef('Picture', cmd.string); break;
      case 11210:
      case 13260:
        if (p[0] >= 0) addRef('Animation', db.animations?.[p[0]]?.animationName);
        break;
      case 11330: {
        for (const mc of parseMC(p)) {
          if (mc.commandId === 34) addRef('CharSet', mc.parameterString);
          else if (mc.commandId === 35) addRef('SE', mc.parameterString);
        }
        break;
      }
      case 11510: addRef('BGM', cmd.string); break;
      case 11550: addRef('SE', cmd.string); break;
      case 11560: addRef('Movie', cmd.string); break;
      case 11570: addRef('BGS', cmd.string); break;
      case 11580: addRef('ME', cmd.string); break;
      case 11710:
        if (p[0] >= 0) addRef('Chipset', db.chipsets?.[p[0]]?.chipsetName);
        break;
      case 11720: addRef('Panorama', cmd.string); break;
      case 13210: addRef('Picture', cmd.string); break;
    }
  }
}

// -- CommonEvents --
for (const ce of db.commonevents ?? []) scanEventCmds(ce.eventCommands);

// -- Troops --
for (const troop of db.troops ?? []) {
  for (const page of troop.pages ?? []) scanEventCmds(page.eventCommands);
}

// -- Maps --
let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: latin1 });

  addRef('Panorama', mu.parallaxName);
  if (mu.chipsetId >= 0) addRef('Chipset', db.chipsets?.[mu.chipsetId]?.chipsetName);

  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      addRef('CharSet', page.characterName);
      scanEventCmds(page.eventCommands);
      for (const mc of page.moveRoute?.moveCommands ?? []) {
        if (mc.commandId === 34) addRef('CharSet', mc.parameterString);
        else if (mc.commandId === 35) addRef('SE', mc.parameterString);
      }
    }
  }
  mapIdx++;
}

// ====== 对比 ======
console.log('\n\n========== 覆盖度对比 ==========\n');
const assetCats = ['CharSet','FaceSet','System','Picture','Chipset','Animation','BattleChar','BGM','BGS','ME','SE','Movie','Panorama','Background'];

let totalDisk = 0, totalCovered = 0, totalMiss = 0;
for (const cat of assetCats) {
  const disk = diskAssets[cat] ?? new Set();
  const ref = refs[cat] ?? new Set();

  if (disk.size === 0 && ref.size === 0) continue;

  // 检查：磁盘中每个素材名是否能被 ref 匹配（精确匹配，小写）
  const covered = new Set();
  const missed = new Set();
  for (const d of disk) {
    if (ref.has(d)) covered.add(d);
    else missed.add(d);
  }

  totalDisk += disk.size;
  totalCovered += covered.size;
  totalMiss += missed.size;

  const mark = missed.size === 0 ? '✅' : '⚠️';
  console.log(`${mark} ${cat.padEnd(12)} 磁盘 ${String(disk.size).padStart(3)} | 追踪 ${String(ref.size).padStart(3)} | 覆盖 ${String(covered.size).padStart(3)} | 未覆盖 ${missed.size}`);

  if (missed.size > 0) {
    console.log(`   未覆盖的素材:`);
    for (const m of [...missed].sort()) console.log(`     - ${m}`);
  }
}

console.log(`\n总计: 磁盘 ${totalDisk} | 覆盖 ${totalCovered} | 未覆盖 ${totalMiss}`);
