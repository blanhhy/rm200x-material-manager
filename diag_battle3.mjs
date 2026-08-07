import fs from 'fs';
import path from 'path';
import { decodeDatabase } from 'rpgrt';

const dirs = [];
function findAll(d, dep) {
  if (dep <= 0) return;
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) findAll(p, dep - 1);
      else if (e.name === 'RPG_RT.ldb') dirs.push(path.dirname(p));
    }
  } catch (e) {}
}
findAll('D:\\Games', 10);

// 随机选几个项目看 animationName 和 Battle/ 文件的匹配
for (const dir of dirs.slice(0, 8)) {
  const name = path.basename(dir).substring(0, 18);
  const files = [];
  function walk(d) {
    try { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else files.push(path.basename(p));
    } } catch (e) {}
  }
  walk(dir);
  const battlePngs = files.filter(f => {
    // 找 Battle/ 目录下的文件
    const full = files.find(ff => ff === f);
    return f.toLowerCase().endsWith('.png') || f.toLowerCase().endsWith('.xyz');
  });
  
  // 更准确：找 Battle/ 下的文件
  const allFiles = [];
  function walkFull(d, base) {
    try { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkFull(p, path.join(base, e.name));
      else allFiles.push({ rel: path.posix.join(base.replace(/\\/g,'/'), e.name), name: e.name });
    } } catch (e) {}
  }
  walkFull(dir, '');
  const battlePics = allFiles.filter(f => f.rel.toLowerCase().includes('/battle/') || f.rel.toLowerCase().startsWith('battle/'));
  
  const ldbBuf = fs.readFileSync(path.join(dir, 'RPG_RT.ldb'));
  const db = decodeDatabase(new Uint8Array(ldbBuf), { engine: '2k' });
  
  if (db.animations?.length > 0) {
    console.log(`\n=== ${name} (Battle pics: ${battlePics.length}, Animations: ${db.animations.length}) ===`);
    const animNames = db.animations.map(a => a.animationName).filter(Boolean);
    console.log('  animNames:', animNames.slice(0, 5).join(', '));
    console.log('  battle pics:', battlePics.slice(0, 5).map(f => f.name).join(', '));
    
    // 做匹配：animationName vs 文件名（去扩展名）
    const battleStems = battlePics.map(f => path.parse(f.name).name);
    const matched = animNames.filter(an => battleStems.includes(an));
    console.log('  匹配数:', matched.length, '/', animNames.length);
  }
}
