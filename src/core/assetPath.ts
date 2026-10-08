import type { AssetCategory, AssetFile } from '../types/index';

/**
 * 素材引用名 → 磁盘文件的路径语义。
 *
 * RM2k/2k3 的引用名通常是"主名"（不含扩展名），运行时会在对应类目目录下查找
 * `<category>/<主名>.<ext>`。但引擎并不禁止引用名里带路径分隔符：`../m` 会被
 * 当作**相对类目目录的路径**交给操作系统解析，于是 `FaceSet/../m` 落到游戏根目录的
 * `m.png`。有一类游戏正是靠这个把一张精心拼合的大图同时当作 FaceSet / CharSet 用。
 *
 * 因此本模块把"引用的身份"统一定义为：
 *   游戏根目录相对路径 + 所属类别
 * 引用侧用 `${category}/${引用名}` 归一化（引用名不含扩展名），
 * 磁盘侧用 `asset.path` 归一化后再按资产自身的 `ext` 去掉扩展名，
 * 两者写法不同但指向同一文件时得到同一个键。
 */

/** 引用名里出现路径分隔符（`/` 或 `\`）时，视为"相对路径引用" */
export function isPathRef(name: string): boolean {
  return /[\\/]/.test(name);
}

/**
 * 归一化 POSIX 风格路径：统一分隔符，折叠 `.` 与 `..`。
 * 允许结果以 `..` 开头（表示越出基准目录）；是否接受越界由调用方决定。
 */
export function normalizePosix(input: string): string {
  const out: string[] = [];
  for (const seg of input.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}

/** 去掉最后一段扩展名（只认文件名里的点） */
export function stripExt(p: string): string {
  const slash = p.lastIndexOf('/');
  const dot = p.lastIndexOf('.');
  return dot > slash ? p.slice(0, dot) : p;
}

/** 目录部分；无目录时返回 '' */
export function posixDir(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash < 0 ? '' : p.slice(0, slash);
}

/** 文件名部分 */
export function posixBase(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash < 0 ? p : p.slice(slash + 1);
}

/** 引用名所在的相对目录（相对类目目录）：`../m` → `..`，`一般1` → `` */
export function refDirOf(assetName: string): string {
  return posixDir(assetName.replace(/\\/g, '/'));
}

/**
 * 引用的规范身份键（assetName 为引用名原文，可含 `../`）。
 *
 * 引用名本身不含扩展名，扩展名是引擎查找时补上的，所以这里**不能**去尾。
 */
export function refAnalysisKey(category: AssetCategory, assetName: string): string {
  return `${category}/${normalizePosix(`${category}/${assetName}`).toLowerCase()}`;
}

/**
 * 磁盘资产的规范身份键（asset.path 为游戏根目录相对路径）。
 *
 * 磁盘路径带真实扩展名，需按资产自身的 `ext` 去掉，才能与引用名对齐。
 * 用 `asset.ext` 而非"按点切"，是为了避免把引用名里的点（如 `シーン1.5`）误当扩展名。
 */
export function diskAssetKey(asset: Pick<AssetFile, 'category' | 'path' | 'ext'>): string {
  const { path, ext } = asset;
  // 虚拟（缺失）资产 ext 为空，此时 path 里保留的正是引用名原文，不去尾
  const rel = ext && path.toLowerCase().endsWith(ext) ? path.slice(0, path.length - ext.length) : path;
  return `${asset.category}/${normalizePosix(rel).toLowerCase()}`;
}

/**
 * 由「相对路径引用名」求出目标文件在游戏根目录下的相对路径（不含扩展名）。
 * 解析基准是类目目录。越出游戏根目录（结果以 `..` 开头）时返回 null——
 * File System Access API 无法向上越界取句柄，这类引用只能保持缺失。
 */
export function resolveRefRelPath(category: AssetCategory, assetName: string): string | null {
  const rel = normalizePosix(`${category}/${assetName}`);
  return rel.startsWith('..') ? null : rel;
}
