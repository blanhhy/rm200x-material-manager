// 扫描所有 RM2k/2k3 游戏，用项目真实的 detectEncoding 验证编码识别。
// 打印每个游戏的候选编码得分与 gap，便于回归对比。
//
// 用法：
//   npx tsx scripts/verify-encoding.ts --dir <扫描根目录> [--dir <更多目录>] [--filter 关键词]
//   扫描根目录也可用环境变量 RM_SCAN_ROOTS="dir1;dir2" 提供（见 ./gameScanner.ts）

import * as fs from 'fs';
import * as path from 'path';
import { detectEncoding, detectEngine } from '../src/core/lcfLoader';
import { parseScanArgs, scanGames } from './gameScanner';

function readIfExists(p: string): Uint8Array | null {
  try { return new Uint8Array(fs.readFileSync(p)); } catch { return null; }
}

function loadLmuBufs(dir: string): Uint8Array[] {
  const bufs: Uint8Array[] = [];
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return bufs; }
  for (const n of names) {
    if (!/^Map\d{4}\.lmu$/i.test(n)) continue;
    const b = readIfExists(path.join(dir, n));
    if (b) bufs.push(b);
  }
  return bufs;
}

const cli = parseScanArgs();
const filter = cli.filter?.toLowerCase();
const { games: gameDirs } = scanGames(cli.roots);
const filtered = gameDirs.filter(d => !filter || path.basename(d).toLowerCase().includes(filter));
console.log(`找到 ${filtered.length} 个游戏目录${filter ? `（过滤 "${filter}"）` : ''}\n`);

// 捕获 lcfLoader 内部的 [ENCODE SCORE] 日志以提取每个候选的得分
const origLog = console.log;
type Row = {
  name: string; engine: string; encoding: string;
  scores: Record<string, number>; gap: number; samples: Record<string, string>;
};
const rows: Row[] = [];

for (const dir of filtered) {
  const name = path.basename(dir);
  const ldbBuf = readIfExists(path.join(dir, 'RPG_RT.ldb'));
  if (!ldbBuf) continue;
  const iniBuf = readIfExists(path.join(dir, 'RPG_RT.ini'));
  const lmuBufs = loadLmuBufs(dir);

  const scores: Record<string, number> = {};
  const samples: Record<string, string> = {};
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(' ');
    const m = /\[ENCODE SCORE\] (\S+): (-?[\d.]+)/.exec(line);
    if (m) {
      scores[m[1]] = parseFloat(m[2]);
      const sm = /sample=\[(.*)\]$/.exec(line);
      if (sm) samples[m[1]] = sm[1].slice(0, 60);
    }
  };

  let engine = '2k', encoding = 'ERROR';
  try {
    engine = detectEngine(ldbBuf);
    encoding = detectEncoding(iniBuf, ldbBuf, engine as never, lmuBufs);
  } catch (e) {
    console.log = origLog;
    console.log(`[ERROR] ${name}: ${(e as Error).message}`);
    continue;
  }
  console.log = origLog;

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const gap = sorted.length >= 2 ? sorted[0][1] - sorted[1][1] : Infinity;
  rows.push({ name, engine, encoding, scores, gap, samples });
}

rows.sort((a, b) => a.gap - b.gap);

console.log('gap 从小到大（gap 越小越可疑）：\n');
for (const r of rows) {
  const detail = Object.entries(r.scores)
    .sort((a, b) => b[1] - a[1])
    .map(([e, s]) => `${e}=${s.toFixed(1)}`)
    .join(' ');
  const flag = r.gap < 25 && r.encoding !== 'latin1' ? ' ⚠️' : '';
  console.log(`${r.encoding.padEnd(10)} gap=${r.gap === Infinity ? 'inf' : r.gap.toFixed(1).padStart(6)}${flag}  ${r.engine}  ${r.name}`);
  console.log(`  ${detail}`);
  const best = r.samples[r.encoding];
  if (best) console.log(`  sample: ${best}`);
}

const byEnc = new Map<string, number>();
for (const r of rows) byEnc.set(r.encoding, (byEnc.get(r.encoding) ?? 0) + 1);
console.log(`\n合计 ${rows.length} 个游戏`);
console.log([...byEnc.entries()].map(([e, n]) => `${e}: ${n}`).join('  '));
// latin1 表示纯 ASCII 项目（无多字节文本，编码无关），不算可疑
const risky = rows.filter(r => r.gap < 25 && r.encoding !== 'latin1');
console.log(`gap < 25 的可疑项：${risky.length} 个${risky.length ? ' → ' + risky.map(r => r.name).join(', ') : ''}`);
