import { DIR_TO_CATEGORY, CATEGORY_EXTS } from './assetTypes';
import type { AssetCategory, AssetFile } from '../types/index';

export async function scanProjectAssets(root: FileSystemDirectoryHandle): Promise<AssetFile[]> {
  const dirHandles = new Map<string, FileSystemDirectoryHandle>();
  for await (const entry of root.values()) {
    if (entry.kind === 'directory') {
      dirHandles.set(entry.name.toLowerCase(), entry as FileSystemDirectoryHandle);
    }
  }

  // 先收集所有 (category, fileHandle)，再并行 getFile
  type Collected = { dir: string; category: AssetCategory; fileHandle: FileSystemFileHandle; name: string; ext: string; stem: string };
  const collected: Collected[] = [];

  for (const [dirNameLower, category] of Object.entries(DIR_TO_CATEGORY)) {
    const dirHandle = dirHandles.get(dirNameLower);
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

  // 并行获取文件大小
  const assets: AssetFile[] = [];
  const BATCH = 32;
  for (let i = 0; i < collected.length; i += BATCH) {
    const batch = collected.slice(i, i + BATCH);
    const infos = await Promise.all(batch.map(c =>
      c.fileHandle.getFile().then(f => ({ c, size: f.size }))
    ));
    for (const { c, size } of infos) {
      assets.push({
        name: c.name,
        stem: c.stem,
        category: c.category,
        path: `${c.dir}/${c.name}`,
        size,
        ext: c.ext,
        handle: c.fileHandle,
      });
    }
  }

  return assets;
}

export function findAssetByName(assets: AssetFile[], stem: string, category?: AssetCategory): AssetFile | undefined {
  return assets.find(a => a.stem.toLowerCase() === stem.toLowerCase() && (category === undefined || a.category === category));
}
