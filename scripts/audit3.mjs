import fs from 'fs';
import path from 'path';
const src = fs.readFileSync('E:\\rm200x-material-manager\\node_modules\\rpgrt\\dist\\src-CTGG3Zy6.mjs', 'utf8');

// 提取所有 "key": "xxx" 同时 codec.kind === "string" 的
const lines = src.split('\n');

let inRecord = false;
let currentRecord = null;
let braceDepth = 0;

// 找所有 "RecordName": { 开头的
const recordStarts = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^(\s+)(\w+):\s*\{\s*$/);
  if (m && m[1].length === 8) { // top-level record
    recordStarts.push({ name: m[2], line: i });
  }
}

// 对每个 record，找到它的 fields 数组，然后找其中 codec.kind === "string" 的
const records = {};
for (const rs of recordStarts) {
  // 找 fields
  let fieldsStart = -1;
  for (let i = rs.line; i < Math.min(rs.line + 20, lines.length); i++) {
    if (lines[i].includes('fields:')) { fieldsStart = i; break; }
  }
  if (fieldsStart < 0) continue;

  const strFields = [];
  let i = fieldsStart;
  let depth = 0;
  let curField = null;
  let curKey = null;

  // 往后遍历找每个 field 定义
  while (i < lines.length) {
    const line = lines[i];
    if (line.includes('codec:') || line.includes('key:')) {
      const km = line.match(/key:\s*"([^"]+)"/);
      if (km) curKey = km[1];
      if (line.includes('kind: "string"') || line.includes('kind: "lcfString"')) {
        strFields.push(curKey);
      }
    }
    // 到下一个同级 record 为止
    if (i > fieldsStart + 5 && line.trim() === '' && lines[i+1]?.match(/^\s{8}\w+:\s*\{/)) break;
    i++;
  }
  if (strFields.length) records[rs.name] = strFields;
}

console.log('=== 所有 Record 中含 string 类型的字段 ===\n');
for (const [rec, fields] of Object.entries(records)) {
  console.log(`【${rec}】`);
  for (const f of fields) console.log(`  ${f}`);
  console.log('');
}
