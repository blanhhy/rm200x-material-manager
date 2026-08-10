import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './store/useStore';
import { loadGameProject, reDecodeWithEncoding } from './core/lcfLoader';
import { scanProjectAssets } from './scanner/assetScanner';
import { traceAllReferences } from './core/referenceTracker';
import { buildAnalyses } from './core/assetAnalyzer';
import { renameAsset } from './core/renameEngine';
import { deleteAssets } from './core/deleteEngine';
import { restoreSnapshot, deleteSnapshot } from './core/snapshot';
import type { SnapshotInfo } from './core/snapshot';
import AssetPreview from './components/AssetPreview';
import AssetDetail from './components/AssetDetail';
import VirtualGrid from './components/VirtualGrid';
import WorkspaceSelector from './components/WorkspaceSelector';
import RtpSelector from './components/RtpSelector';
import BatchModal from './components/BatchModal';
import type { BatchAction } from './components/BatchModal';
import QuickActions from './components/QuickActions';
import FilterDropdown from './components/FilterDropdown';
import TaskPanel from './components/TaskPanel';
import type { AssetReference } from './types/index';
import { initBuiltinRtp, getRtpBundleUrl, lookupRTPFileInfo, resolveRtpDirName, getActiveRtpKind, getActiveRtpDiskHandle } from './core/rtpIndex';
import { CATEGORY_EXTS, getPrimaryExt, getCategories, DB_FILE_EXTS } from './scanner/assetTypes';

function assetKey(cat: string, stem: string): string {
  return `${cat}/${stem.toLowerCase()}`;
}

const batchBtnStyle: React.CSSProperties = {
  padding: '4px 10px', fontSize: 12, borderRadius: 4,
  border: '1px solid var(--color-border)', background: 'var(--color-bg-elev)', color: 'var(--color-text)',
  cursor: 'pointer',
};

type Theme = 'dark' | 'light';
const _savedTheme = (typeof localStorage !== 'undefined' ? localStorage.getItem('rmm-theme') : null) as Theme | null;
const initialTheme: Theme = _savedTheme ?? 'dark';

export default function App() {
  const {
    gameData, setGameData,
    assets, setAssets,
    analyses, setAnalyses,
    activeCategory, setActiveCategory,
    filterUsed, setFilterUsed,
    selectedAssetKey, setSelectedAssetKey,
    loading, setLoading,
    setError,
    tasks, clearCompletedTasks, addTask, updateTask,
    snapshots, refreshSnapshots,
    setActiveRtpSourceId,
  } = useStore();

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollContainerRef.current?.scrollTo(0, 0);
  }, [activeCategory, filterUsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) && gameData) {
        e.preventDefault();
        handleRefreshProject();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameData]);

  async function loadFromRoot(root: FileSystemDirectoryHandle, opts?: { keepState?: boolean; encoding?: string }) {
    const { keepState = false, encoding } = opts ?? {};
    try {
      setError(null);

      if (!keepState) {
        setSelectedAssetKey(null);
        setAssets([]);
        setAnalyses(new Map());
        setFilterUsed('disk');
        setGameData(null);
      }
      setLoading(true);

      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 16)));

      let data = await loadGameProject(root);
      if (encoding && encoding !== data.encoding) {
        data = await reDecodeWithEncoding(data, encoding);
      }
      setGameData(data);

      // Initialize built-in RTP for this engine
      initBuiltinRtp(data.engine);
      setActiveRtpSourceId('builtin');

      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 16)));

      const t0 = performance.now();
      const found = await scanProjectAssets(root);
      console.log(`[性能] scanProjectAssets: ${(performance.now() - t0).toFixed(0)}ms · ${found.length} files`);
      setAssets(found);

      const stems = new Set<string>();
      for (const a of found) stems.add(a.stem.toLowerCase());

      const t1 = performance.now();
      const refs = traceAllReferences(data);
      console.log(`[性能] traceAllReferences: ${(performance.now() - t1).toFixed(0)}ms · ${refs.length} refs`);

      const { allAssets, analyses: map } = buildAnalyses(found, refs, data.engine);
      setAssets(allAssets);
      setAnalyses(map);

      console.group('[诊断] 项目加载');
      console.log('编码:', data.encoding, '引擎:', data.engine, '素材:', found.length, '引用:', refs.length);
      if (data.database) {
        const sampleChars = data.database.actors?.slice(0, 5).map(a => ({ id: a.id, characterName: a.characterName, faceName: a.faceName, matchDisk: stems.has(a.characterName?.toLowerCase() ?? '') }));
        console.log('Actress 样本:', sampleChars);
      }
      const missingCount = Array.from(map.values()).filter(e => !e.onDisk).length;
      const unusedCount = Array.from(map.values()).filter(e => e.onDisk && !e.inDatabase).length;
      console.log(`磁盘=${found.length} 引用=${refs.length} 缺失=${missingCount} 未使用=${unusedCount}`);
      if (missingCount > 0) {
        console.groupCollapsed(`${missingCount} 个缺失素材`);
        for (const e of Array.from(map.values()).filter(e => !e.onDisk).slice(0, 20)) {
          console.log(`  [${e.asset.category}] "${e.asset.stem}" refs=${e.references.length}`);
        }
        console.groupEnd();
      }
      console.groupEnd();
      // TEMP: dump analyses for diagnosis
      (window as any).__DIAG_ANALYSES = Array.from(map.values()).map(e => ({
        cat: e.asset.category,
        name: e.asset.stem,
        onDisk: e.onDisk,
        inRtp: e.inRtp,
        refs: e.references.length,
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenProject() {
    try {
      const root = await window.showDirectoryPicker({ mode: 'readwrite' });
      await loadFromRoot(root);
    } catch (e) {
      if ((e as Error).message?.includes('The user aborted')) return;
      setError((e as Error).message);
    }
  }

  async function handleRefreshProject() {
    if (!gameData?.rootHandle) return;
    await loadFromRoot(gameData.rootHandle, { keepState: true, encoding: gameData.encoding });
  }

  function handleCloseProject() {
    setGameData(null);
    setAssets([]);
    setAnalyses(new Map());
    setSelectedAssetKey(null);
    setFilterUsed('disk');
  }

  async function handleEncodingChange(enc: string) {
    if (!gameData) return;
    setLoading(true);
    try {
      // 重新 decode DB + maps
      const newData = await reDecodeWithEncoding(gameData, enc);
      setGameData(newData);

      // 重跑引用追踪
      const refs = traceAllReferences(newData);
      const diskOnly = assets.filter(a => a.handle !== undefined);
      const { allAssets, analyses: map } = buildAnalyses(diskOnly, refs, newData.engine);
      setAssets(allAssets);
      setAnalyses(map);

      console.log(`[ENCODE SWITCH] → ${enc}, refs=${refs.length}`);
    } catch (e) {
      console.error('reDecode failed:', e);
    } finally {
      setLoading(false);
    }
  }

  const filteredAssets = useMemo(() => assets.filter(a => {
    if (a.category !== activeCategory) return false;
    const entry = analyses.get(`${a.category}/${a.stem.toLowerCase()}`);
    if (!entry) return filterUsed === 'all';
    const onDisk = entry.onDisk;
    const inDb = entry.inDatabase;
    switch (filterUsed) {
      case 'disk':    return onDisk;
      case 'refs':    return inDb;
      case 'used':    return onDisk && inDb;
      case 'unused':  return onDisk && !inDb;
      case 'rtp':     return !onDisk && entry.inRtp;
      case 'missing': return !onDisk && inDb && !entry.inRtp;
      default:        return true;
    }
  }), [assets, activeCategory, filterUsed, analyses]);

  const selectedAsset = selectedAssetKey ? analyses.get(selectedAssetKey)?.asset ?? null : null;
  const selectedAnalysis = selectedAssetKey ? analyses.get(selectedAssetKey) ?? null : null;

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) m.set(a.category, (m.get(a.category) || 0) + 1);
    return m;
  }, [assets]);

  const mapCount = gameData?.maps?.size ?? 0;

  const [renaming, setRenaming] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [batchAction, setBatchAction] = useState<BatchAction | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('rmm-theme', theme);
  }, [theme]);

  // ── Batch actions ─────────────────────────────────────────────────

  async function handleInjectRtp(cats: string[]) {
    const engine = gameData!.engine;
    const root = gameData!.rootHandle!;
    const catSet = new Set(cats);

    // Collect RTP assets to inject
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
        const bundleUrl = getRtpBundleUrl(asset.name, asset.category, engine);
        if (bundleUrl) {
          try {
            const resp = await fetch(bundleUrl);
            if (resp.ok) blob = await resp.blob();
          } catch {}
        }
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
      const refs = traceAllReferences(gameData!);
      const { allAssets, analyses: newMap } = buildAnalyses(found, refs, gameData!.engine);
      setAssets(allAssets);
      setAnalyses(newMap);
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
      const refs = traceAllReferences(gameData!);
      const { allAssets, analyses: newMap } = buildAnalyses(diskOnly, refs, gameData!.engine);
      setAssets(allAssets);
      setAnalyses(newMap);
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
      const refs = traceAllReferences(gameData!);
      const { allAssets, analyses: newMap } = buildAnalyses(diskOnly, refs, gameData!.engine);
      setAssets(allAssets);
      setAnalyses(newMap);
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

  async function handleBatchConfirm(cats: string[]) {
    if (batchAction === 'injectRtp') await handleInjectRtp(cats);
    else if (batchAction === 'cleanUnused') await handleCleanUnused(cats);
    else if (batchAction === 'clearMissing') await handleClearMissing(cats);
  }

  function toggleSelect(k: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedKeys(new Set(filteredAssets.map(a => `${a.category}/${a.stem.toLowerCase()}`)));
  }

  function invertSelection() {
    const all = new Set(filteredAssets.map(a => `${a.category}/${a.stem.toLowerCase()}`));
    setSelectedKeys(prev => {
      const next = new Set<string>();
      for (const k of all) if (!prev.has(k)) next.add(k);
      return next;
    });
  }

  async function handleRename(newStem: string) {
    if (!gameData || !selectedAnalysis) return;
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
      const refs = traceAllReferences(gameData);
      const diskOnly = newAssets.filter(a => a.handle !== undefined);
      const { allAssets, analyses: map } = buildAnalyses(diskOnly, refs, gameData.engine);
      setAssets(allAssets);
      setAnalyses(map);

      // 选中新 key
      const newKey = assetKey(newAsset.category, newAsset.stem);
      setSelectedAssetKey(newKey);
    } catch (e) {
      alert('重命名出错：' + (e as Error).message);
    } finally {
      setRenaming(false);
    }
  }

  // ===== 快照/撤销 =====
  const [snapMenuOpen, setSnapMenuOpen] = useState(false);
  const snapMenuRef = useRef<HTMLDivElement>(null);
  const [loadingHint, setLoadingHint] = useState<string | null>(null);
  const pendingBlobBuffer = useRef<Map<string, Blob>>(new Map());

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (snapMenuRef.current && !snapMenuRef.current.contains(e.target as Node)) setSnapMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // 每次重命名后刷新快照列表
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
    e.stopPropagation(); // don't trigger restore
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
      setAssets(newAssets);

      const diskOnly = newAssets.filter(a => a.handle !== undefined);
      const refs = traceAllReferences(gameData);
      const { allAssets, analyses: newAnalyses } = buildAnalyses(diskOnly, refs, gameData.engine);
      setAssets(allAssets);
      setAnalyses(newAnalyses);

      setSelectedKeys(new Set());
      setSelectedAssetKey(null);

      console.log(`[DELETE] ${result.message}`);
      await refreshSnapshots(gameData.rootHandle);
      console.timeEnd('[DELETE] aftermath');

      if (!result.success) {
        // 部分失败
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

  function formatTime(ts: number) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif', background: 'var(--color-bg)' }}>
      <header style={{
        padding: '10px 20px', borderBottom: '1px solid var(--color-border)',
        display: 'flex', gap: 14, alignItems: 'center',
        background: 'var(--color-bg-elev)',
      }}>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-text)', letterSpacing: -0.2 }}>
          RMM
        </h1>
        <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />
        <WorkspaceSelector
          onOpen={handleOpenProject}
          onClose={handleCloseProject}
          assetCount={assets.length}
          mapCount={mapCount}
          onEncodingChange={handleEncodingChange}
        />
        <RtpSelector />
        {gameData && <QuickActions onAction={setBatchAction} />}
        {gameData && (
          <div ref={snapMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={async () => { setSnapMenuOpen(!snapMenuOpen); await refreshSnapshots(gameData.rootHandle); }}
              style={{
                padding: '5px 10px', fontSize: 12,
                background: 'var(--color-bg-elev)', border: '1px solid var(--color-border)',
                borderRadius: 6, cursor: 'pointer', color: 'var(--color-text)',
                display: 'flex', alignItems: 'center', gap: 4,
                opacity: snapshots.length === 0 ? 0.5 : 1,
              }}
              title={snapshots.length > 0 ? `撤销最近 ${snapshots.length} 次修改` : '暂无快照'}
            >
              <span>↶ </span> 撤销
              {snapshots.length > 0 && (
                <span style={{
                  background: 'var(--color-primary-soft)', color: 'var(--color-primary-text)',
                  borderRadius: 10, padding: '0 6px', fontSize: 10,
                  minWidth: 16, textAlign: 'center',
                }}>{snapshots.length}</span>
              )}
            </button>
            {snapMenuOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: 4,
                minWidth: 280, maxWidth: 340, maxHeight: 340, overflowY: 'auto',
                background: 'var(--color-bg-elev)', border: '1px solid var(--color-border)', borderRadius: 8,
                boxShadow: '0 10px 25px rgba(0,0,0,0.1)', zIndex: 1000, padding: 4,
              }}>
                {snapshots.length === 0 ? (
                  <div style={{ padding: '16px 12px', color: 'var(--color-text-muted)', fontSize: 12, textAlign: 'center' }}>
                    暂无快照。
                  </div>
                ) : (
                  snapshots.map(s => (
                    <div
                      key={s.dirName}
                      style={{
                        display: 'flex', alignItems: 'center',
                        borderRadius: 4,
                      }}
                      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-hover)')}
                      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                    >
                      <button
                        onClick={() => handleRestoreSnapshot(s)}
                        style={{
                          flex: 1, textAlign: 'left',
                          padding: '8px 10px', border: 'none', background: 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 13, color: 'var(--color-text)', fontWeight: 500 }}>
                          {s.label || s.dirName}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          {formatTime(s.timestamp)} · {s.files.length + (s.deletedFiles?.length ?? 0)} 个文件
                        </div>
                      </button>
                      <button
                        onClick={(e) => handleDeleteSnapshot(s, e)}
                        title="删除快照"
                        style={{
                          width: 28, height: 28,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'transparent', border: 'none',
                          color: 'var(--color-text-muted)', fontSize: 14,
                          cursor: 'pointer', borderRadius: 4,
                          flexShrink: 0, marginRight: 4,
                        }}
                        onMouseEnter={e => ((e.target as HTMLElement).style.color = '#ff6b6b')}
                        onMouseLeave={e => ((e.target as HTMLElement).style.color = 'var(--color-text-muted)')}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {loading && (
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginRight: 8 }}>
            <span style={{
              width: 12, height: 12, border: '2px solid var(--color-border)',
              borderTopColor: 'var(--color-primary)', borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            加载中...
          </span>
        )}
        {tasks.length > 0 && (
          <TaskPanel tasks={tasks} onClearCompleted={clearCompletedTasks} />
        )}
        {gameData && (
          <button
            onClick={handleRefreshProject}
            disabled={loading}
            title="刷新项目数据（F5）"
            style={{
              width: 30, height: 30, fontSize: 16,
              background: 'transparent', border: '1px solid var(--color-border)',
              borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer',
              color: loading ? 'var(--color-text-dim)' : 'var(--color-text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ↻
          </button>
        )}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
          style={{
            width: 30, height: 30, fontSize: 16,
            background: 'transparent', border: '1px solid var(--color-border)',
            borderRadius: 6, cursor: 'pointer',
            color: 'var(--color-text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <span style={{ filter: 'grayscale(1)' }}>{theme === 'dark' ? '☀' : '☾'}</span>
        </button>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <aside style={{ width: 170, borderRight: '1px solid var(--color-border)', padding: 10, overflowY: 'auto', background: 'var(--color-bg-subtle)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, paddingLeft: 6 }}>素材类别</div>
          {getCategories(gameData?.engine ?? '2k3').map(cat => {
            const cnt = catCounts.get(cat) || 0;
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); setSelectedAssetKey(null); }}
                disabled={!gameData}
                style={{
                  display: 'flex', justifyContent: 'space-between',
                  width: '100%', padding: '7px 12px', margin: '1px 0',
                  background: isActive ? 'var(--color-primary-soft)' : 'transparent',
                  border: isActive ? '1px solid var(--color-primary)' : '1px solid transparent',
                  borderRadius: 5, textAlign: 'left',
                  cursor: gameData ? 'pointer' : 'not-allowed',
                  fontSize: 13, color: gameData ? 'var(--color-text)' : 'var(--color-text-muted)',
                  opacity: gameData ? 1 : 0.5,
                }}
              >
                <span>{cat}</span>
                <span style={{
                  color: cnt > 0 ? 'var(--color-text-muted)' : 'var(--color-border)',
                  fontSize: 11,
                  background: cnt > 0 ? 'var(--color-bg-hover)' : 'transparent',
                  padding: '1px 6px', borderRadius: 10,
                }}>{cnt}</span>
              </button>
            );
          })}
        </aside>

        <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-elev)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>筛选：</span>
                <FilterDropdown
                  value={filterUsed}
                  onChange={(f) => { setFilterUsed(f); setSelectedKeys(new Set()); }}
                  disabled={!gameData}
                />
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {filteredAssets.length} 项
                </span>
                {gameData && filteredAssets.length > 0 && selectedKeys.size === 0 && (
                  <button
                    onClick={selectAllFiltered}
                    style={{ ...batchBtnStyle, fontSize: 11 }}
                    title="全选当前筛选结果"
                  >选择</button>
                )}
              </div>
              {gameData && filteredAssets.length > 0 && selectedKeys.size > 0 && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginRight: 4 }}>已选 {selectedKeys.size}：</span>
                  <button onClick={selectAllFiltered} style={batchBtnStyle} title="全选当前筛选结果">全选</button>
                  <button onClick={invertSelection} style={batchBtnStyle} title="反选">反选</button>
                  <button onClick={() => setSelectedKeys(new Set())} style={{ ...batchBtnStyle, background: 'var(--color-bg-elev)', border: '1px solid var(--color-border)' }}>
                    取消
                  </button>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={handleDeleteSelected}
                    disabled={deleting}
                    style={{
                      padding: '5px 14px', fontSize: 12, borderRadius: 4,
                      border: 'none', cursor: deleting ? 'not-allowed' : 'pointer',
                      background: deleting ? 'var(--color-text-muted)' : 'var(--color-danger)', color: 'var(--color-text-inverse)',
                      fontWeight: 500,
                    }}
                  >
                    {deleting ? '删除中...' : `删除选中`}
                  </button>
                </div>
              )}
            </div>
            <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', padding: 14 }}>
              {loading ? (
                <div style={{ textAlign: 'center', marginTop: 60, color: 'var(--color-text-muted)' }}>
                  <div style={{
                    width: 44, height: 44, border: '3px solid var(--color-border)',
                    borderTopColor: 'var(--color-primary)', borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    margin: '0 auto 18px',
                  }} />
                  <p style={{ fontSize: 15, margin: 0, fontWeight: 500, color: 'var(--color-text)' }}>
                    {loadingHint ?? (gameData ? '正在扫描素材目录...' : '正在加载项目...')}
                  </p>
                  <p style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--color-text-muted)' }}>
                    {loadingHint ? '' : (gameData ? '解析数据库引用 · 建立引用索引' : '读取 RPG_RT.ldb · 检测编码 · 解码地图')}
                  </p>
                </div>
              ) : !gameData ? (
                <div style={{ textAlign: 'center', marginTop: 60, color: 'var(--color-text-muted)' }}>
                  <p style={{ fontSize: 14, margin: '0 0 8px' }}>请先打开一个 RPG Maker 2000 / 2003 项目</p>
                </div>
              ) : filteredAssets.length === 0 ? (
                <div style={{ textAlign: 'center', marginTop: 60, color: 'var(--color-text-muted)', fontSize: 13 }}>
                  该类别下没有素材
                </div>
              ) : (
                <VirtualGrid
                  items={filteredAssets}
                  scrollContainerRef={scrollContainerRef}
                  cardMinWidth={210}
                  gap={10}
                  cardHeight={90}
                  renderItem={(a) => {
                    const k = `${a.category}/${a.stem.toLowerCase()}`;
                    const entry = analyses.get(k);
                    const isSel = k === selectedAssetKey;
                    const isBatchSel = selectedKeys.has(k);
                    const inBatchMode = selectedKeys.size > 0;
                    const isXyz = a.ext === '.xyz';
                    const onDisk = a.handle !== undefined;
                    const isRtp = !onDisk && !!entry?.inRtp;
                    const isMissing = !onDisk && !entry?.inRtp;
                    const isOff = !onDisk;

                    function handleCardClick(e: React.MouseEvent) {
                      if (e.shiftKey || inBatchMode) {
                        toggleSelect(k);
                      } else {
                        setSelectedAssetKey(k);
                      }
                    }

                    return (
                      <div
                        onClick={handleCardClick}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          toggleSelect(k);
                        }}
                        style={{
                          listStyle: 'none',
                          border: isBatchSel ? '2px solid var(--color-danger)' : isSel ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                          background: isBatchSel ? 'var(--color-danger-soft)' : isSel ? 'var(--color-primary-soft)' : 'var(--color-bg-elev)',
                          padding: 10, borderRadius: 6,
                          cursor: 'pointer', transition: 'all 0.12s', height: '100%',
                          boxShadow: isSel ? '0 2px 8px rgba(59,130,246,0.15)' : isBatchSel ? '0 2px 8px rgba(220,38,38,0.12)' : 'none',
                          display: 'flex', flexDirection: 'column', position: 'relative',
                          minWidth: 0, overflow: 'hidden',
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: 4, right: 4,
                          width: 18, height: 18, borderRadius: 4,
                          border: isBatchSel ? 'none' : '1.5px solid var(--color-border)',
                          background: isBatchSel ? 'var(--color-danger)' : 'var(--color-bg-elev)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--color-text-inverse)', fontSize: 12, fontWeight: 700,
                          opacity: isBatchSel || inBatchMode ? 1 : 0,
                          transition: 'opacity 0.15s',
                          pointerEvents: 'none', flexShrink: 0,
                        }}>
                          {isBatchSel ? '✓' : ''}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3, color: 'var(--color-text)', paddingRight: 20, minWidth: 0 }}>
                          {a.name}
                        </div>
                        <div style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
                          {isOff ? (
                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>引用 {entry?.references.length ?? 0} 处</span>
                          ) : (
                            <span style={{ color: entry?.inDatabase ? 'var(--color-success-text)' : 'var(--color-danger)', fontWeight: 500 }}>
                              {entry?.inDatabase ? `已使用 ${entry.references.length}` : '未使用'}
                            </span>
                          )}
                          {!isOff && isXyz && (
                            <span style={{ fontSize: 9, background: 'var(--color-bg-warning)', color: 'var(--color-warning-text)', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>XYZ</span>
                          )}
                        </div>
                        {!isOff && (
                          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>{(a.size/1024).toFixed(1)} KB</div>
                        )}
                        {isRtp && (
                          <div style={{ fontSize: 10, color: 'var(--color-warning-text)', marginTop: 2 }}>依赖 RTP</div>
                        )}
                        {isMissing && (
                          <div style={{ fontSize: 10, color: 'var(--color-danger)', marginTop: 2 }}>素材缺失</div>
                        )}
                      </div>
                    );
                  }}
                />
              )}
            </div>
          </div>

          <aside style={{ width: 350, borderLeft: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--color-bg-elev)' }}>
            <div style={{ overflowY: 'auto', borderBottom: '1px solid var(--color-bg-hover)' }}>
              <AssetPreview asset={selectedAsset} analysis={selectedAnalysis} engine={gameData?.engine} onSaved={() => gameData?.rootHandle && refreshSnapshots(gameData.rootHandle)} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <AssetDetail
                analysis={selectedAnalysis}
                engine={gameData?.engine}
                onRename={handleRename}
                renaming={renaming}
                onDelete={() => {
                  if (!selectedAssetKey) return;
                  setSelectedKeys(new Set([selectedAssetKey]));
                  setTimeout(handleDeleteSelected, 0);
                }}
                deleting={deleting}
              />
            </div>
          </aside>
        </main>
      </div>
      {batchAction && (
        <BatchModal
          action={batchAction}
          onClose={() => setBatchAction(null)}
          onConfirm={handleBatchConfirm}
        />
      )}
    </div>
  );
}








