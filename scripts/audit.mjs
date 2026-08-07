import fs from 'fs';
import path from 'path';
import { RECORD_DESCRIPTORS, EventCommandCode, MoveCommandCode } from 'rpgrt';

// ========== 1. 穷举所有 Record Type 的字段 ==========
console.log('=== 所有 Record 类型字段 ===\n');
const CATEGORIES = ['CharSet','FaceSet','System','Picture','Chipset','Animation','BattleChar','BGM','BGS','ME','SE','Movie','Panorama','Background','Monster'];

const strRecordTypes = ['Actor','Enemy','System','MapInfo','MapUnit','EventPage','CommonEvent','TroopPage','Chipset','Terrain','Animation','BattlerAnimation','BattlerAnimationPose','BattlerAnimationWeapon','Skill','Item'];

function guessCategory(fieldName) {
  const n = fieldName.toLowerCase();
  if (n.includes('charset') || n.includes('charname') || n === 'boatorshipname' || n.includes('shipname') || n.includes('airshipname')) return 'CharSet';
  if (n.includes('facename') || n.includes('facegraphic')) return 'FaceSet';
  if (n.includes('systemname') || n.includes('title') || n.includes('gameover') || n.includes('framename') || n.includes('system2name')) return 'System';
  if (n.includes('picture') || n.includes('backgroundname') || n.includes('bg_a') || n.includes('bg_b') || n.includes('battletestbackground')) return 'Picture';
  if (n.includes('chipset')) return 'Chipset';
  if (n.includes('animation') && !n.includes('id')) return 'Animation';
  if (n.includes('battler')) return 'BattleChar';
  if (n.includes('music') || n.endsWith('bgm')) return 'BGM';
  if (n.includes('bgs')) return 'BGS';
  if (n.includes('sound') || n.endsWith('_se') || n.includes('se') || n.includes('soundeffect')) return 'SE';
  if (n.includes('me')) return 'ME';
  if (n.includes('movie')) return 'Movie';
  if (n.includes('panorama') || n.includes('pbg')) return 'Panorama';
  if (n.includes('backgroundaname') || n.includes('backgroundbname')) return 'Background';
  return null;
}

for (const [recordName, descriptor] of Object.entries(RECORD_DESCRIPTORS)) {
  const strFields = [];
  const structFields = [];
  for (const f of descriptor.fields ?? []) {
    if (f.codec?.kind === 'string' || f.codec?.kind === 'lcfString' || (f.codec?.kind === 'scalar' && f.codec.scalar === 'berStr')) {
      strFields.push({ key: f.key, liblcfName: f.liblcfName, guessedCat: guessCategory(f.key) });
    } else if (f.codec?.kind === 'struct') {
      structFields.push({ key: f.key, codec: f.codec.structOf });
    }
  }
  if (strFields.length) {
    console.log(`【${recordName}】含 string 字段 (${strFields.length} 个):`);
    for (const f of strFields) {
      console.log(`  ${f.key}  (liblcf: ${f.liblcfName})  ← 可能是: ${f.guessedCat ?? '?'}`);
    }
  }
}

// ========== 2. EventCommandCode 枚举全部值 ==========
console.log('\n\n=== EventCommandCode 枚举全值 ===');
const ecc = EventCommandCode;
for (const [k, v] of Object.entries(ecc)) {
  if (typeof v === 'number') console.log(`  ${k} = ${v}`);
}
