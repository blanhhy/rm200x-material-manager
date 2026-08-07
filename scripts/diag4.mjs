import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { decodeMapUnit, decodeDatabase } from 'rpgrt';

// 模拟 traceAllReferences 的核心逻辑（完整版）
function validName(name) {
  if (!name) return false;
  const t = name.trim();
  if (!t) return false;
  if (t.toLowerCase() === '' || t.toLowerCase() === '(off)') return false;
  return true;
}

const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';

function makeTranscoder(enc) {
  return {
    decode(bytes) { return iconv.decode(bytes, enc); },
    encode(str) { return new Uint8Array(iconv.encode(str, enc)); },
  };
}

const enc = 'shift_jis';
const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: makeTranscoder(enc) });

console.log('=== DB direct charset references ===');
console.log('Actors charName count:', db.actors?.filter(a => validName(a.characterName)).map(a => `"${a.characterName}"`));
console.log('System boat/ship/airship:', db.system?.boatName, db.system?.shipName, db.system?.airshipName);

// 所有 LMU 的引用（模拟 traceAllReferences）
const allRefs = [];
let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: makeTranscoder(enc) });

  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      if (validName(page.characterName)) {
        allRefs.push({ cat: 'CharSet', name: page.characterName, from: `Map${mapIdx} ev#${ev.id} page#${page.id} characterName` });
      }
      // EventCommand
      for (const cmd of page.eventCommands ?? []) {
        const codes = [10130, 10630, 10640, 10650, 10660, 10670, 10680, 10690, 11110, 11510, 11550, 11560, 11570, 11580, 11720, 13210];
        if (codes.includes(cmd.code) && validName(cmd.string)) {
          let cat = 'Picture';
          if ([10630, 10650].includes(cmd.code)) cat = 'CharSet';
          else if (cmd.code === 10130 || cmd.code === 10640) cat = 'FaceSet';
          else if (cmd.code === 10660) cat = 'BGM';
          else if (cmd.code === 10670) cat = 'SE';
          else if (cmd.code === 10680 || cmd.code === 10690) cat = 'System';
          else if (cmd.code === 11110 || cmd.code === 13210) cat = 'Picture';
          else if (cmd.code === 11510) cat = 'BGM';
          else if (cmd.code === 11550) cat = 'SE';
          else if (cmd.code === 11560) cat = 'Movie';
          else if (cmd.code === 11570) cat = 'BGS';
          else if (cmd.code === 11580) cat = 'ME';
          else if (cmd.code === 11720) cat = 'Panorama';
          allRefs.push({ cat, name: cmd.string, from: `Map${mapIdx} ev#${ev.id} page#${page.id} cmd${cmd.code}` });
        }
      }
      // MoveRoute
      for (const mc of page.moveRoute?.moveCommands ?? []) {
        if (mc.commandId === 34 && validName(mc.parameterString)) {
          allRefs.push({ cat: 'CharSet', name: mc.parameterString, from: `Map${mapIdx} ev#${ev.id} page#${page.id} mvRoute changeGraphic` });
        }
        if (mc.commandId === 35 && validName(mc.parameterString)) {
          allRefs.push({ cat: 'SE', name: mc.parameterString, from: `Map${mapIdx} ev#${ev.id} page#${page.id} mvRoute playSE` });
        }
      }
    }
  }

  mapIdx++;
}

console.log(`\n=== LMU+DB 完整 charset 引用清单 === (shift_jis 解码)`);
const charsetOnly = allRefs.filter(r => r.cat === 'CharSet');
const uniqueCharSetNames = [...new Set(charsetOnly.map(r => r.name.toLowerCase()))];
console.log(`总共 ${charsetOnly.length} 条，唯一名称 ${uniqueCharSetNames.length} 个:`);
for (const n of uniqueCharSetNames) console.log(`  "${n}"`);

// 磁盘所有 charset
const charsetDir = path.join(GAME_DIR, 'CharSet');
const diskCharSet = fs.readdirSync(charsetDir).map(f => {
  const dot = f.lastIndexOf('.');
  return (dot > 0 ? f.slice(0, dot) : f).toLowerCase();
});
console.log(`\n磁盘 CharSet 目录: ${diskCharSet.length} 个文件:`);
for (const n of diskCharSet) console.log(`  "${n}"`);

// 磁盘里有但没被引用的
const unusedOnDisk = diskCharSet.filter(d => !uniqueCharSetNames.includes(d));
console.log(`\n⚠️  磁盘里有但 DB/LMU 没引用的 CharSet: ${unusedOnDisk.length} 个:`);
for (const n of unusedOnDisk) console.log(`  "${n}"`);

// DB/LMU 引用了但磁盘没有的
const missingOnDisk = uniqueCharSetNames.filter(d => !diskCharSet.includes(d));
console.log(`\n⚠️  DB/LMU 引用了但磁盘没找到的 CharSet: ${missingOnDisk.length} 个:`);
for (const n of missingOnDisk) console.log(`  "${n}"`);
