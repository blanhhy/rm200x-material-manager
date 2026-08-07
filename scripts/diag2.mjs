import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { decodeMapUnit } from 'rpgrt';

const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';

function makeTranscoder(enc) {
  return {
    decode(bytes) { return iconv.decode(bytes, enc); },
    encode(str) { return new Uint8Array(iconv.encode(str, enc)); },
  };
}

const enc = 'shift_jis';
const lmu = fs.readFileSync(path.join(GAME_DIR, 'Map0004.lmu'));
const mu = decodeMapUnit(new Uint8Array(lmu), { engine: '2k', transcoder: makeTranscoder(enc) });

console.log(`Map0004 events=${mu.events?.length}`);

// 找所有 eventCommands 里带字符串的，和带 10620/10630 等代码的
const targetEvents = [13, 14, 1, 2, 15, 16];

for (const ev of mu.events) {
  if (!targetEvents.includes(ev.id)) continue;
  console.log(`\n===== Event#${ev.id} "${ev.name}" =====`);
  for (const page of ev.pages ?? []) {
    console.log(`  -- Page#${page.id}: char="${page.characterName}"`);
    // EventCommands
    const cmds = page.eventCommands ?? [];
    console.log(`     EventCommands: ${cmds.length}`);
    for (const cmd of cmds) {
      const p = cmd.parameters ?? [];
      let line = `       code=${cmd.code} indent=${cmd.indent}`;
      if (cmd.string) line += ` string="${cmd.string}"`;
      if (p.length > 0) line += ` params=[${p.join(',')}]`;
      console.log(line);
    }
    // MoveRoute
    const mr = page.moveRoute?.moveCommands ?? [];
    if (mr.length > 0) {
      console.log(`     MoveRoute cmds: ${mr.length}`);
      for (let i = 0; i < mr.length; i++) {
        const c = mr[i];
        let line = `       [${i}] cmdId=${c.commandId}`;
        if (c.parameterString) line += ` string="${c.parameterString}"`;
        line += ` A=${c.parameterA} B=${c.parameterB} C=${c.parameterC}`;
        console.log(line);
      }
    }
  }
}

// 全局扫描：所有事件命令中可能引用 CharSet 的 code
console.log('\n\n===== 全局扫描：所有带 string 的 EventCommand =====');
const refCodes = new Set([10130, 10630, 10640, 10650, 10660, 10670, 10680, 10690, 11110, 11210, 11510, 11550, 11560, 11570, 11580, 11710, 11720, 13210, 13260, 10620, 10610, 10600]);
const allStrings = new Set();
for (const ev of mu.events) {
  for (const page of ev.pages ?? []) {
    for (const cmd of page.eventCommands ?? []) {
      if (cmd.string && cmd.string.trim()) {
        allStrings.add(JSON.stringify({ code: cmd.code, indent: cmd.indent, string: cmd.string, ev: ev.id, page: page.id }));
      }
    }
  }
}
const sorted = [...allStrings].sort();
console.log(`共 ${sorted.length} 个带字符串的命令`);
for (const s of sorted.slice(0, 100)) console.log(s);
