import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { decodeMapUnit, decodeDatabase } from 'rpgrt';

const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';
function transcoder(enc) { return { decode(bytes) { return iconv.decode(bytes, enc); }, encode(str) { return new Uint8Array(iconv.encode(str, enc)); } }; }
const enc = 'shift_jis';
const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: transcoder(enc) });

console.log('===== CommonEvents =====');
for (const ce of db.commonevents ?? []) {
  console.log(`\nCE#${ce.id} "${ce.name}" (trigger=${ce.trigger} switchFlag=${ce.switchFlag} switchId=${ce.switchId})`);
  const cmds = ce.eventCommands ?? [];
  console.log(`  ${cmds.length} commands`);
  for (const cmd of cmds) {
    const p = cmd.parameters ?? [];
    let line = `    code=${cmd.code} indent=${cmd.indent}`;
    if (cmd.string) line += ` string="${cmd.string}"`;
    if (p.length) line += ` params=[${p.join(',')}]`;
    console.log(line);
  }
}

console.log('\n\n===== Troops =====');
for (const troop of db.troops ?? []) {
  console.log(`\nTroop#${troop.id} pages=${troop.pages?.length}`);
  for (let pi = 0; pi < (troop.pages ?? []).length; pi++) {
    const page = troop.pages[pi];
    console.log(`  Page#${pi} conditions=${JSON.stringify(page.conditions).slice(0, 200)}`);
    const cmds = page.eventCommands ?? [];
    for (const cmd of cmds) {
      const p = cmd.parameters ?? [];
      let line = `    code=${cmd.code} indent=${cmd.indent}`;
      if (cmd.string) line += ` string="${cmd.string}"`;
      if (p.length) line += ` params=[${p.join(',')}]`;
      console.log(line);
    }
  }
}

// 再查一遍所有 map 的 eventCommands 里的 10620 (Set Move Route) 命令
// 因为 Set Move Route 的 parameters 里包含事件ID，然后它后面跟着嵌套的 move commands
console.log('\n\n===== 所有 Map 里的 10620 (Set Move Route) 命令 =====');
let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: transcoder(enc) });

  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      const cmds = page.eventCommands ?? [];
      for (let i = 0; i < cmds.length; i++) {
        const cmd = cmds[i];
        if (cmd.code === 10620 || cmd.code === 10610 || cmd.code === 10600) {
          console.log(`\nMap${mapIdx} ev#${ev.id} page#${page.id}`);
          console.log(`  cmd[${i}] code=${cmd.code} params=${cmd.parameters}`);
          // 打印接下来的嵌套命令（indent 更深的）
          let j = i + 1;
          while (j < cmds.length && cmds[j].indent > cmd.indent) {
            const c2 = cmds[j];
            let line = `    cmd[${j}] code=${c2.code} indent=${c2.indent}`;
            if (c2.string) line += ` string="${c2.string}"`;
            if (c2.parameters?.length) line += ` params=[${c2.parameters.join(',')}]`;
            console.log(line);
            j++;
          }
        }
      }
    }
  }
  mapIdx++;
}
