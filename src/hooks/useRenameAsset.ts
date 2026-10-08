import { useState } from 'react';
import { useStore } from '../store/useStore';
import { renameAsset } from '../core/renameEngine';
import { useRebuildAnalyses } from './useRebuildAnalyses';
import { diskAssetKey } from '../core/assetPath';
import { dirRelOf, getDirHandleByRelPath } from '../core/internal/fsPath';
import type { AssetAnalysis, AssetFile } from '../types/index';

export function useRenameAsset() {
  const [renaming, setRenaming] = useState(false);
  const gameData = useStore(s => s.gameData);
  const assets = useStore(s => s.assets);
  const setAssets = useStore(s => s.setAssets);
  const setSelectedAssetKey = useStore(s => s.setSelectedAssetKey);
  const rebuild = useRebuildAnalyses();

  async function handleRename(newStem: string, selectedAnalysis: AssetAnalysis) {
    if (!gameData) return;
    setRenaming(true);
    try {
      const oldAsset = selectedAnalysis.asset;
      // 同一物理文件可能被多个类别引用（各自一条记录），一并改写才能不留断引用
      const siblings = assets.filter(a => a !== oldAsset && a.path === oldAsset.path && a.handle !== undefined);
      const result = await renameAsset(gameData, oldAsset, newStem, siblings);
      if (!result.success) {
        alert('重命名失败：' + result.message);
        return;
      }

      // 更新 assets 里对应的条目（需要拿到 move 后的新 FileHandle）
      const newFileName = newStem + oldAsset.ext;
      const newPath = oldAsset.path.replace(/[^/]+$/, newFileName);
      let newHandle = oldAsset.handle;
      try {
        const dirHandle = await getDirHandleByRelPath(gameData.rootHandle!, dirRelOf(oldAsset.path));
        newHandle = await dirHandle.getFileHandle(newFileName);
      } catch (e) {
        console.warn('重命名后无法重新打开文件句柄：', e);
      }
      let newAsset: AssetFile = oldAsset;
      const newAssets = assets.map(a => {
        if (a.name !== oldAsset.name || a.path !== oldAsset.path) return a;
        const next: AssetFile = {
          ...a,
          name: newFileName,
          stem: newStem,
          path: newPath,
          handle: newHandle,
          refName: a.refName ? a.refName.replace(/[^/\\]+$/, newStem) : undefined,
        };
        if (a === oldAsset) newAsset = next;
        return next;
      });
      setAssets(newAssets);

      // 重跑引用分析
      const diskOnly = newAssets.filter(a => a.handle !== undefined);
      await rebuild(gameData, diskOnly);

      // 选中新 key
      setSelectedAssetKey(diskAssetKey(newAsset));
    } catch (e) {
      alert('重命名出错：' + (e as Error).message);
    } finally {
      setRenaming(false);
    }
  }

  return { renaming, handleRename };
}
