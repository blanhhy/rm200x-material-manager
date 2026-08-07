import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { decodeMapUnit, decodeDatabase } from 'rpgrt';

const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';

function transcoder(enc) {
  return {
    decode(bytes) { return iconv.decode(bytes, enc); },
    encode(str) { return new Uint8Array(iconv.encode(str, enc)); },
  };
}

// 先收集所有磁盘文件名 stem (lowercase)
const diskStems = new Map(); // stem -> fullPath (first match)
function walk(dir, rel = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, path.join(rel, entry.name));
    else {
      const dot = entry.name.lastIndexOf('.');
      const stem = (dot > 0 ? entry.name.slice(0, dot) : entry.name).toLowerCase();
      if (stem && !diskStems.has(stem)) diskStems.set(stem, path.join(rel, entry.name));
    }
  }
}
walk(GAME_DIR);
console.log(`磁盘 stem 总数: ${diskStems.size}`);
// 看看 charset 目录里的
console.log('\n磁盘 [CharSet/] stem 样本:');
for (const [stem, p] of diskStems) {
  if (p.toLowerCase().includes('charset/')) console.log(`  "${stem}" -> ${p}`);
}

// 用 shift_jis 解码 LDB 和所有 LMU
const enc = 'shift_jis';
const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: transcoder(enc) });

console.log('\n===== DB 里的 characterName / faceName =====');
const charNamesInDB = new Set();
const faceNamesInDB = new Set();
for (const a of db.actors ?? []) {
  if (a.characterName) charNamesInDB.add(a.characterName.trim());
  if (a.faceName) faceNamesInDB.add(a.faceName.trim());
  console.log(`  Actor#${a.id}: char="${a.characterName}" match=${diskStems.has((a.characterName||'').toLowerCase())}`);
}
console.log(`\n  boatName="${db.system?.boatName}" shipName="${db.system?.shipName}" airshipName="${db.system?.airshipName}"`);
console.log(`  match boat=${diskStems.has((db.system?.boatName||'').toLowerCase())}`);

// 解码所有 MapXXXX.lmu
console.log('\n===== 所有 LMU 里的引用 =====');
const refsFromLMU = new Map(); // key = "charset|xxx|type|detail"
let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: transcoder(enc) });

  // Map level
  if (mu.parallaxName) refsFromLMU.set(`parallax|${mapIdx}|map.parallaxName|`, mu.parallaxName);

  // Events
  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      if (page.characterName) refsFromLMU.set(`charset|${mapIdx}|ev#${ev.id}.page#${page.id}.characterName|`, page.characterName);

      // Event commands with strings
      for (const cmd of page.eventCommands ?? []) {
        if (cmd.string && cmd.string.trim()) {
          refsFromLMU.set(`evcmd|${mapIdx}|ev#${ev.id}.page#${page.id}.code${cmd.code}|`, cmd.string.trim());
        }
      }
      // MoveRoute strings
      for (const mc of page.moveRoute?.moveCommands ?? []) {
        if (mc.parameterString && mc.parameterString.trim()) {
          refsFromLMU.set(`mvroute|${mapIdx}|ev#${ev.id}.page#${page.id}.cmdId${mc.commandId}|`, mc.parameterString.trim());
        }
      }
    }
  }

  mapIdx++;
}

console.log(`\n收集到 ${refsFromLMU.size} 个引用字符串`);
console.log('\n--- 按类别分组 ---');
const byCat = {};
for (const [key, val] of refsFromLMU) {
  const cat = key.split('|')[0];
  byCat[cat] = byCat[cat] || [];
  byCat[cat].push({ key, val, match: diskStems.has(val.toLowerCase()) });
}

for (const [cat, list] of Object.entries(byCat)) {
  console.log(`\n[${cat}] count=${list.length}`);
  const unmatched = list.filter(x => !x.match);
  if (unmatched.length > 0) {
    console.log(`  ❌ 未匹配磁盘的 (${unmatched.length}):`);
    for (const x of unmatched.slice(0, 20)) console.log(`    "${x.val}" @ ${x.key}`);
  }
  const matched = list.filter(x => x.match);
  if (matched.length > 0) {
    console.log(`  ✅ 匹配的 (${matched.length}):`);
    for (const x of matched.slice(0, 10)) console.log(`    "${x.val}" -> ${diskStems.get(x.val.toLowerCase())}`);
  }
}

// 关键问题：所有 charset 类别里，有多少个不匹配？
console.log('\n===== charset 类完整清单 =====');
const charsetRefs = [...refsFromLMU.entries()].filter(([k]) => k.startsWith('charset|'));
for (const [key, val] of charsetRefs) {
  const match = diskStems.has(val.toLowerCase());
  console.log(`  ${match ? '✅' : '❌'} "${val}" @ ${key}`);
}
