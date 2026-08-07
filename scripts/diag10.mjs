import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';
const { decodeDatabase, decodeMapUnit } = await import('rpgrt');

const latin1 = {
  decode(bytes) { return Buffer.from(bytes).toString('latin1'); },
  encode(str) { return new Uint8Array(Buffer.from(str, 'latin1')); },
};

const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: latin1 });

// 看看 CE#70 cmd[6] code=10610 和 code=11330 的完整信息
const ce70 = db.commonevents.find(c => c.id === 70);
console.log('CE#70 完整命令列表:');
for (let i = 0; i < ce70.eventCommands.length; i++) {
  const c = ce70.eventCommands[i];
  const bytes = Buffer.from(c.string || '', 'latin1');
  console.log(`  [${i}] code=${c.code} indent=${c.indent} params=${JSON.stringify(c.parameters)} stringLen=${bytes.length} stringHex=[${bytes.toString('hex').slice(0, 60)}]`);
}

// 搜所有 CommonEvent 和 Map 里 code=11330 的命令
console.log('\n\n===== 全局搜索 code=11330 (MoveEvent) =====');
function findMoveEvents(cmds, ctx) {
  for (let i = 0; i < (cmds ?? []).length; i++) {
    const c = cmds[i];
    if (c.code === 11330) {
      const bytes = Buffer.from(c.string || '', 'latin1');
      console.log(`  ${ctx} [${i}] params=${JSON.stringify(c.parameters)} stringLen=${bytes.length} hex=[${bytes.toString('hex')}]`);
      // 尝试把 string bytes 解析成 MoveCommands
      console.log(`    string 解析:`, parseMoveCommands(bytes));
    }
  }
}

function readBer(bytes, offset) {
  let result = 0, shift = 0, b;
  do { b = bytes[offset++]; result |= (b & 0x7F) << shift; shift += 7; } while (b & 0x80);
  return { value: result, offset };
}

function parseMoveCommands(bytes) {
  const results = [];
  let offset = 0;
  while (offset < bytes.length) {
    const { value: cmdId, offset: afterId } = readBer(bytes, offset);
    offset = afterId;
    if (cmdId === 0) break;
    if (cmdId === 34) {
      const { value: strLen, offset: afterLen } = readBer(bytes, offset);
      offset = afterLen;
      const nameBytes = bytes.slice(offset, offset + strLen);
      offset += strLen;
      const { value: idx, offset: afterIdx } = readBer(bytes, offset);
      offset = afterIdx;
      results.push(`changeGraphic="${iconv.decode(nameBytes, 'shift_jis')}" idx=${idx}`);
    } else if (cmdId === 35) {
      const { value: strLen, offset: afterLen } = readBer(bytes, offset);
      offset = afterLen;
      const seBytes = bytes.slice(offset, offset + strLen);
      offset += strLen;
      const { offset: o2 } = readBer(bytes, offset);
      const { offset: o3 } = readBer(bytes, o2);
      const { offset: o4 } = readBer(bytes, o3);
      offset = o4;
      results.push(`playSE="${iconv.decode(seBytes, 'shift_jis')}"`);
    } else if (cmdId <= 41) {
      results.push(`move(${cmdId})`);
    } else {
      results.push(`UNKNOWN(${cmdId})`);
      break;
    }
  }
  return results;
}

for (const ce of db.commonevents ?? []) {
  findMoveEvents(ce.eventCommands ?? [], `CE#${ce.id}`);
}

let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: latin1 });
  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      findMoveEvents(page.eventCommands ?? [], `Map${mapIdx} ev#${ev.id} page#${page.id}`);
    }
  }
  mapIdx++;
}

// 也搜一下所有 code 值，看看有没有其他可能 Set Move Route 的 code
console.log('\n\n===== 所有出现过的 EventCommand code（按频率排序）=====');
const codeCounts = new Map();
for (const ce of db.commonevents ?? []) {
  for (const c of ce.eventCommands ?? []) codeCounts.set(c.code, (codeCounts.get(c.code) ?? 0) + 1);
}
mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: latin1 });
  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      for (const c of page.eventCommands ?? []) codeCounts.set(c.code, (codeCounts.get(c.code) ?? 0) + 1);
    }
  }
  mapIdx++;
}
const sorted = [...codeCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [code, count] of sorted) {
  // 只打印有意义的 code（不是 END=10 或注释=12410/22410）
  if (![10, 12410, 22410, 12330, 22010, 22011].includes(code)) {
    console.log(`  code=${code}: ${count} 次`);
  }
}
