import fs from 'fs';
import path from 'path';
import { decodeDatabase } from 'rpgrt';

let dir;
function findDir(d, dep) {
  if (dep <= 0) return;
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!dir) findDir(p, dep - 1);
      } else if (e.name === 'RPG_RT.ldb' && p.includes('地獄病棟')) {
        dir = path.dirname(p); return;
      }
    }
  } catch (e) {}
}
findDir('D:\\Games', 10);
console.log('找到项目:', dir);

console.log('项目路径:', dir);

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
walk(dir);

console.log('\n=== Battle/ 目录文件 ===');
const battleFiles = files.filter(f => path.basename(path.dirname(f)).toLowerCase() === 'battle');
for (const f of battleFiles) console.log(' ', path.basename(f));

console.log('\n=== .g235 文件 ===');
const g235Files = files.filter(f => f.toLowerCase().endsWith('.g235'));
for (const f of g235Files) console.log(' ', path.basename(f));

console.log('\n=== DB animations ===');
const ldbBuf = fs.readFileSync(path.join(dir, 'RPG_RT.ldb'));
const db = decodeDatabase(new Uint8Array(ldbBuf), { engine: '2k' });
console.log('animations count:', db.animations?.length);
for (const anim of db.animations ?? []) {
  console.log(`  anim[${anim.id}].name="${anim.name}" animationName="${anim.animationName}"`);
}

console.log('\n=== BattlerAnimation poses → battleAnimationId ===');
console.log('battleranimations count:', db.battleranimations?.length);
for (const ba of db.battleranimations ?? []) {
  for (const pose of ba.poses ?? []) {
    if (pose.battleAnimationId != null && pose.battleAnimationId >= 0) {
      const target = db.animations?.[pose.battleAnimationId];
      console.log(`  BA[${ba.id}].pose[${pose.id}] → anim[${pose.battleAnimationId}].animationName="${target?.animationName}"`);
    }
  }
}

console.log('\n=== terrain.backgroundAName / backgroundBName ===');
for (const t of db.terrains ?? []) {
  if (t.backgroundAName || t.backgroundBName) {
    console.log(`  terrain[${t.id}].name="${t.name}" bgA="${t.backgroundAName}" bgB="${t.backgroundBName}"`);
  }
}

console.log('\n=== 扫 map event commands 找 ChangeBattleBG (13210) ===');
// 需要 lmt 文件
const lmtPath = path.join(dir, 'RPG_RT.lmt');
if (fs.existsSync(lmtPath)) {
  // 简化：看 maps 文件夹
  const mapsDir = path.join(dir, 'Map0001.lmu') + ''; // RM2k lmt 里存的是 map 信息
  console.log('lmt 存在，maps 目录:');
  const mapFiles = files.filter(f => f.toLowerCase().endsWith('.lmu'));
  for (const m of mapFiles) console.log(' ', path.basename(m));
}

// 看看 system.battletestBackground
console.log('\n=== system 字段 ===');
const sys = db.system;
console.log('  battletestBackground:', JSON.stringify(sys.battletestBackground));
console.log('  titleName:', JSON.stringify(sys.titleName));
console.log('  frameName:', JSON.stringify(sys.frameName));

// actors / enemies 的 battlerName
console.log('\n=== enemies.battlerName ===');
for (const e of db.enemies ?? []) {
  if (e.battlerName) console.log(`  enemy[${e.id}].name="${e.name}" battlerName="${e.battlerName}"`);
}

// 看 troop event commands 里的动画引用
console.log('\n=== troop event commands with animationId ===');
for (const tp of db.troops ?? []) {
  for (let pi = 0; pi < (tp.pages ?? []).length; pi++) {
    const page = tp.pages[pi];
    for (const cmd of page.eventCommands ?? []) {
      if (cmd.code === 11210 || cmd.code === 13260) {
        const animId = cmd.parameters?.[0];
        const target = db.animations?.[animId];
        console.log(`  troop[${tp.id}].page[${pi}].cmd[${cmd.code}] → anim[${animId}].animationName="${target?.animationName}"`);
      }
      if (cmd.code === 13210) {
        console.log(`  troop[${tp.id}].page[${pi}].ChangeBattleBG → "${cmd.string}"`);
      }
    }
  }
}
