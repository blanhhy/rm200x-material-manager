import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { restoreSnapshot, deleteSnapshot } from '../core/snapshot';
import type { SnapshotInfo } from '../core/snapshot';
import { reDecodeWithEncoding } from '../core/lcfLoader';
import { scanProjectAssets } from '../scanner/assetScanner';
import { traceAllReferences } from '../core/referenceTracker';
import { buildAnalyses } from '../core/assetAnalyzer';
import { DB_FILE_EXTS } from '../scanner/assetTypes';
import type { AssetReference } from '../types/index';
import { useClickOutside } from './useClickOutside';
import { pendingBlobBuffer } from './pendingBlobs';

export function useSnapshotManager() {
  const [snapMenuOpen, setSnapMenuOpen] = useState(false);
  const [loadingHint, setLoadingHint] = useState<string | null>(null);
  const snapMenuRef = useClickOutside(() => setSnapMenuOpen(false));

  const gameData = useStore(s => s.gameData);
  const setGameData = useStore(s => s.setGameData);
  const setLoading = useStore(s => s.setLoading);
  const analyses = useStore(s => s.analyses);
  const setAssets = useStore(s => s.setAssets);
  const setAnalyses = useStore(s => s.setAnalyses);
  const setSelectedAssetKey = useStore(s => s.setSelectedAssetKey);
  const refreshSnapshots = useStore(s => s.refreshSnapshots);

  // 每次分析变化后刷新快照列表
  useEffect(() => {
    if (gameData?.rootHandle) refreshSnapshots(gameData.rootHandle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameData?.rootHandle, analyses]);

  async function handleRestoreSnapshot(snap: SnapshotInfo) {
    if (!gameData?.rootHandle) return;
    const ok = confirm(`恢复此快照？\n\n${snap.label || snap.dirName}\n\n涉及 ${snap.files.length + (snap.deletedFiles?.length ?? 0)} 个文件，恢复后当前磁盘上的修改将被覆盖。`);
    if (!ok) return;

    const hasDbChange = snap.files.some(f => DB_FILE_EXTS.some(ext => f.endsWith(ext)));
    setLoading(true);
    setLoadingHint(hasDbChange ? '正在恢复快照并重解码项目数据...' : '正在恢复快照并刷新素材索引...');
    try {
      const success = await restoreSnapshot(gameData.rootHandle, snap, pendingBlobBuffer.current);
      if (!success) throw new Error('快照目录损坏或已删除');

      for (const rel of snap.files) pendingBlobBuffer.current.delete(rel);
      for (const rel of snap.deletedFiles ?? []) pendingBlobBuffer.current.delete(rel);

      const newData = hasDbChange
        ? await reDecodeWithEncoding(gameData, gameData.encoding)
        : gameData;

      const found = await scanProjectAssets(gameData.rootHandle);
      let refs: AssetReference[];
      if (hasDbChange) {
        refs = traceAllReferences(newData);
      } else {
        refs = Array.from(analyses.values()).flatMap(e => e.references);
      }
      const { allAssets, analyses: map } = buildAnalyses(found, refs, newData.engine);
      setGameData(newData);
      setAssets(allAssets);
      setAnalyses(map);
      setSelectedAssetKey(null);

      console.log(`[SNAPSHOT RESTORE] ← ${snap.dirName}, assets=${found.length}${hasDbChange ? ', reDecoded + traced' : ', reuse refs, skip reDecode + trace'}`);
      await refreshSnapshots(gameData.rootHandle);
    } catch (e) {
      console.error('[SNAPSHOT RESTORE FAILED]', e);
      alert('恢复出错：' + (e as Error).message);
    } finally {
      setLoading(false);
      setLoadingHint(null);
      setSnapMenuOpen(false);
    }
  }

  async function handleDeleteSnapshot(snap: SnapshotInfo, e: React.MouseEvent) {
    e.stopPropagation();
    if (!gameData) return;
    const ok = confirm(`删除此快照？\n\n${snap.label || snap.dirName}\n\n快照删除后无法恢复。`);
    if (!ok) return;
    const success = await deleteSnapshot(gameData.rootHandle, snap);
    if (success) {
      await refreshSnapshots(gameData.rootHandle);
    } else {
      alert('删除快照失败');
    }
  }

  return {
    snapMenuOpen, setSnapMenuOpen,
    snapMenuRef,
    loadingHint,
    handleRestoreSnapshot,
    handleDeleteSnapshot,
  };
}
