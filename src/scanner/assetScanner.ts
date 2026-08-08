import { DIR_TO_CATEGORY, CATEGORY_EXTS } from './assetTypes';
import type { AssetCategory, AssetFile } from '../types/index';
import { parsePNG } from '../preview/pngPalette';

const IMAGE_EXTS = new Set(['.png']);

// 模块级 Map：scanner 把预读数据存这里，绕过 React/Zustand 的序列化截断
// 存 Blob 而不是 ArrayBuffer/Uint8Array——Blob 是浏览器原生二进制封装，
// V8 不会 detach 它的内存，跨任何函数调用都保持完整数据
export const prefetchedFileData = new Map<string, Blob>();

export async function scanProjectAssets(root: FileSystemDirectoryHandle): Promise<AssetFile[]> {
  prefetchedFileData.clear();

  type Collected = { dir: string; category: AssetCategory; fileHandle: FileSystemFileHandle; name: string; ext: string; stem: string };
  const collected: Collected[] = [];

  for (const [dirNameLower, category] of Object.entries(DIR_TO_CATEGORY)) {
    const dirHandle = await root.getDirectoryHandle(dirNameLower).catch(() => null);
    if (!dirHandle) continue;
    for await (const entry of dirHandle.values()) {
      if (entry.kind !== 'file') continue;
      const fileHandle = entry as FileSystemFileHandle;
      const name = fileHandle.name;
      const dot = name.lastIndexOf('.');
      if (dot < 0) continue;
      const ext = name.slice(dot).toLowerCase();
      if (!CATEGORY_EXTS[category].includes(ext)) continue;
      collected.push({
        dir: dirNameLower,
        category,
        fileHandle,
        name,
        stem: name.slice(0, dot),
        ext,
      });
    }
  }

  const assets: AssetFile[] = [];
  const BATCH = 16;
  for (let i = 0; i < collected.length; i += BATCH) {
    const batch = collected.slice(i, i + BATCH);
    const infos = await Promise.all(batch.map(async c => {
      const f = await c.fileHandle.getFile();
      const buf = await f.arrayBuffer();
      return { c, size: f.size, buf };
    }));
    for (const { c, size, buf } of infos) {
      prefetchedFileData.set(`${c.dir}/${c.name}`, new Blob([buf]));
      const asset: AssetFile = {
        name: c.name,
        stem: c.stem,
        category: c.category,
        path: `${c.dir}/${c.name}`,
        size,
        ext: c.ext,
        handle: c.fileHandle,
      };
      if (IMAGE_EXTS.has(c.ext)) {
        const { ihdr } = parsePNG(new Uint8Array(buf));
        if (ihdr) { asset.width = ihdr.width; asset.height = ihdr.height; }
      }
      assets.push(asset);
    }
  }

  return assets;
}

export function findAssetByName(assets: AssetFile[], stem: string, category?: AssetCategory): AssetFile | undefined {
  return assets.find(a => a.stem.toLowerCase() === stem.toLowerCase() && (category === undefined || a.category === category));
}
