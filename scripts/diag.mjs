import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { decodeMapUnit, decodeDatabase } from 'rpgrt';

const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';

const ICONV_TO = {
  latin1: 'latin1', gbk: 'gbk', shift_jis: 'shift_jis', euc_jp: 'eucjp', utf8: 'utf8',
};

function makeTranscoder(enc) {
  const target = ICONV_TO[enc] ?? enc;
  return {
    decode(bytes) { return iconv.decode(bytes, target); },
    encode(str) { return new Uint8Array(iconv.encode(str, target)); },
  };
}

const CANDIDATES = ['shift_jis', 'gbk', 'euc_jp', 'utf8'];

function tryDecode(name, buf, decodeFn) {
  console.log(`\n=== ${name} ===`);
  for (const enc of CANDIDATES) {
    try {
      const t = makeTranscoder(enc);
      const obj = decodeFn(buf, { engine: '2k', transcoder: t });
      console.log(`\n--- encoding: ${enc} ---`);
      return { enc, obj };
    } catch (e) {
      console.log(`  ${enc}: FAIL - ${e.message}`);
    }
  }
  return null;
}

// 1. 先看磁盘文件名
console.log('=== 磁盘目录 ===');
for (const dir of fs.readdirSync(GAME_DIR)) {
  const p = path.join(GAME_DIR, dir);
  if (fs.statSync(p).isDirectory()) {
    const files = fs.readdirSync(p).slice(0, 10);
    console.log(`  [${dir}/]`, files);
  }
}

// 2. 解码 LDB 找最佳编码
const ldb = fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'));
let bestEnc = 'shift_jis';
for (const enc of CANDIDATES) {
  try {
    const t = makeTranscoder(enc);
    const db = decodeDatabase(new Uint8Array(ldb), { engine: '2k', transcoder: t });
    console.log(`\n--- LDB encoding: ${enc} ---`);
    console.log(`  Actors: ${db.actors?.length}, Chipsets: ${db.chipsets?.length}`);
    const sample = db.actors?.slice(0, 3).map(a => `  Actor#${a.id}: ${a.name} | char="${a.characterName}" face="${a.faceName}"`);
    if (sample?.length) console.log(sample.join('\n'));
    bestEnc = enc;
    break;
  } catch (e) { console.log(`  ${enc}: ${e.message}`); }
}

// 3. 解码 Map0004.lmu
const mapPath = path.join(GAME_DIR, 'Map0004.lmu');
if (!fs.existsSync(mapPath)) { console.log('Map0004.lmu not found'); process.exit(0); }

const lmu = fs.readFileSync(mapPath);
const { enc: muEnc, obj: mu } = tryDecode('Map0004.lmu', new Uint8Array(lmu), decodeMapUnit);

console.log(`\n=== Map0004 (encoding=${muEnc}) ===`);
console.log(`  chipsetId=${mu.chipsetId}, events=${mu.events?.length}`);

// 打印所有事件概览
for (const ev of mu.events ?? []) {
  console.log(`\n  Event#${ev.id} "${ev.name}" @(${ev.x},${ev.y}) pages=${ev.pages?.length}`);
  for (const page of ev.pages ?? []) {
    console.log(`    Page#${page.id}: char="${page.characterName}" idx=${page.characterIndex} moveType=${page.moveType}`);
    const mc = page.moveRoute?.moveCommands ?? [];
    const changeGraphics = mc.filter(c => c.commandId === 34 || c.commandId === 35);
    if (changeGraphics.length > 0) {
      console.log(`      MoveRoute has ${mc.length} cmds, changeGraphic/sound: ${changeGraphics.length}`);
      for (const c of changeGraphics) {
        console.log(`        cmdId=${c.commandId} string="${c.parameterString}" A=${c.parameterA} B=${c.parameterB} C=${c.parameterC}`);
      }
    } else if (mc.length > 0) {
      console.log(`      MoveRoute has ${mc.length} cmds (no changeGraphic/sound found)`);
      const ids = [...new Set(mc.map(c => c.commandId))].sort();
      console.log(`      commandIds seen: [${ids.join(', ')}]`);
      // 打印所有带 parameterString 的
      const withStr = mc.filter(c => c.parameterString && c.parameterString.length > 0);
      if (withStr.length > 0) {
        console.log('      cmds with strings:');
        for (const c of withStr) {
          console.log(`        cmdId=${c.commandId} string="${c.parameterString}"`);
        }
      }
    }
  }
}
