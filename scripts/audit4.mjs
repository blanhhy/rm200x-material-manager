import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';

const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';
const { decodeDatabase, decodeMapUnit, EventCommandCode, MoveCommandCode } = await import('rpgrt');

const latin1 = { decode(b) { return Buffer.from(b).toString('latin1'); }, encode(s) { return new Uint8Array(Buffer.from(s, 'latin1')); } };

const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: latin1 });

const UNKNOWN = new Set(['', '(OFF)']);
function valid(v) { return typeof v === 'string' && v.trim() && !UNKNOWN.has(v.trim()); }

// ====== 1. Database 顶层字段 ======
console.log('========== DATABASE 全字段扫描 ==========\n');

function scanObj(obj, prefix, out) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (valid(v)) out.push(`${prefix}.${k} = "${v}"`);
    else if (v && typeof v === 'object' && !Array.isArray(v)) scanObj(v, `${prefix}.${k}`, out);
  }
}

const hits = [];
scanObj(db, 'db', hits);

// ====== 2. Database 数组类 ======
const arrayRecords = [
  ['actors', 'Actor'], ['enemies', 'Enemy'], ['skills', 'Skill'], ['items', 'Item'],
  ['terrains', 'Terrain'], ['chipsets', 'Chipset'], ['animations', 'Animation'],
  ['battleranimations', 'BattlerAnim'], ['commonevents', 'CommonEvent'], ['troops', 'Troop'],
  ['terms', 'Terms'], ['classes', 'Class'],
];

for (const [key, label] of arrayRecords) {
  const arr = db[key];
  if (!Array.isArray(arr)) continue;
  console.log(`\n--- ${label}[${arr.length}] ---`);
  for (const item of arr) {
    const found = [];
    scanObj(item, `${label}#${item?.id ?? '?'}`, found);
    for (const f of found) console.log(`  ${f}`);
  }
}

// ====== 3. System 子对象的嵌套 ======
console.log('\n\n--- System 子对象（Music/Sound 等） ---');
const sys = db.system;
for (const [k, v] of Object.entries(sys ?? {})) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const found = [];
    scanObj(v, `system.${k}`, found);
    for (const f of found) console.log(`  ${f}`);
  }
}

// ====== 4. Map Unit ======
console.log('\n\n========== MAP UNIT 扫描 ==========');
let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: latin1 });
  console.log(`\n--- Map${mapIdx} ---`);

  // MapUnit 顶层 string
  const mapHits = [];
  for (const [k, v] of Object.entries(mu)) {
    if (valid(v)) mapHits.push(`map${mapIdx}.${k} = "${v}"`);
  }
  for (const h of mapHits) console.log(`  ${h}`);

  // Events
  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      // EventPage 顶层
      for (const [k, v] of Object.entries(page)) {
        if (valid(v)) console.log(`  map${mapIdx} ev#${ev.id} p#${page.id}.${k} = "${v}"`);
      }
      // EventCommands 中的 string
      for (let ci = 0; ci < (page.eventCommands ?? []).length; ci++) {
        const cmd = page.eventCommands[ci];
        if (valid(cmd.string)) console.log(`  map${mapIdx} ev#${ev.id} p#${page.id} cmd[${ci}] code=${cmd.code} .string = "${cmd.string}"`);
        if (cmd.code === EventCommandCode.MoveEvent) {
          const parsed = parseMoveCommandsFromParams(cmd.parameters ?? []);
          for (const mc of parsed) {
            if (valid(mc.parameterString)) console.log(`  map${mapIdx} ev#${ev.id} p#${page.id} cmd[${ci}] MoveEvent.cmd(${mc.commandId}).parameterString = "${mc.parameterString}"`);
          }
        }
      }
      // MoveRoute
      const mr = page.moveRoute?.moveCommands ?? [];
      for (let ci = 0; ci < mr.length; ci++) {
        const mc = mr[ci];
        if (valid(mc.parameterString)) console.log(`  map${mapIdx} ev#${ev.id} p#${page.id} moveRoute[${ci}] cmd(${mc.commandId}).parameterString = "${mc.parameterString}"`);
      }
    }
  }

  mapIdx++;
}

// ====== 5. CommonEvent 里的 string ======
console.log('\n\n========== COMMON EVENT 扫描 ==========');
for (const ce of db.commonevents ?? []) {
  for (let ci = 0; ci < (ce.eventCommands ?? []).length; ci++) {
    const cmd = ce.eventCommands[ci];
    if (valid(cmd.string)) console.log(`  CE#${ce.id} cmd[${ci}] code=${cmd.code} .string = "${cmd.string}"`);
    if (cmd.code === EventCommandCode.MoveEvent) {
      const parsed = parseMoveCommandsFromParams(cmd.parameters ?? []);
      for (const mc of parsed) {
        if (valid(mc.parameterString)) console.log(`  CE#${ce.id} cmd[${ci}] MoveEvent.cmd(${mc.commandId}).parameterString = "${mc.parameterString}"`);
      }
    }
  }
}

// ====== 6. Troops ======
console.log('\n\n========== TROOP 扫描 ==========');
for (const troop of db.troops ?? []) {
  for (let pi = 0; pi < (troop.pages ?? []).length; pi++) {
    const page = troop.pages[pi];
    for (let ci = 0; ci < (page.eventCommands ?? []).length; ci++) {
      const cmd = page.eventCommands[ci];
      if (valid(cmd.string)) console.log(`  Troop#${troop.id} page[${pi}] cmd[${ci}] code=${cmd.code} .string = "${cmd.string}"`);
      if (cmd.code === EventCommandCode.MoveEvent) {
        const parsed = parseMoveCommandsFromParams(cmd.parameters ?? []);
        for (const mc of parsed) {
          if (valid(mc.parameterString)) console.log(`  Troop#${troop.id} page[${pi}] cmd[${ci}] MoveEvent.cmd(${mc.commandId}).parameterString = "${mc.parameterString}"`);
        }
      }
    }
  }
}

// ====== helpers ======
function parseMoveCommandsFromParams(params, startOffset = 4) {
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
        i++;
        break;
      }
      case MoveCommandCode.playSoundEffect: {
        const strLen = params[i++];
        const bytes = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = String.fromCharCode(...bytes);
        i += 3;
        break;
      }
      case MoveCommandCode.switchOn:
      case MoveCommandCode.switchOff:
        i++; break;
    }
    cmds.push(mc);
  }
  return cmds;
}
