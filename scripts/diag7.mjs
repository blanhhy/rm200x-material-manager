import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { decodeMapUnit, decodeDatabase } from 'rpgrt';

const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';
function transcoder(enc) { return { decode(bytes) { return iconv.decode(bytes, enc); }, encode(str) { return new Uint8Array(iconv.encode(str, enc)); } }; }
const enc = 'shift_jis';
const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: transcoder(enc) });

function findAll10620(cmds, ctx) {
  for (let i = 0; i < (cmds ?? []).length; i++) {
    const cmd = cmds[i];
    if ([10600, 10610, 10620].includes(cmd.code)) {
      console.log(`\n【10620 @ ${ctx}】 cmd[${i}] code=${cmd.code} indent=${cmd.indent} params=${JSON.stringify(cmd.parameters)}`);
      let j = i + 1;
      while (j < cmds.length && cmds[j].indent > cmd.indent) {
        const c2 = cmds[j];
        let line = `  [${j}] code=${c2.code} indent=${c2.indent}`;
        if (c2.string) line += ` string="${c2.string}"`;
        if (c2.parameters?.length) line += ` params=[${c2.parameters.join(',')}]`;
        console.log(line);
        j++;
      }
    }
  }
}

console.log('===== CommonEvents 中的 Set Move Route =====');
for (const ce of db.commonevents ?? []) {
  findAll10620(ce.eventCommands ?? [], `CE#${ce.id}`);
}

console.log('\n\n===== 所有 Map 中的 Set Move Route =====');
let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: transcoder(enc) });
  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      findAll10620(page.eventCommands ?? [], `Map${mapIdx} ev#${ev.id} page#${page.id}`);
    }
  }
  mapIdx++;
}

// 同时看看 rpgrt 解码出来的 EventCommand 的 type 等字段
console.log('\n\n===== 检查一个 CE 的原始结构 =====');
const ce1 = db.commonevents?.find(c => c.id === 70);
if (ce1) {
  for (let i = 0; i < Math.min(ce1.eventCommands.length, 30); i++) {
    const c = ce1.eventCommands[i];
    console.log(`  [${i}] ${JSON.stringify(c)}`);
  }
}
