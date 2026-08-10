import { useState } from 'react';
import { useStore } from '../store/useStore';
import { deleteAssets } from '../core/deleteEngine';
import { useRebuildAnalyses } from './useRebuildAnalyses';
import { pendingBlobBuffer } from './pendingBlobs';

export function useDeleteAsset(
  selectedKeys: Set<string>,
  setSelectedKeys: (keys: Set<string>) => void,
) {
  const [deleting, setDeleting] = useState(false);
  const gameData = useStore(s => s.gameData);
  const assets = useStore(s => s.assets);
  const analyses = useStore(s => s.analyses);
  const setLoading = useStore(s => s.setLoading);
  const refreshSnapshots = useStore(s => s.refreshSnapshots);
  const setSelectedAssetKey = useStore(s => s.setSelectedAssetKey);
  const rebuild = useRebuildAnalyses();

  async function handleDeleteSelected() {
    if (!gameData || selectedKeys.size === 0) return;

    const toDelete = Array.from(selectedKeys).map(k => analyses.get(k)?.asset).filter(Boolean) as typeof assets;
    if (toDelete.length === 0) return;

    const missingOnes = toDelete.filter(a => a.handle === undefined);
    const diskOnes = toDelete.filter(a => a.handle !== undefined);

    let msg = `确定删除选中的 ${toDelete.length} 个素材？`;
    if (diskOnes.length > 0) msg += `\n· ${diskOnes.length} 个磁盘文件将被永久删除`;
    if (missingOnes.length > 0) msg += `\n· ${missingOnes.length} 个缺失素材的引用将被清除`;
    msg += `\n\n操作前会自动创建快照。`;
    const ok = confirm(msg);
    if (!ok) return;

    setDeleting(true);
    setLoading(true);
    try {
      const needClearRefs = missingOnes.length > 0;
      const result = await deleteAssets(gameData, toDelete, needClearRefs);
      if (!result.success && !result.filesDeleted.length && result.filesWritten.length === 0) {
        alert('删除失败：' + result.message);
        return;
      }

      if (result.deletedBlobs) {
        for (const [k, v] of result.deletedBlobs) pendingBlobBuffer.current.set(k, v);
      }

      console.time('[DELETE] aftermath');

      const deletedSet = new Set(result.filesDeleted);
      const newAssets = assets.filter(a => !deletedSet.has(a.path));

      const diskOnly = newAssets.filter(a => a.handle !== undefined);
      await rebuild(gameData, diskOnly);

      setSelectedKeys(new Set());
      setSelectedAssetKey(null);

      console.log(`[DELETE] ${result.message}`);
      await refreshSnapshots(gameData.rootHandle);
      console.timeEnd('[DELETE] aftermath');

      if (!result.success) {
        alert(`部分删除成功：${result.message}`);
      }
    } catch (e) {
      console.error('[DELETE FAILED]', e);
      alert('删除出错：' + (e as Error).message);
    } finally {
      setDeleting(false);
      setLoading(false);
    }
  }

  return { deleting, handleDeleteSelected };
}
