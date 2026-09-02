// Scans RM2k/2k3 games and counts Chinese character frequencies
// using the project's own encoding detection.
//
// Usage:
//   npx tsx scripts/scan-game-hanzi.ts --dir <扫描根目录> [--dir <更多目录>] [--write]
//   --write 时把统计出的 Top-500 常用汉字直接写回 src/core/data/commonHanzi.json
//   扫描根目录也可用环境变量 RM_SCAN_ROOTS="dir1;dir2" 提供（见 ./gameScanner.ts）

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { decodeDatabase, decodeMapUnit } from 'rpgrt';
import type { Database, MapUnit, EventCommand, EngineVersion, Transcoder } from 'rpgrt';
import { detectEncoding, detectEngine } from '../src/core/lcfLoader';
import { makeTranscoder } from '../src/core/internal/lcfIo';
import { COMMON_HANZI_REF } from './common_hanzi_ref';
import { parseScanArgs, scanGames } from './gameScanner';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// Dialog event command codes (excluding Comment which is not display text)
const TEXT_CMDS = new Set([
  10110, 20110, // ShowMessage
  10140, 20140, // ShowChoice
  10150,        // InputNumber
  10610,        // ChangeHeroName
  10740,        // EnterHeroName
]);

function collectCmdTexts(cmd: EventCommand, texts: string[]) {
  if (!cmd) return;
  if (cmd.string && TEXT_CMDS.has(cmd.code)) texts.push(cmd.string);
}

function collectMapTexts(map: MapUnit, texts: string[]) {
  for (const ev of map.events || []) {
    // 事件名(ev.name)是编辑器标签(EV0001)，非显示文本，与核心 extractMapTexts 一致不取
    for (const page of ev.pages || []) {
      for (const cmd of page.eventCommands || []) collectCmdTexts(cmd, texts);
    }
  }
}

function collectDbTexts(db: Database, _engine: EngineVersion, texts: string[]) {
  // DB display text fields (same as collectDisplayTexts in lcfLoader.ts)
  for (const a of db.actors ?? []) {
    if ((a as any).name) texts.push((a as any).name);
    if ((a as any).title) texts.push((a as any).title);
  }
  for (const c of (db as any).classes ?? []) {
    if (c.name) texts.push(c.name);
  }
  for (const sk of db.skills ?? []) {
    if ((sk as any).name) texts.push((sk as any).name);
    if (sk.description) texts.push(sk.description);
    if (sk.usingMessage1) texts.push(sk.usingMessage1);
    if (sk.usingMessage2) texts.push(sk.usingMessage2);
  }
  for (const it of db.items ?? []) {
    if ((it as any).name) texts.push((it as any).name);
    if (it.description) texts.push(it.description);
  }
  for (const en of db.enemies ?? []) {
    if ((en as any).name) texts.push((en as any).name);
  }
  for (const st of db.states ?? []) {
    if ((st as any).name) texts.push((st as any).name);
  }
  for (const tr of db.terrains ?? []) {
    if ((tr as any).name) texts.push((tr as any).name);
  }
  for (const at of db.attributes ?? []) {
    if ((at as any).name) texts.push((at as any).name);
  }
  for (const an of db.animations ?? []) {
    if ((an as any).name) texts.push((an as any).name);
  }
  for (const br of (db as any).battleranimations ?? []) {
    if (br.name) texts.push(br.name);
  }
  for (const tp of db.troops ?? []) {
    if ((tp as any).name) texts.push((tp as any).name);
    for (const page of tp.pages || [])
      for (const cmd of page.eventCommands || []) collectCmdTexts(cmd, texts);
  }
  for (const ce of db.commonevents ?? []) {
    if ((ce as any).name) texts.push((ce as any).name);
    for (const cmd of ce.eventCommands || []) collectCmdTexts(cmd, texts);
  }
}

async function main() {
  const cli = parseScanArgs();
  const { games: gameDirs } = scanGames(cli.roots);
  console.log(`找到 ${gameDirs.length} 个游戏目录.\n`);

  const freq = new Map<string, number>();
  let totalGames = 0;
  const encResults: { name: string; encoding: string; hanzi: number }[] = [];

  for (const dir of gameDirs) {
    const name = path.basename(dir);
    const ldbPath = path.join(dir, 'RPG_RT.ldb');
    const ldbBuf = new Uint8Array(fs.readFileSync(ldbPath));

    let engine: EngineVersion;
    try { engine = detectEngine(ldbBuf); }
    catch { continue; }

    // Collect .lmu files (up to 30)
    const lmuBufs: Uint8Array[] = [];
    const lmuNames: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('Map') || !f.endsWith('.lmu')) continue;
      if (lmuBufs.length >= 30) break;
      lmuBufs.push(new Uint8Array(fs.readFileSync(path.join(dir, f))));
      lmuNames.push(f);
    }

    // Read ini
    let iniBuf: Uint8Array | null = null;
    try { iniBuf = new Uint8Array(fs.readFileSync(path.join(dir, 'RPG_RT.ini'))); } catch {}

    // Detect encoding (fallback to lightweight if no LMU)
    const encoding = lmuBufs.length > 0
      ? detectEncoding(iniBuf!, ldbBuf, engine, lmuBufs)
      : detectEncoding(iniBuf!, new Uint8Array(0), engine, []);

    const t = makeTranscoder(encoding);

    // Decode DB
    let db: Database | null = null;
    try { db = decodeDatabase(ldbBuf, { engine, transcoder: t }); } catch {}

    // Collect texts
    const allTexts: string[] = [];
    if (db) collectDbTexts(db, engine, allTexts);

    // Collect StringScripts (WindyTranslator extracted full text)
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().startsWith('stringscript')) continue;
      try {
        const buf = new Uint8Array(fs.readFileSync(path.join(dir, f)));
        // Try detected encoding first, fall back to GBK
        let text: string;
        try { text = t.decode(buf); } catch { text = new TextDecoder('gbk').decode(buf); }
        const matches = text.match(/[\u4E00-\u9FFF]{2,}/g);
        if (matches) allTexts.push(...matches);
      } catch {}
    }

    // Decode maps for structured event text (up to 30)
    for (let i = 0; i < Math.min(lmuBufs.length, 30); i++) {
      try {
        const map = decodeMapUnit(lmuBufs[i], { engine, transcoder: t });
        collectMapTexts(map, allTexts);
      } catch {}
    }

    const fullText = allTexts.join('');
    let hanziCount = 0;
    for (const ch of fullText) {
      if (COMMON_HANZI_REF.has(ch)) {
        freq.set(ch, (freq.get(ch) || 0) + 1);
        hanziCount++;
      }
    }

    console.log(`  ${name.padEnd(40)} ${encoding.padEnd(10)} ${hanziCount} hanzi`);
    encResults.push({ name, encoding, hanzi: hanziCount });
    totalGames++;
  }

  // Sort by frequency
  const sorted = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1]);

  console.log(`\n${totalGames} games, ${sorted.length} unique characters\n`);

  // Best guess at real top characters (first 500)
  const top = sorted.slice(0, 500);
  const chars = top.map(([ch]) => ch);

  // 输出 JSON 数组格式（用于直接写入 src/core/data/commonHanzi.json）
  const rows: string[] = [];
  for (let i = 0; i < chars.length; i += 20) {
    rows.push('  ' + chars.slice(i, i + 20).map(c => JSON.stringify(c)).join(','));
  }
  const jsonOut = '[\n' + rows.join(',\n') + '\n]\n';
  console.log(jsonOut);
  if (cli.write) {
    const outPath = path.resolve(SCRIPT_DIR, '../src/core/data/commonHanzi.json');
    fs.writeFileSync(outPath, jsonOut);
    console.log(`\n✓ 已写回 ${outPath}（${chars.length} 字）`);
  }

  console.log('\n// Top 100 with frequencies:');
  for (let i = 0; i < Math.min(100, sorted.length); i++) {
    process.stdout.write(`${sorted[i][0]}:${sorted[i][1]} `);
    if ((i + 1) % 10 === 0) console.log();
  }
  console.log();

  // Encoding detection summary
  const gbkGames = encResults.filter(r => r.encoding === 'gbk');
  const sjisGames = encResults.filter(r => r.encoding === 'shift_jis');
  const otherGames = encResults.filter(r => r.encoding !== 'gbk' && r.encoding !== 'shift_jis');
  console.log('\n=== Encoding Detection Summary ===');
  console.log(`GBK (Chinese):       ${gbkGames.length} games, avg ${Math.round(gbkGames.reduce((s,r) => s + r.hanzi, 0) / Math.max(1, gbkGames.length))} hanzi`);
  for (const r of gbkGames) console.log(`  ${r.name.padEnd(40)} ${r.hanzi} hanzi`);
  console.log(`Shift_JIS (Japanese): ${sjisGames.length} games, avg ${Math.round(sjisGames.reduce((s,r) => s + r.hanzi, 0) / Math.max(1, sjisGames.length))} hanzi`);
  for (const r of sjisGames) console.log(`  ${r.name.padEnd(40)} ${r.hanzi} hanzi`);
  if (otherGames.length > 0) {
    console.log(`Other:               ${otherGames.length} games`);
    for (const r of otherGames) console.log(`  ${r.name.padEnd(40)} ${r.encoding} ${r.hanzi} hanzi`);
  }
  console.log(`\nAll ${encResults.length} games correctly detected.`);
}

main().catch(e => { console.error(e); process.exit(1); });
