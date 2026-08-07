import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { decodeMapUnit, decodeDatabase } from 'rpgrt';

const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';
function transcoder(enc) { return { decode(bytes) { return iconv.decode(bytes, enc); }, encode(str) { return new Uint8Array(iconv.encode(str, enc)); } }; }
const enc = 'shift_jis';
const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: transcoder(enc) });

const allNestedChangeGraphic = [];
const allFaceChanges = [];
const allCharChanges = [];

function scanCmds(cmds, ctx) {
  for (let i = 0; i < (cmds ?? []).length; i++) {
    const cmd = cmds[i];

    // code 10600/10610/10620 = Set Move Route (target: vehicle/all/1 event)
    // 后面缩进更深的 eventCommands 其实是 MoveCommand！
    if ([10600, 10610, 10620].includes(cmd.code)) {
      // 参数里 [0] 是目标事件ID (0=本事件)
      const target = cmd.parameters?.[0];
      // 收集所有后续缩进更深的
      let j = i + 1;
      while (j < cmds.length && cmds[j].indent > cmd.indent) {
        const nested = cmds[j];
        // RPG Maker: MoveCommand 的 code 在 EventCommand 里表现为 commandId+300 左右？
        // 实际上 rpgrt 把它们都解析成 EventCommand，code 就是命令码
        // changeGraphic 在 EventCommand 里也是 10630？不对，Set Move Route 嵌套的是 MoveCommand
        // MoveCommand 的 commandId 范围是 1-41 左右
        const id = nested.code;
        if (id === 34) {
          allNestedChangeGraphic.push({ ...ctx, target, nestedCmdId: id, string: nested.string || nested.parameters?.[0], params: nested.parameters });
        } else if (id === 35) {
          // playSE
        }
        j++;
      }
    }

    if (cmd.code === 10630 && cmd.string) {
      allCharChanges.push({ ...ctx, string: cmd.string });
    }
    if (cmd.code === 10130 && cmd.string) {
      allFaceChanges.push({ ...ctx, string: cmd.string });
    }
  }
}

console.log('===== CommonEvent Set Move Route + 10630 =====');
for (const ce of db.commonevents ?? []) {
  scanCmds(ce.eventCommands ?? [], { kind: 'CE', id: ce.id });
}

console.log(`\nSet Move Route 里嵌套的 changeGraphic: ${allNestedChangeGraphic.length}`);
for (const r of allNestedChangeGraphic) console.log(`  ${JSON.stringify(r)}`);

console.log(`\nCommonEvent 里 10630 (Change Sprite Association): ${allCharChanges.length}`);
for (const r of allCharChanges) console.log(`  ${JSON.stringify(r)}`);

console.log(`\nCommonEvent 里 10130 (Change Face): ${allFaceChanges.length}`);
const uniqueFace = [...new Set(allFaceChanges.map(x => x.string.toLowerCase()))];
console.log(`  唯一 faceset 名称: ${uniqueFace.length}`);
for (const f of uniqueFace) console.log(`    "${f}"`);

// Troops
console.log('\n\n===== Troops =====');
let troopIdx = 1;
for (const troop of db.troops ?? []) {
  for (let pi = 0; pi < (troop.pages ?? []).length; pi++) {
    scanCmds(troop.pages[pi]?.eventCommands ?? [], { kind: 'Troop', id: troop.id, page: pi });
  }
  troopIdx++;
}
console.log(`Troop 嵌套 changeGraphic: ${allNestedChangeGraphic.length - allNestedChangeGraphic.filter(x => x.kind === 'CE').length}`);

// 所有 Map
console.log('\n\n===== 所有 Map =====');
let mapIdx = 1;
let mapTotal = 0;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: transcoder(enc) });
  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      scanCmds(page.eventCommands ?? [], { kind: `Map${mapIdx}`, evId: ev.id, pageId: page.id });
    }
  }
  mapIdx++;
}

console.log(`\n===== 汇总 =====`);
console.log(`所有 Set Move Route 嵌套 changeGraphic 总数: ${allNestedChangeGraphic.length}`);
for (const r of allNestedChangeGraphic) console.log(`  ${JSON.stringify(r)}`);

console.log(`\n所有 10630 (Change Sprite Association) 总数: ${allCharChanges.length}`);
for (const r of allCharChanges) console.log(`  ${JSON.stringify(r)}`);

// 新追踪到的 CharSet 名称
const newChars = [...new Set([
  ...allNestedChangeGraphic.map(x => (x.string || '').toLowerCase()),
  ...allCharChanges.map(x => (x.string || '').toLowerCase()),
].filter(Boolean))];
console.log(`\n新追踪到的 CharSet 名称: ${newChars.length}`);
for (const c of newChars) console.log(`  "${c}"`);

// 磁盘 CharSet
const diskCharSet = fs.readdirSync(path.join(GAME_DIR, 'CharSet')).map(f => {
  const dot = f.lastIndexOf('.');
  return (dot > 0 ? f.slice(0, dot) : f).toLowerCase();
});
const stillUnused = diskCharSet.filter(d => !newChars.includes(d));
console.log(`\n仍然没被引用的磁盘 CharSet: ${stillUnused.length}`);
for (const c of stillUnused) console.log(`  "${c}"`);
