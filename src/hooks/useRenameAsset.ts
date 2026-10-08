import { useState } from 'react';
import { useStore } from '../store/useStore';
import { renameAsset } from '../core/renameEngine';
import { scanProjectAssets } from '../scanner/assetScanner';
import { useRebuildAnalyses } from './useRebuildAnalyses';
import { diskAssetKey } from '../core/assetPath';
import type { AssetAnalysis } from '../types/index';

export function useRenameAsset() {
  const [renaming, setRenaming] = useState(false);
  const gameData = useStore(s => s.gameData);
  const assets = useStore(s => s.assets);
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

      // 磁盘文件名已变，重新扫描取新句柄后重建分析（与批量改名的 runRenamePlan 一致）
      const found = await scanProjectAssets(gameData.rootHandle!);
      await rebuild(gameData, found);

      // 选中新 key
      setSelectedAssetKey(diskAssetKey({
        category: oldAsset.category,
        path: oldAsset.path.replace(/[^/]+$/, newStem + oldAsset.ext),
        ext: oldAsset.ext,
      }));
    } catch (e) {
      alert('重命名出错：' + (e as Error).message);
    } finally {
      setRenaming(false);
    }
  }

  return { renaming, handleRename };
}
