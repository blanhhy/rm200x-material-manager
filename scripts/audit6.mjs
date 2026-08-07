import fs from 'fs';
const src = fs.readFileSync('E:\\rm200x-material-manager\\node_modules\\rpgrt\\dist\\src-CTGG3Zy6.mjs', 'utf8');

// 找每个含 string 的字段属于哪个 Record
const records = src.split(/\n(\w+):\s*\{\s*$/m);
// 更精确：找 Record 名字 + 它内部的所有 key
const lines = src.split('\n');
let currentRecord = null;
let result = {};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // 顶层 record 定义：8空格 + Word: {
  const recMatch = line.match(/^\s{8}(\w+):\s*\{\s*$/);
  if (recMatch) {
    currentRecord = recMatch[1];
    result[currentRecord] = [];
  }
  if (currentRecord) {
    const keyMatch = line.match(/key:\s*"(\w+)"/);
    if (keyMatch && (line.includes('kind: "string"') || lines[i+1]?.includes('kind: "string"') || lines[i+2]?.includes('kind: "string"') || lines[i-1]?.includes('kind: "string"'))) {
      result[currentRecord].push(keyMatch[1]);
    }
  }
}

// 只输出有 string 字段的 record
for (const [rec, keys] of Object.entries(result)) {
  if (keys.length && rec !== 'RECORD_DESCRIPTORS' && rec !== 'CODECS') {
    console.log(`【${rec}】`);
    for (const k of keys) console.log(`  ${k}`);
  }
}
