import { useState } from 'react';
import { useStore } from '../store/useStore';
import { renameAsset } from '../core/renameEngine';
import { useRebuildAnalyses } from './useRebuildAnalyses';
import type { AssetAnalysis } from '../types/index';

function assetKey(cat: string, stem: string): string {
  return `${cat}/${stem.toLowerCase()}`;
}

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
      const result = await renameAsset(gameData, selectedAnalysis.asset, newStem);
      if (!result.success) {
        alert('重命名失败：' + result.message);
        return;
      }

      // 更新 assets 里对应的条目（需要拿到 move 后的新 FileHandle）
      const oldAsset = selectedAnalysis.asset;
      const newFileName = newStem + oldAsset.ext;
      let newHandle = oldAsset.handle;
      try {
        const dirName = oldAsset.path.split('/')[0];
        const dirHandle = await gameData.rootHandle!.getDirectoryHandle(dirName);
        newHandle = await dirHandle.getFileHandle(newFileName);
      } catch (e) {
        console.warn('重命名后无法重新打开文件句柄：', e);
      }
      const newAsset = {
        ...oldAsset,
        name: newFileName,
        stem: newStem,
        path: oldAsset.path.replace(/[^/]+$/, newFileName),
        handle: newHandle,
      };
      const newAssets = assets.map(a =>
        a.name === oldAsset.name && a.path === oldAsset.path ? newAsset : a,
      );
      setAssets(newAssets);

      // 重跑引用分析
      const diskOnly = newAssets.filter(a => a.handle !== undefined);
      await rebuild(gameData, diskOnly);

      // 选中新 key
      setSelectedAssetKey(assetKey(newAsset.category, newAsset.stem));
    } catch (e) {
      alert('重命名出错：' + (e as Error).message);
    } finally {
      setRenaming(false);
    }
  }

  return { renaming, handleRename };
}
