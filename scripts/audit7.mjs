import fs from 'fs';
import path from 'path';

const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';
const { decodeDatabase, decodeMapUnit, EventCommandCode, MoveCommandCode } = await import('rpgrt');

const latin1 = { decode(b) { return Buffer.from(b).toString('latin1'); }, encode(s) { return new Uint8Array(Buffer.from(s, 'latin1')); } };
const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: latin1 });

const UNKNOWN = new Set(['', '(OFF)']);
function valid(v) { return typeof v === 'string' && v.trim() && !UNKNOWN.has(v.trim()); }

// 这些 key 是纯文本，不是素材名
const TEXT_KEYS = new Set([
  'name','title','description','usingMessage1','usingMessage2','usingMessage3','skillName',
  'message1','message2','message3','message4','message','easyrpgBattle2k3Message',
  'easyrpgStatusSceneName','heroName','face1Name','face2Name','face3Name','face4Name',
  'graphicsName','fontName','maniacMessageFontName','origSpriteName','spriteName',
]);

// EventCommand 中没有素材 string 的 code（消息/注释/选择）
const TEXT_CMD_CODES = new Set([
  10110, 20110,      // ShowMessage
  10140, 20140, 20141, // ShowChoice
  12410, 22410,      // Comment
  10610, 10620,      // ChangeHeroName/Title
  10740,             // EnterHeroName
]);

const results = [];

function shouldTrack(key) {
  if (TEXT_KEYS.has(key)) return false;
  // 名字暗示素材引用
  const k = key.toLowerCase();
  return k.includes('name') || k.includes('graphic') || k.includes('bgm') || k.includes('bgs') ||
         k.includes('music') || k.includes('sound') || k.includes('se') || k.includes('animation') ||
         k.includes('chipset') || k.includes('charset') || k.includes('face') || k.includes('panorama') ||
         k.includes('background') || k.includes('system') || k.includes('frame') || k.includes('movie') ||
         k.includes('picture') || k.includes('battler') || k.includes('weapon');
}

function walk(obj, path) {
  if (!obj) return;
  if (typeof obj === 'string') {
    if (valid(obj) && shouldTrack(path.split('.').pop())) {
      results.push({ path, value: obj });
    }
    return;
  }
  if (typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) walk(obj[i], `${path}[${i}]`);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_unknown') continue;
    if (k === 'string' && path.includes('EventCommand')) {
      // EventCommand.string —— 过滤掉文本 command
      const cmd = obj;
      if (!TEXT_CMD_CODES.has(cmd.code) && valid(v)) {
        results.push({ path: `${path} (code=${cmd.code})`, value: v });
      }
      continue;
    }
    if (k === 'parameterString') {
      // MoveCommand.parameterString
      if (valid(v) && (obj.commandId === 34 || obj.commandId === 35)) {
        results.push({ path: `${path} (MoveCmd=${obj.commandId})`, value: v });
      }
      continue;
    }
    walk(v, path ? `${path}.${k}` : k);
  }
}

// ====== 扫描 ======
console.log('扫描 Database...');
walk(db, 'db');

console.log('扫描 Maps...');
let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: latin1 });
  walk(mu, `Map${mapIdx}`);
  mapIdx++;
}

// MoveEvent parameters 里的 inline MoveCommands
console.log('扫描 MoveEvent 内联命令...');
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

function scanMoveEvents(cmds, ctx) {
  for (let ci = 0; ci < (cmds ?? []).length; ci++) {
    const cmd = cmds[ci];
    if (cmd.code === EventCommandCode.MoveEvent) {
      const parsed = parseMC(cmd.parameters ?? []);
      for (let pi = 0; pi < parsed.length; pi++) {
        const mc = parsed[pi];
        if (valid(mc.parameterString)) {
          const cat = mc.commandId === 34 ? 'CharSet' : mc.commandId === 35 ? 'SE' : '?';
          results.push({ path: `${ctx}.cmd[${ci}].MoveEvent[${pi}] cmd=${mc.commandId} → ${cat}`, value: mc.parameterString });
        }
      }
    }
  }
}

for (const ce of db.commonevents ?? []) scanMoveEvents(ce.eventCommands, `CE#${ce.id}`);
mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: latin1 });
  for (const ev of mu.events ?? [])
    for (const page of ev.pages ?? [])
      scanMoveEvents(page.eventCommands, `Map${mapIdx}.ev#${ev.id}.p#${page.id}`);
  mapIdx++;
}
for (const troop of db.troops ?? [])
  for (let pi = 0; pi < (troop.pages ?? []).length; pi++)
    scanMoveEvents(troop.pages[pi].eventCommands, `Troop#${troop.id}.p[${pi}]`);

// ====== 输出 ======
console.log(`\n\n========== 所有素材引用候选 (${results.length} 处) ==========\n`);

// 按路径关键词分组
const groups = {};
for (const r of results) {
  const key = r.path.split('.').slice(0, 3).join('.');
  if (!groups[key]) groups[key] = [];
  groups[key].push(r);
}

for (const [g, items] of Object.entries(groups).sort()) {
  console.log(`\n--- ${g} (${items.length} 处) ---`);
  for (const r of items) console.log(`  ${r.path.replace(g + '.', '').padEnd(60)} "${r.value}"`);
}
