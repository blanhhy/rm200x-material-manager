import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';
const { decodeDatabase, decodeMapUnit, EventCommandCode, MoveCommandCode } = await import('rpgrt');

const latin1 = { decode(b) { return Buffer.from(b).toString('latin1'); }, encode(s) { return new Uint8Array(Buffer.from(s, 'latin1')); } };

const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: latin1 });

function parseMoveCommandsFromParams(params, startOffset = 4) {
  const cmds = [];
  let i = startOffset;
  while (i < params.length) {
    const cmdId = params[i++];
    if (cmdId === 0) break;
    const mc = { commandId: cmdId, parameterString: null, parameterA: 0, parameterB: 0, parameterC: 0 };
    switch (cmdId) {
      case MoveCommandCode.changeGraphic: {
        const strLen = params[i++];
        const bytes = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = String.fromCharCode(...bytes);
        mc.parameterA = params[i++];
        break;
      }
      case MoveCommandCode.playSoundEffect: {
        const strLen = params[i++];
        const bytes = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = String.fromCharCode(...bytes);
        mc.parameterA = params[i++];
        mc.parameterB = params[i++];
        mc.parameterC = params[i++];
        break;
      }
      case MoveCommandCode.switchOn:
      case MoveCommandCode.switchOff:
        mc.parameterA = params[i++];
        break;
    }
    cmds.push(mc);
  }
  return cmds;
}

// 全量扫描
const allChangeGraphics = new Map();
function scanCmds(cmds, ctx) {
  for (const cmd of cmds ?? []) {
    if (cmd.code === EventCommandCode.MoveEvent) {
      const params = cmd.parameters ?? [];
      const parsed = parseMoveCommandsFromParams(params);
      for (const mc of parsed) {
        if (mc.commandId === 34 && mc.parameterString) {
          const name = mc.parameterString.toLowerCase();
          if (!allChangeGraphics.has(name)) allChangeGraphics.set(name, []);
          allChangeGraphics.get(name).push(ctx);
        }
        if (mc.commandId === 35 && mc.parameterString) {
          const name = mc.parameterString.toLowerCase();
          // SE
          if (!allChangeGraphics.has(name)) allChangeGraphics.set(name, []);
          allChangeGraphics.get(name).push(ctx + '(SE)');
        }
      }
    }
  }
}

for (const ce of db.commonevents ?? []) scanCmds(ce.eventCommands ?? [], `CE#${ce.id}`);
let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: latin1 });
  for (const ev of mu.events ?? [])
    for (const page of ev.pages ?? [])
      scanCmds(page.eventCommands ?? [], `Map${mapIdx} ev#${ev.id} p${page.id}`);
  mapIdx++;
}

console.log(`\n=== MoveEvent 中提取到的 changeGraphic/playSoundEffect (${allChangeGraphics.size} 个唯一名字) ===`);
const charsetDir = path.join(GAME_DIR, 'CharSet');

// 对比未使用的
const diskCharSets = new Set(
  fs.readdirSync(charsetDir)
    .filter(f => /\.(png|xyz)$/i.test(f))
    .map(f => path.parse(f).name.toLowerCase())
);
console.log(`\n磁盘 CharSet 数: ${diskCharSets.size}`);
const trackedByMoveEvent = new Set([...allChangeGraphics.keys()].filter(k => !k.endsWith('.wav')));
console.log(`MoveEvent 追踪到的名字（不含SE）: ${trackedByMoveEvent.size}`);
const unused = [...diskCharSets].filter(n => !trackedByMoveEvent.has(n));
console.log(`其中 MoveEvent 能覆盖: ${[...diskCharSets].filter(n => trackedByMoveEvent.has(n)).length}`);

// 打印未匹配的 unicode 名字
console.log(`\n=== MoveEvent 中的所有 changeGraphic 名字 ===`);
for (const [name, locs] of [...allChangeGraphics.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${name}  (出现在 ${new Set(locs).size} 处)`);
}
