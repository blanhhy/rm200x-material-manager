// 游戏目录扫描共享工具：把 verify-encoding / scan-game-hanzi / dump-enc-texts / analyze-gap
// 共用的"扫 RM2k/2k3 游戏目录"逻辑收拢到这里。
//
// 扫描根目录通过 CLI 参数或环境变量提供，不硬编码任何本机磁盘路径，
// 因此脚本可以提交到远端供他人复用（例如在 CI 或别人的机器上重生成数据）。
//
// 用法（任选其一或组合）：
//   npx tsx scripts/xxx.ts --dir D:/Games --dir D:/RPG
//   npx tsx scripts/xxx.ts --dir D:/Games --filter "Project2"
//   $env:RM_SCAN_ROOTS="D:/Games;D:/RPG"  ;  npx tsx scripts/xxx.ts

import * as fs from 'fs';
import * as path from 'path';

const SCAN_DEPTH = 4;

export interface ScanOptions {
  roots: string[];
  filter?: string;
  write?: boolean;
}

/** 解析 CLI 参数：--dir/-d（可重复）、--dir=X、--filter、--write、位置参数（兼容旧用法，作为 filter） */
export function parseScanArgs(argv: string[] = process.argv.slice(2)): ScanOptions {
  const options: ScanOptions = { roots: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' || a === '-d') {
      const v = argv[++i];
      if (v) options.roots.push(v);
    } else if (a.startsWith('--dir=')) {
      options.roots.push(a.slice('--dir='.length));
    } else if (a === '--filter') {
      options.filter = argv[++i];
    } else if (a.startsWith('--filter=')) {
      options.filter = a.slice('--filter='.length);
    } else if (a === '--write') {
      options.write = true;
    } else if (!a.startsWith('-') && !options.filter) {
      options.filter = a; // 位置参数按关键字过滤
    }
  }
  return options;
}

/** 合并 CLI 传入的根目录与环境变量 RM_SCAN_ROOTS（分号或逗号分隔） */
export function resolveScanRoots(cliRoots: string[]): string[] {
  const roots = new Set<string>();
  for (const r of cliRoots) if (r) roots.add(r);
  const env = process.env.RM_SCAN_ROOTS ?? '';
  for (const r of env.split(/[;,]/)) {
    const t = r.trim();
    if (t) roots.add(t);
  }
  return [...roots];
}

function walk(current: string, results: string[], depth: number) {
  if (depth <= 0) return;
  if (fs.existsSync(path.join(current, 'RPG_RT.ldb'))) {
    results.push(current);
    return;
  }
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
    walk(path.join(current, e.name), results, depth - 1);
  }
}

/** 在多个根目录下递归查找包含 RPG_RT.ldb 的游戏目录 */
export function findGameDirs(roots: string[]): string[] {
  const dirs: string[] = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    walk(r, dirs, SCAN_DEPTH);
  }
  return dirs;
}

/** 一键扫描：roots 为空时打印用法并返回空列表 */
export function scanGames(cliRoots: string[]): { games: string[]; roots: string[] } {
  const roots = resolveScanRoots(cliRoots);
  if (roots.length === 0) {
    console.log('[gameScanner] 未提供扫描根目录。');
    console.log('[gameScanner]   用法: --dir <目录>（可重复指定多个）');
    console.log('[gameScanner]   环境变量: RM_SCAN_ROOTS="dir1;dir2"');
    console.log('[gameScanner]   示例: npx tsx scripts/scan-game-hanzi.ts --dir D:/Games --dir D:/RPG');
    return { games: [], roots };
  }
  const games = findGameDirs(roots);
  return { games, roots };
}