import fs from 'fs';
import path from 'path';
import { decodeDatabase } from 'rpgrt';

// 找一个有 .g235 文件的项目
let targetDir = null;
function find(d, dep) {
  if (dep <= 0) return;
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) find(p, dep - 1);
      else if (e.name.endsWith('.g235') && !targetDir) {
        let cur = path.dirname(p);
        while (cur) {
          if (fs.existsSync(path.join(cur, 'RPG_RT.ldb'))) { targetDir = cur; break; }
          const parent = path.dirname(cur);
          if (parent === cur) break;
          cur = parent;
        }
      }
    }
  } catch (e) {}
}
find('D:\\Games', 10);

if (!targetDir) { console.log('没有找到带 .g235 的项目'); process.exit(); }

console.log('项目:', targetDir);

const files = [];
function walk(d) {
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  } catch (e) {}
}
walk(targetDir);

console.log('\n=== .g235 文件 ===');
for (const f of files.filter(f => f.toLowerCase().endsWith('.g235'))) {
  console.log(' ', path.basename(f));
}

console.log('\n=== Battle/ 目录 ===');
for (const f of files.filter(f => path.basename(path.dirname(f)).toLowerCase() === 'battle')) {
  console.log(' ', path.basename(f));
}

const ldbBuf = fs.readFileSync(path.join(targetDir, 'RPG_RT.ldb'));
const db = decodeDatabase(new Uint8Array(ldbBuf), { engine: '2k' });

console.log('\n=== DB animations (前5个) ===');
console.log('animations count:', db.animations?.length);
for (const anim of (db.animations ?? []).slice(0, 5)) {
  console.log(`  anim[${anim.id}].name="${anim.name}" animationName="${anim.animationName}"`);
}
