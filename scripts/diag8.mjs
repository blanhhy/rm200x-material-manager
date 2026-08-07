import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';

// 手动解码 LCF chunk，找 CommonEvent#70 的原始 EventCommand 数据
// 先拿 RPG_RT.ldb 的原始 bytes
const ldbBuf = fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'));
const ldb = new Uint8Array(ldbBuf);

// 找 "CommonEvent" chunk
const ceSig = [0x43, 0x6F, 0x6D, 0x6D, 0x6F, 0x6E, 0x45, 0x76, 0x65, 0x6E, 0x74, 0x73]; // "CommonEvents"
let pos = 0;
let found = -1;
while (pos < ldb.length - ceSig.length) {
  let match = true;
  for (let i = 0; i < ceSig.length; i++) {
    if (ldb[pos + i] !== ceSig[i]) { match = false; break; }
  }
  if (match) { found = pos; break; }
  pos++;
}
console.log(`CommonEvents sig at offset ${found}`);

// 让我换个方法：直接用 rpgrt 解码，但用 latin1 transcoder 拿到原始 bytes 的"伪字符串"
const { decodeDatabase, decodeMapUnit } = await import('rpgrt');

const latin1 = {
  decode(bytes) { return Buffer.from(bytes).toString('latin1'); },
  encode(str) { return new Uint8Array(Buffer.from(str, 'latin1')); },
};

const shiftJis = {
  decode(bytes) { return iconv.decode(bytes, 'shift_jis'); },
  encode(str) { return new Uint8Array(iconv.encode(str, 'shift_jis')); },
};

const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: latin1 });

// 看 CE#70 的 cmd[6] (code=10610) 的 string 原始 bytes (latin1 下拿到的是原始字节值)
const ce70 = db.commonevents.find(c => c.id === 70);
const cmd6 = ce70.eventCommands[6];
console.log(`\nCE#70 cmd[6] (10610) latin1 string bytes: [${Buffer.from(cmd6.string, 'latin1').toString('hex')}] length=${Buffer.from(cmd6.string, 'latin1').length}`);
console.log(`  shift_jis would decode to: "${iconv.decode(Buffer.from(cmd6.string, 'latin1'), 'shift_jis')}"`);

const cmd7 = ce70.eventCommands[7];
console.log(`CE#70 cmd[7] (10610) latin1 string bytes: [${Buffer.from(cmd7.string, 'latin1').toString('hex')}] length=${Buffer.from(cmd7.string, 'latin1').length}`);

// 现在尝试用 decodeMoveCommands 来解析这些 bytes！
function tryParseMoveCommands(name, strLatin1) {
  const bytes = Buffer.from(strLatin1, 'latin1');
  console.log(`\n尝试把 ${name} 的 string (${bytes.length} bytes) 解析为 MoveCommands...`);
  let offset = 0;
  let foundAny = false;
  while (offset < bytes.length) {
    const { value: cmdId, offset: afterId } = readBer(bytes, offset);
    offset = afterId;
    if (cmdId === 0) { console.log(`  [${offset}] cmdId=0 (end)`); break; }

    if (cmdId === 34) { // changeGraphic
      const { value: strLen, offset: afterLen } = readBer(bytes, offset);
      offset = afterLen;
      const graphicBytes = bytes.slice(offset, offset + strLen);
      offset += strLen;
      const { value: idx, offset: afterIdx } = readBer(bytes, offset);
      offset = afterIdx;
      const graphicShiftJis = iconv.decode(graphicBytes, 'shift_jis');
      const graphicGbk = iconv.decode(graphicBytes, 'gbk');
      console.log(`  changeGraphic: shift_jis="${graphicShiftJis}" gbk="${graphicGbk}" idx=${idx}`);
      foundAny = true;
    } else if (cmdId === 35) { // playSoundEffect
      const { value: strLen, offset: afterLen } = readBer(bytes, offset);
      offset = afterLen;
      const seBytes = bytes.slice(offset, offset + strLen);
      offset += strLen;
      const { value: a, offset: o2 } = readBer(bytes, offset);
      const { value: b, offset: o3 } = readBer(bytes, o2);
      const { value: c, offset: o4 } = readBer(bytes, o3);
      offset = o4;
      const seName = iconv.decode(seBytes, 'shift_jis');
      console.log(`  playSE: "${seName}" A=${a} B=${b} C=${c}`);
      foundAny = true;
    } else if (cmdId <= 41) {
      // 其他 MoveCommand (move up/down/left/right 等)，没有额外参数
      console.log(`  other MoveCommand id=${cmdId}`);
      foundAny = true;
    } else {
      console.log(`  UNKNOWN cmdId=${cmdId} at offset ${offset - 1}`);
      break;
    }
  }
  if (!foundAny) console.log('  未能解析任何 MoveCommand');
  return foundAny;
}

tryParseMoveCommands('CE#70 cmd[6]', cmd6.string);
tryParseMoveCommands('CE#70 cmd[7]', cmd7.string);

// 现在扫描所有 CE 和 Map 里 code=10610 的命令，尝试把它们的 string 解析成 MoveCommands
console.log('\n\n===== 全局扫描 code=10610 的 MoveRoute 解析 =====');
const allCharSetsFromMove = new Set();

function scanCmds(cmds, ctx) {
  for (let i = 0; i < (cmds ?? []).length; i++) {
    const cmd = cmds[i];
    if (cmd.code === 10610 || cmd.code === 10600 || cmd.code === 10620) {
      const bytes = Buffer.from(cmd.string || '', 'latin1');
      // 尝试解析
      let offset = 0;
      let foundChangeGraphic = false;
      while (offset < bytes.length) {
        const { value: cmdId, offset: afterId } = readBer(bytes, offset);
        offset = afterId;
        if (cmdId === 0) break;
        if (cmdId === 34) {
          const { value: strLen, offset: afterLen } = readBer(bytes, offset);
          offset = afterLen;
          const graphicBytes = bytes.slice(offset, offset + strLen);
          offset += strLen;
          const { offset: afterIdx } = readBer(bytes, offset);
          offset = afterIdx;
          const name = iconv.decode(graphicBytes, 'shift_jis');
          allCharSetsFromMove.add(name.toLowerCase());
          foundChangeGraphic = true;
          console.log(`  ✅ ${ctx}: 10610 → changeGraphic="${name}"`);
        } else if (cmdId === 35) {
          const { value: strLen, offset: afterLen } = readBer(bytes, offset);
          offset = afterLen;
          offset += strLen;
          const { offset: o2 } = readBer(bytes, offset);
          const { offset: o3 } = readBer(bytes, o2);
          const { offset: o4 } = readBer(bytes, o3);
          offset = o4;
        } else if (cmdId <= 41) {
          // 无参数 MoveCommand
        } else {
          break;
        }
      }
    }
  }
}

for (const ce of db.commonevents ?? []) {
  scanCmds(ce.eventCommands ?? [], `CE#${ce.id}`);
}

let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: latin1 });
  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      scanCmds(page.eventCommands ?? [], `Map${mapIdx} ev#${ev.id} page#${page.id}`);
    }
  }
  mapIdx++;
}

console.log(`\n===== 从 Set Move Route 里解析出的 CharSet 名称 =====`);
console.log(`共 ${allCharSetsFromMove.size} 个唯一名称:`);
for (const n of allCharSetsFromMove) console.log(`  "${n}"`);

const diskCharSet = fs.readdirSync(path.join(GAME_DIR, 'CharSet')).map(f => {
  const dot = f.lastIndexOf('.');
  return (dot > 0 ? f.slice(0, dot) : f).toLowerCase();
});
const stillUnused = diskCharSet.filter(d => !allCharSetsFromMove.has(d));
console.log(`\n仍然没被引用的磁盘 CharSet: ${stillUnused.length}`);
for (const c of stillUnused) console.log(`  "${c}"`);
