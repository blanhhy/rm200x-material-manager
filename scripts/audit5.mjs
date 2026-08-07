import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';

const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';
const { decodeDatabase, decodeMapUnit, EventCommandCode, MoveCommandCode } = await import('rpgrt');

const latin1 = { decode(b) { return Buffer.from(b).toString('latin1'); }, encode(s) { return new Uint8Array(Buffer.from(s, 'latin1')); } };
const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: latin1 });

const UNKNOWN = new Set(['', '(OFF)']);
function valid(v) { return typeof v === 'string' && v.trim() && !UNKNOWN.has(v.trim()); }

// 这些 key 不是素材名，是纯文本
const SKIP_KEYS = new Set([
  'name','title','description','usingMessage1','usingMessage2','usingMessage3',
  'easyrpgBattle2k3Message','message1','message2','message3','message4','message',
]);

// 分类：哪些 key 映射到什么 AssetCategory
function catOf(key, parent) {
  const n = key.toLowerCase();
  const p = (parent || '').toLowerCase();
  if (n === 'charactername' || n === 'charname') return 'CharSet';
  if (n === 'boatorshipname' || n === 'shipname' || n === 'airshipname') return 'CharSet';
  if (n === 'facename') return 'FaceSet';
  if (n === 'systemname' || n === 'system2name') return 'System';
  if (n === 'titlename' || n === 'gameovername' || n === 'framename') return 'System';
  if (n === 'chipsetname') return 'Chipset';
  if (n === 'animationname') return 'Animation';
  if (n === 'battlername') return 'BattleChar';
  if (n === 'weaponname') return 'BattleChar';
  if (n === 'parallaxname') return 'Panorama';
  if (n === 'backgroundname' || n === 'pbg') return 'Panorama';
  if (n === 'backgroundaname') return 'Background';
  if (n === 'backgroundbname') return 'Background';
  if (n === 'battletestbackground') return 'Picture';
  if (n.includes('picture') && n.endsWith('name')) return 'Picture';
  if (n.endsWith('music') || n === 'bgm') return 'BGM';
  if (n.includes('bgm')) return 'BGM';
  if (n.includes('bgs')) return 'BGS';
  if (n.includes('memusic') || n.includes('memorized')) return 'BGM';
  return null;
}

function scanObj(obj, prefix, out) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (valid(v) && !SKIP_KEYS.has(k)) {
      const cat = catOf(k, prefix);
      if (cat) out.push({ path: `${prefix}.${k}`, value: v, cat });
      else out.push({ path: `${prefix}.${k}`, value: v, cat: '?' });
    }
  }
}

// ====== 全量 Database ======
const allHits = [];

// System 及子对象
scanObj(db.system, 'system', allHits);
for (const [k, v] of Object.entries(db.system ?? {})) {
  if (v && typeof v === 'object' && !Array.isArray(v)) scanObj(v, `system.${k}`, allHits);
}

// 数组类
const arrayRecords = [
  ['actors', 'Actor'], ['enemies', 'Enemy'], ['terrains', 'Terrain'], ['chipsets', 'Chipset'],
  ['animations', 'Animation'], ['battleranimations', 'BattlerAnim'], ['skills', 'Skill'],
];
for (const [key, label] of arrayRecords) {
  for (const item of db[key] ?? []) {
    scanObj(item, `${label}#${item?.id ?? '?'}`, allHits);
    // 嵌套子对象
    for (const [k, v] of Object.entries(item ?? {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // Sound/Music 子对象
        for (const [k2, v2] of Object.entries(v)) {
          if (valid(v2) && k2 === 'name') {
            allHits.push({ path: `${label}#${item.id}.${k}.name`, value: v2, cat: guessCatFromParent(k) });
          }
        }
      }
    }
  }
}

function guessCatFromParent(parentKey) {
  const n = parentKey.toLowerCase();
  if (n.includes('music') || n.includes('bgm')) return 'BGM';
  if (n.includes('bgs')) return 'BGS';
  if (n.includes('se') || n.includes('sound')) return 'SE';
  if (n.includes('me')) return 'ME';
  return null;
}

// ====== Map Unit ======
let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: latin1 });

  // MapUnit 顶层
  for (const [k, v] of Object.entries(mu)) {
    if (valid(v) && !SKIP_KEYS.has(k)) {
      const cat = catOf(k, 'MapUnit');
      allHits.push({ path: `Map${mapIdx}.${k}`, value: v, cat });
    }
  }
  if (valid(mu.chipsetName)) allHits.push({ path: `Map${mapIdx}.chipsetName(间接通过chipsetId)`, value: mu.chipsetName, cat: 'Chipset' });

  // Events / Pages
  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      // EventPage 顶层 string
      for (const [k, v] of Object.entries(page)) {
        if (valid(v) && !SKIP_KEYS.has(k)) {
          const cat = catOf(k, 'EventPage');
          allHits.push({ path: `Map${mapIdx}.ev#${ev.id}.p#${page.id}.${k}`, value: v, cat });
        }
      }
      // MoveRoute
      for (let ci = 0; ci < (page.moveRoute?.moveCommands ?? []).length; ci++) {
        const mc = page.moveRoute.moveCommands[ci];
        if (valid(mc.parameterString)) {
          const cat = mc.commandId === 34 ? 'CharSet' : mc.commandId === 35 ? 'SE' : '?';
          allHits.push({ path: `Map${mapIdx}.ev#${ev.id}.p#${page.id}.moveRoute[${ci}] cmd(${mc.commandId})`, value: mc.parameterString, cat });
        }
      }
      // EventCommands
      for (let ci = 0; ci < (page.eventCommands ?? []).length; ci++) {
        const cmd = page.eventCommands[ci];
        if (valid(cmd.string)) {
          allHits.push({ path: `Map${mapIdx}.ev#${ev.id}.p#${page.id}.cmd[${ci}] code=${cmd.code}`, value: cmd.string, cat: codeCat(cmd.code) });
        }
        if (cmd.code === EventCommandCode.MoveEvent) {
          const parsed = parseMC(cmd.parameters ?? []);
          for (const mc of parsed) {
            if (valid(mc.parameterString)) {
              const cat = mc.commandId === 34 ? 'CharSet' : mc.commandId === 35 ? 'SE' : '?';
              allHits.push({ path: `Map${mapIdx}.ev#${ev.id}.p#${page.id}.cmd[${ci}] MoveEvent cmd(${mc.commandId})`, value: mc.parameterString, cat });
            }
          }
        }
      }
    }
  }
  mapIdx++;
}

// ====== CommonEvent ======
for (const ce of db.commonevents ?? []) {
  for (let ci = 0; ci < (ce.eventCommands ?? []).length; ci++) {
    const cmd = ce.eventCommands[ci];
    if (valid(cmd.string)) {
      allHits.push({ path: `CE#${ce.id}.cmd[${ci}] code=${cmd.code}`, value: cmd.string, cat: codeCat(cmd.code) });
    }
    if (cmd.code === EventCommandCode.MoveEvent) {
      const parsed = parseMC(cmd.parameters ?? []);
      for (const mc of parsed) {
        if (valid(mc.parameterString)) {
          const cat = mc.commandId === 34 ? 'CharSet' : mc.commandId === 35 ? 'SE' : '?';
          allHits.push({ path: `CE#${ce.id}.cmd[${ci}] MoveEvent cmd(${mc.commandId})`, value: mc.parameterString, cat });
        }
      }
    }
  }
}

// ====== Troops ======
for (const troop of db.troops ?? []) {
  for (let pi = 0; pi < (troop.pages ?? []).length; pi++) {
    const page = troop.pages[pi];
    for (let ci = 0; ci < (page.eventCommands ?? []).length; ci++) {
      const cmd = page.eventCommands[ci];
      if (valid(cmd.string)) {
        allHits.push({ path: `Troop#${troop.id}.p[${pi}].cmd[${ci}] code=${cmd.code}`, value: cmd.string, cat: codeCat(cmd.code) });
      }
      if (cmd.code === EventCommandCode.MoveEvent) {
        const parsed = parseMC(cmd.parameters ?? []);
        for (const mc of parsed) {
          if (valid(mc.parameterString)) {
            const cat = mc.commandId === 34 ? 'CharSet' : mc.commandId === 35 ? 'SE' : '?';
            allHits.push({ path: `Troop#${troop.id}.p[${pi}].cmd[${ci}] MoveEvent cmd(${mc.commandId})`, value: mc.parameterString, cat });
          }
        }
      }
    }
  }
}

// ====== 输出 ======
console.log(`=== 素材引用扫描结果 (共 ${allHits.length} 处) ===\n`);

// 按 category 分组
const byCat = {};
for (const h of allHits) {
  if (!byCat[h.cat]) byCat[h.cat] = [];
  byCat[h.cat].push(h);
}

for (const cat of Object.keys(byCat).sort()) {
  const items = byCat[cat];
  // 去重 value
  const unique = [...new Set(items.map(i => i.value.toLowerCase()))];
  console.log(`\n【${cat}】共 ${items.length} 处引用 / ${unique.length} 个唯一名字`);
  for (const h of items) console.log(`  ${h.path.padEnd(80)}  "${h.value}"`);
}

// ====== helpers ======
function codeCat(code) {
  return ({
    10130: 'FaceSet', 10630: 'CharSet', 10640: 'FaceSet', 10650: 'CharSet',
    10660: 'BGM', 10670: 'SE', 10680: 'System', 10690: 'System',
    11110: 'Picture', 11510: 'BGM', 11550: 'SE', 11560: 'Movie',
    11570: 'BGS', 11580: 'ME', 11720: 'Panorama', 13210: 'Picture',
  })[code] ?? null;
}

function parseMC(params, startOffset = 4) {
  const cmds = [];
  let i = startOffset;
  while (i < params.length) {
    const cmdId = params[i++];
    if (cmdId === 0) break;
    const mc = { commandId: cmdId, parameterString: null };
    switch (cmdId) {
      case MoveCommandCode.changeGraphic: {
        const strLen = params[i++];
        const bytes = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = String.fromCharCode(...bytes);
        i++; break;
      }
      case MoveCommandCode.playSoundEffect: {
        const strLen = params[i++];
        const bytes = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = String.fromCharCode(...bytes);
        i += 3; break;
      }
      case MoveCommandCode.switchOn:
      case MoveCommandCode.switchOff: i++; break;
    }
    cmds.push(mc);
  }
  return cmds;
}
