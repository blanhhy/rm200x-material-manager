import fs from 'fs';
const srcPath = 'E:\\rm200x-material-manager\\node_modules\\rpgrt\\dist\\src-CTGG3Zy6.mjs';
const src = fs.readFileSync(srcPath, 'utf8');

// 提取 RECORD_DESCRIPTORS 对象
const match = src.match(/const RECORD_DESCRIPTORS = (\{[\s\S]*?\n\});\n/);
if (!match) { console.log('未找到'); process.exit(1); }

// 用 Function 构造器求值（只取 key 名）
const obj = eval(match[1]);

function guessCat(fieldKey) {
  const n = fieldKey.toLowerCase();
  if (n.includes('charset') || n === 'charactername' || n === 'charname') return 'CharSet';
  if (n === 'boatorshipname' || n === 'shipname' || n === 'airshipname') return 'CharSet';
  if (n.includes('facename')) return 'FaceSet';
  if (n.includes('systemname') || n.includes('system2name')) return 'System';
  if (n.includes('titlename') || n.includes('gameovername') || n === 'framename') return 'System';
  if (n.includes('chipsetname')) return 'Chipset';
  if (n.includes('animationname')) return 'Animation';
  if (n.includes('battler') && n.includes('name')) return 'BattleChar';
  if (n.includes('battletestbackground')) return 'Picture';
  if (n.includes('parallaxname') || n.includes('pbg')) return 'Panorama';
  if (n.includes('picture') || n.includes('backgroundname')) return 'Picture';
  if (n === 'backgroundaname' || n === 'backgroundbname') return 'Background';
  if (n.endsWith('music') || n.includes('_music')) return 'BGM';
  if (n.includes('soundeffect')) return 'SE';
  return null;
}

console.log('=== rpgrt RECORD_DESCRIPTORS 中所有含 string 的字段 ===\n');
for (const [recordName, desc] of Object.entries(obj)) {
  const strFields = (desc.fields ?? []).filter(f => f.codec && (f.codec.kind === 'string' || f.codec.kind === 'lcfString'));
  if (!strFields.length) continue;
  console.log(`【${recordName}】`);
  for (const f of strFields) {
    const cat = guessCat(f.key);
    const mark = cat ? ' ⭐' : '';
    console.log(`  ${f.key.padEnd(30)} (liblcf: ${f.liblcfName})${mark}`);
  }
  console.log('');
}

// 额外：找出所有 struct/array 里又含 string 的
console.log('\n=== 含 struct 字段的 Record（可能嵌套 string） ===\n');
for (const [recordName, desc] of Object.entries(obj)) {
  const structFields = (desc.fields ?? []).filter(f => f.codec?.kind === 'struct' || f.codec?.kind === 'array');
  if (structFields.length) console.log(`【${recordName}】→ ${structFields.map(f => `${f.key}(${f.codec.structOf ?? f.codec.arrayOf})`).join(', ')}`);
}
