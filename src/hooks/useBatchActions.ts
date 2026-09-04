import { useState } from 'react';
import { useStore } from '../store/useStore';
import { scanProjectAssets } from '../scanner/assetScanner';
import { deleteAssets } from '../core/deleteEngine';
import { useRebuildAnalyses } from './useRebuildAnalyses';
import { pendingBlobBuffer } from './pendingBlobs';
import type { BatchAction } from '../components/BatchModal';
import { CATEGORY_EXTS, getPrimaryExt } from '../scanner/assetTypes';
import { lookupRTPFileInfo, resolveRtpDirName, getActiveRtpKind, getActiveRtpDiskHandle, buildRtpNormalizePlan, isRTPAsset } from '../core/rtpIndex';
import { standardizeRtpReferences } from '../core/rtpStandardize';
import { fetchRtpBlob } from '../core/rtpCache';

export function useBatchActions(
  setSelectedKeys: (keys: Set<string>) => void,
) {
  const [batchAction, setBatchAction] = useState<BatchAction | null>(null);
  const gameData = useStore(s => s.gameData);
  const assets = useStore(s => s.assets);
  const analyses = useStore(s => s.analyses);
  const setLoading = useStore(s => s.setLoading);
  const addTask = useStore(s => s.addTask);
  const updateTask = useStore(s => s.updateTask);
  const refreshSnapshots = useStore(s => s.refreshSnapshots);
  const setSelectedAssetKey = useStore(s => s.setSelectedAssetKey);
  const rebuild = useRebuildAnalyses();

  async function handleInjectRtp(cats: string[]) {
    const engine = gameData!.engine;
    const root = gameData!.rootHandle!;
    const catSet = new Set(cats);

    const toInject = Array.from(analyses.values())
      .filter(a => a.inRtp && !a.onDisk && catSet.has(a.asset.category));
    if (toInject.length === 0) { alert('所选类别中没有可注入的 RTP 素材'); return; }

    // Close batch modal immediately, run as background task
    setBatchAction(null);

    const taskId = addTask({
      label: `注入 RTP 素材 (0/${toInject.length})`,
      progress: 0,
      status: 'running',
    });

    let ok = 0;
    const missing: string[] = [];
    const total = toInject.length;

    for (let i = 0; i < toInject.length; i++) {
      const analysis = toInject[i];
      const asset = analysis.asset;
      const dirName = asset.path.split('/')[0];
      let dirHandle: FileSystemDirectoryHandle;
      try { dirHandle = await root.getDirectoryHandle(dirName); }
      catch { try { dirHandle = await root.getDirectoryHandle(dirName, { create: true }); } catch {
        missing.push(`${asset.category}/${asset.name}: 无法创建目录`);
        continue;
      }}

      let blob: Blob | null = null;
      const rtpKind = getActiveRtpKind();

      if (rtpKind === 'builtin') {
        blob = await fetchRtpBlob(asset.name, asset.category, engine);
      } else if (rtpKind === 'disk') {
        const info = lookupRTPFileInfo(asset.name, asset.category, engine);
        if (info) {
          const actualDir = resolveRtpDirName(info.rtpDir);
          if (actualDir) {
            const diskHandle = getActiveRtpDiskHandle();
            if (diskHandle) {
              try {
                const subDir = await diskHandle.getDirectoryHandle(actualDir);
                for (const ext of CATEGORY_EXTS[asset.category]) {
                  try {
                    const fh = await subDir.getFileHandle(info.fileName + ext);
                    blob = await fh.getFile();
                    break;
                  } catch {}
                }
              } catch {}
            }
          }
        }
      }

      if (!blob) {
        missing.push(`${asset.category}/${asset.name}`);
        updateTask(taskId, {
          progress: Math.round(((i + 1) / total) * 100),
          label: `注入 RTP 素材 (${i + 1}/${total})`,
          message: missing.length > 0 ? `${missing.length} 个未找到` : undefined,
        });
        continue;
      }

      try {
        const ext = asset.ext || getPrimaryExt(asset.category);
        const newFileName = asset.stem + ext;
        const fh = await dirHandle.getFileHandle(newFileName, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        ok++;
      } catch (e) {
        missing.push(`${asset.category}/${asset.name}: ${(e as Error).message}`);
      }

      updateTask(taskId, {
        progress: Math.round(((i + 1) / total) * 100),
        label: `注入 RTP 素材 (${i + 1}/${total})`,
        message: missing.length > 0 ? `${missing.length} 个未找到` : undefined,
      });
    }

    // Refresh asset list and analyses
    try {
      const found = await scanProjectAssets(root);
      await rebuild(gameData!, found);
    } catch (e) {
      updateTask(taskId, {
        status: 'error',
        label: `RTP 注入失败`,
        message: (e as Error).message,
        progress: 100,
      });
      return;
    }

    const msg = `已注入 ${ok}/${total} 个素材${missing.length > 0 ? `，${missing.length} 个未找到` : ''}`;
    updateTask(taskId, {
      status: missing.length > 0 ? 'error' : 'success',
      label: msg,
      progress: 100,
      message: missing.length > 0 ? missing.slice(0, 5).join(', ') + (missing.length > 5 ? `...等 ${missing.length} 个` : '') : undefined,
    });
  }

  async function handlePruneRtp(cats: string[]) {
    const catSet = new Set(cats);
    const engine = gameData!.engine;
    const toDelete = Array.from(analyses.values())
      .filter(a => a.onDisk && catSet.has(a.asset.category) && a.references.some(r => isRTPAsset(r.assetName, r.category, engine)))
      .map(a => a.asset);
    if (toDelete.length === 0) { alert('所选类别中没有可精简的 RTP 素材'); return; }

    setLoading(true);
    try {
      const result = await deleteAssets(gameData!, toDelete, false);
      if (result.deletedBlobs) {
        for (const [k, v] of result.deletedBlobs) pendingBlobBuffer.current.set(k, v);
      }
      const deletedSet = new Set(result.filesDeleted);
      const newAssets = assets.filter(a => !deletedSet.has(a.path));
      const diskOnly = newAssets.filter(a => a.handle !== undefined);
      await rebuild(gameData!, diskOnly);
      setSelectedKeys(new Set());
      setSelectedAssetKey(null);
      await refreshSnapshots(gameData!.rootHandle);
      setBatchAction(null);
      alert(`已精简 ${result.filesDeleted.length}/${toDelete.length} 个 RTP 素材`);
    } catch (e) {
      alert('精简失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCleanUnused(cats: string[]) {
    const catSet = new Set(cats);
    const toDelete = Array.from(analyses.values())
      .filter(a => a.onDisk && !a.inDatabase && catSet.has(a.asset.category))
      .map(a => a.asset);
    if (toDelete.length === 0) { alert('所选类别中没有可清理的无用素材'); return; }

    setLoading(true);
    try {
      const result = await deleteAssets(gameData!, toDelete, false);
      if (result.deletedBlobs) {
        for (const [k, v] of result.deletedBlobs) pendingBlobBuffer.current.set(k, v);
      }
      const deletedSet = new Set(result.filesDeleted);
      const newAssets = assets.filter(a => !deletedSet.has(a.path));
      const diskOnly = newAssets.filter(a => a.handle !== undefined);
      await rebuild(gameData!, diskOnly);
      setSelectedKeys(new Set());
      setSelectedAssetKey(null);
      await refreshSnapshots(gameData!.rootHandle);
      setBatchAction(null);
      alert(`已删除 ${result.filesDeleted.length}/${toDelete.length} 个无用素材`);
    } catch (e) {
      alert('清理失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleClearMissing(cats: string[]) {
    const catSet = new Set(cats);
    const toClear = Array.from(analyses.values())
      .filter(a => !a.onDisk && a.inDatabase && !a.inRtp && catSet.has(a.asset.category))
      .map(a => a.asset);
    if (toClear.length === 0) { alert('所选类别中没有可清除的无效引用'); return; }

    setLoading(true);
    try {
      const result = await deleteAssets(gameData!, toClear, true);
      if (result.deletedBlobs) {
        for (const [k, v] of result.deletedBlobs) pendingBlobBuffer.current.set(k, v);
      }
      const newAssets = assets.filter(a => !result.filesDeleted.includes(a.path));
      const diskOnly = newAssets.filter(a => a.handle !== undefined);
      await rebuild(gameData!, diskOnly);
      setSelectedKeys(new Set());
      setSelectedAssetKey(null);
      await refreshSnapshots(gameData!.rootHandle);
      setBatchAction(null);
      alert(`已清除 ${toClear.length} 个无效引用`);
    } catch (e) {
      alert('清除失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleNormalizeRtp(cats: string[]) {
    const catSet = new Set(cats);
    const plan = buildRtpNormalizePlan(
      Array.from(analyses.values()).flatMap(a => a.references),
      gameData!.engine,
    ).filter(i => catSet.has(i.category));
    if (plan.length === 0) { alert('所选类别中没有需要标准化的 RTP 引用'); return; }

    setBatchAction(null);
    setLoading(true);
    try {
      const result = await standardizeRtpReferences(gameData!, plan, assets);
      // 重扫磁盘 + 重建引用分析（文件名已变，需重取 handle）
      const found = await scanProjectAssets(gameData!.rootHandle!);
      await rebuild(gameData!, found);
      setSelectedKeys(new Set());
      setSelectedAssetKey(null);
      await refreshSnapshots(gameData!.rootHandle);
      if (result.skipped.length > 0) console.warn('[RTP-STD] 跳过的项：', result.skipped);
      alert(result.message);
    } catch (e) {
      alert('RTP 标准化失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchConfirm(cats: string[]) {
    if (batchAction === 'injectRtp') await handleInjectRtp(cats);
    else if (batchAction === 'pruneRtp') await handlePruneRtp(cats);
    else if (batchAction === 'cleanUnused') await handleCleanUnused(cats);
    else if (batchAction === 'clearMissing') await handleClearMissing(cats);
    else if (batchAction === 'normalizeRtp') await handleNormalizeRtp(cats);
  }

  return { batchAction, setBatchAction, handleBatchConfirm };
}
