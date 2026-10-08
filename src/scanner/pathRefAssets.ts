import type { AssetFile, AssetReference } from '../types/index';
import { CATEGORY_EXTS } from './assetTypes';
import { parsePNG } from '../preview/pngPalette';
import { isPathRef, posixBase, posixDir, resolveRefRelPath, stripExt } from '../core/assetPath';

/** 相对路径引用解析出的资产及其目标路径 */
interface PathRefTarget {
  category: AssetReference['category'];
  /** 游戏根目录相对路径（不含扩展名） */
  relPath: string;
  /** 引用名原文，如 `../m` */
  refName: string;
}

/**
 * 把「相对路径型引用」解析成真实磁盘资产。
 *
 * 引用名带 `/`（如 `../m`）时，引擎会按**相对类目目录**的路径去查文件，
 * 于是目标可能落在标准素材目录之外（游戏根目录、乃至子目录）。
 * 这里逐个候选扩展名尝试取句柄，取到即生成一个带 handle 的 AssetFile，
 * 使该引用不再被判为"缺失"、可直接预览/改名/删除。
 *
 * 越出游戏根目录（`../../…`）的引用无法用 File System Access API 触达，跳过。
 */
export async function resolvePathRefAssets(
  root: FileSystemDirectoryHandle,
  refs: AssetReference[],
): Promise<AssetFile[]> {
  const wanted = new Map<string, PathRefTarget>();
  for (const r of refs) {
    if (!isPathRef(r.assetName)) continue;
    if (!CATEGORY_EXTS[r.category]) continue;
    const relPath = resolveRefRelPath(r.category, r.assetName);
    if (!relPath) continue;
    const key = `${r.category}\u0000${relPath.toLowerCase()}`;
    if (!wanted.has(key)) wanted.set(key, { category: r.category, relPath, refName: r.assetName });
  }

  const out: AssetFile[] = [];
  for (const target of wanted.values()) {
    const dirRel = posixDir(target.relPath);
    const base = posixBase(target.relPath);
    try {
      let dirHandle = root;
      for (const seg of dirRel.split('/')) {
        if (!seg) continue;
        dirHandle = await dirHandle.getDirectoryHandle(seg);
      }
      for (const ext of CATEGORY_EXTS[target.category]) {
        try {
          const fh = await dirHandle.getFileHandle(base + ext);
          const f = await fh.getFile();
          const asset: AssetFile = {
            name: base + ext,
            stem: stripExt(base + ext),
            category: target.category,
            path: dirRel ? `${dirRel}/${base}${ext}` : `${base}${ext}`,
            size: f.size,
            ext,
            handle: fh,
            refName: target.refName,
          };
          if (ext === '.png') {
            try {
              const { ihdr } = parsePNG(new Uint8Array(await f.arrayBuffer()));
              if (ihdr) { asset.width = ihdr.width; asset.height = ihdr.height; }
            } catch { /* 解析失败不影响资产本身 */ }
          }
          out.push(asset);
          break;
        } catch { /* 该扩展名不存在，试下一个 */ }
      }
    } catch { /* 目录不存在 → 该引用保持缺失 */ }
  }
  return out;
}
