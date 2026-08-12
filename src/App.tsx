import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './store/useStore';
import { loadGameProject, reDecodeWithEncoding } from './core/lcfLoader';
import { scanProjectAssets } from './scanner/assetScanner';
import { useRebuildAnalyses } from './hooks/useRebuildAnalyses';
import { useSelection } from './hooks/useSelection';
import { useRenameAsset } from './hooks/useRenameAsset';
import { useDeleteAsset } from './hooks/useDeleteAsset';
import { useSnapshotManager } from './hooks/useSnapshotManager';
import { useBatchActions } from './hooks/useBatchActions';
import AssetPreview from './components/AssetPreview';
import AssetDetail from './components/AssetDetail';
import VirtualGrid from './components/VirtualGrid';
import WorkspaceSelector from './components/WorkspaceSelector';
import RtpSelector from './components/RtpSelector';
import BatchModal from './components/BatchModal';
import QuickActions from './components/QuickActions';
import FilterDropdown from './components/FilterDropdown';
import TaskPanel from './components/TaskPanel';
import { initBuiltinRtp } from './core/rtpIndex';
import { getCategories } from './scanner/assetTypes';

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
    tasks, clearCompletedTasks,
    snapshots,
    setActiveRtpSourceId,
  } = useStore();

  // ── 派生数据（必须在 hooks 前，因 useSelection 依赖 filteredAssets） ──
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

  // ── Hooks: 业务逻辑模块 ───────────────────────────────────────────
  const rebuild = useRebuildAnalyses();
  const { selectedKeys, setSelectedKeys, toggleSelect, selectAllFiltered, invertSelection } = useSelection(filteredAssets);
  const { renaming, handleRename } = useRenameAsset();
  const { deleting, handleDeleteSelected } = useDeleteAsset(selectedKeys, setSelectedKeys);
  const { snapMenuOpen, setSnapMenuOpen, snapMenuRef, loadingHint, handleRestoreSnapshot, handleDeleteSnapshot } = useSnapshotManager();
  const { batchAction, setBatchAction, handleBatchConfirm } = useBatchActions(setSelectedKeys);

  // ── 项目加载 / 刷新 / 关闭 ────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollContainerRef.current?.scrollTo(0, 0); }, [activeCategory, filterUsed]);

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
        //setFilterUsed('all');
        setGameData(null);
      }
      setLoading(true);
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 16)));

      let data = await loadGameProject(root);
      if (encoding && encoding !== data.encoding) data = await reDecodeWithEncoding(data, encoding);
      setGameData(data);

      initBuiltinRtp(data.engine);
      setActiveRtpSourceId('builtin');
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 16)));

      const t0 = performance.now();
      const found = await scanProjectAssets(root);
      console.log(`[性能] scanProjectAssets: ${(performance.now() - t0).toFixed(0)}ms · ${found.length} files`);

      const stems = new Set<string>();
      for (const a of found) stems.add(a.stem.toLowerCase());

      const t1 = performance.now();
      const map = await rebuild(data, found);
      console.log(`[性能] rebuildAnalyses: ${(performance.now() - t1).toFixed(0)}ms`);

      console.group('[诊断] 项目加载');
      console.log('编码:', data.encoding, '引擎:', data.engine, '素材:', found.length);
      if (data.database) {
        const sampleChars = data.database.actors?.slice(0, 5).map(a => ({ id: a.id, characterName: a.characterName, faceName: a.faceName, matchDisk: stems.has(a.characterName?.toLowerCase() ?? '') }));
        console.log('Actress 样本:', sampleChars);
        console.log('Actress 数量:', data.database.actors?.length);
      }
      const allAnalyses = Array.from(analyses.values());
      const missingCount = allAnalyses.filter(e => !e.onDisk).length;
      const unusedCount = allAnalyses.filter(e => e.onDisk && !e.inDatabase).length;
      console.log(`磁盘=${found.length} 缺失=${missingCount} 未使用=${unusedCount}`);
      if (missingCount > 0) {
        console.groupCollapsed(`${missingCount} 个缺失素材`);
        for (const e of Array.from(map.values()).filter(e => !e.onDisk).slice(0, 20))
          console.log(`  [${e.asset.category}] "${e.asset.stem}" refs=${e.references.length}`);
        console.groupEnd();
      }
      console.groupEnd();
      (window as any).__DIAG_ANALYSES = Array.from(map.values()).map(e => ({
        cat: e.asset.category, name: e.asset.stem,
        onDisk: e.onDisk, inRtp: e.inRtp, refs: e.references.length,
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
    setGameData(null); setAssets([]); setAnalyses(new Map());
    setSelectedAssetKey(null);
  }

  async function handleEncodingChange(enc: string) {
    if (!gameData) return;
    setLoading(true);
    try {
      const newData = await reDecodeWithEncoding(gameData, enc);
      setGameData(newData);
      const diskOnly = assets.filter(a => a.handle !== undefined);
      await rebuild(newData, diskOnly);
      console.log(`[ENCODE SWITCH] → ${enc}`);
    } catch (e) {
      console.error('reDecode failed:', e);
    } finally {
      setLoading(false);
    }
  }

  const selectedAsset = selectedAssetKey ? analyses.get(selectedAssetKey)?.asset ?? null : null;
  const selectedAnalysis = selectedAssetKey ? analyses.get(selectedAssetKey) ?? null : null;

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) m.set(a.category, (m.get(a.category) || 0) + 1);
    return m;
  }, [assets]);

  const mapCount = gameData?.maps?.size ?? 0;

  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('rmm-theme', theme);
  }, [theme]);

  function formatTime(ts: number) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  }

  return (
    <div className="appRoot">
      <header className="appHeader">
        <h1 className="brand">RMM</h1>
        <div className="dividerV" />
        <WorkspaceSelector
          onOpen={handleOpenProject} onClose={handleCloseProject}
          assetCount={assets.length} mapCount={mapCount}
          onEncodingChange={handleEncodingChange}
        />
        <RtpSelector />
        {gameData && <QuickActions onAction={setBatchAction} />}
        {gameData && (
          <div ref={snapMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={async () => {
                setSnapMenuOpen(!snapMenuOpen);
                const { refreshSnapshots } = useStore.getState();
                await refreshSnapshots(gameData.rootHandle);
              }}
              className="snapBtn"
              data-empty={snapshots.length === 0 || undefined}
              title={snapshots.length > 0 ? `撤销最近 ${snapshots.length} 次修改` : '暂无快照'}
            >
              <span>↶ </span> 撤销
              {snapshots.length > 0 && <span className="snapBadge">{snapshots.length}</span>}
            </button>
            {snapMenuOpen && (
              <div className="popupMenu" style={{ minWidth: 280, maxWidth: 340, maxHeight: 340, overflowY: 'auto' }}>
                {snapshots.length === 0 ? (
                  <div className="popupMenuEmpty">暂无快照。</div>
                ) : (
                  snapshots.map(s => (
                    <div key={s.dirName} className="popupMenuItem">
                      <button onClick={() => handleRestoreSnapshot(s)} className="popupMenuBtn">
                        <div className="popupMenuLabel">{s.label || s.dirName}</div>
                        <div className="popupMenuMeta">
                          {formatTime(s.timestamp)} · {s.files.length + (s.deletedFiles?.length ?? 0)} 个文件
                        </div>
                      </button>
                      <button onClick={(e) => handleDeleteSnapshot(s, e)} className="popupMenuBtnDanger" title="删除快照">×</button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        <div className="spacer" />
        {loading && (
          <span className="headerLoading">
            <div className="loadingSpinnerSmall" /> 加载中...
          </span>
        )}
        {tasks.length > 0 && <TaskPanel tasks={tasks} onClearCompleted={clearCompletedTasks} />}
        {gameData && (
          <button onClick={handleRefreshProject} disabled={loading} className="iconBtn" title="刷新项目数据（F5）">↻</button>
        )}
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="iconBtn"
          title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}>
          <span className="themeIcon">{theme === 'dark' ? '☀' : '☾'}</span>
        </button>
      </header>

      <div className="appBody">
        <aside className="sidebar">
          <div className="sidebarLabel">素材类别</div>
          {getCategories(gameData?.engine ?? '2k3').map(cat => {
            const cnt = catCounts.get(cat) || 0;
            const isActive = activeCategory === cat;
            return (
              <button key={cat} onClick={() => { setActiveCategory(cat); setSelectedAssetKey(null); }}
                disabled={!gameData} className="sidebarBtn"
                data-active={isActive || undefined} data-disabled={!gameData || undefined}>
                <span>{cat}</span>
                <span className="sidebarCount" data-empty={cnt === 0 || undefined}>{cnt}</span>
              </button>
            );
          })}
        </aside>

        <main className="mainWrap">
          <div className="mainContent">
            <div className="filterBar">
              <div className="filterBarRow">
                <span className="filterLabel">筛选：</span>
                <FilterDropdown value={filterUsed} onChange={(f) => { setFilterUsed(f); setSelectedKeys(new Set()); }} disabled={!gameData} />
                <span className="filterCount">{filteredAssets.length} 项</span>
                {gameData && filteredAssets.length > 0 && selectedKeys.size === 0 && (
                  <button onClick={selectAllFiltered} className="btnSm" title="全选当前筛选结果">选择</button>
                )}
              </div>
              {gameData && filteredAssets.length > 0 && selectedKeys.size > 0 && (
                <div className="batchBar">
                  <span className="batchBarLabel">已选 {selectedKeys.size}：</span>
                  <button onClick={selectAllFiltered} className="btnSm" title="全选当前筛选结果">全选</button>
                  <button onClick={invertSelection} className="btnSm" title="反选">反选</button>
                  <button onClick={() => setSelectedKeys(new Set())} className="btnSm">取消</button>
                  <div className="spacer" />
                  <button onClick={handleDeleteSelected} disabled={deleting} className="btnDanger">
                    {deleting ? '删除中...' : `删除选中`}
                  </button>
                </div>
              )}
            </div>
            <div ref={scrollContainerRef} className="gridArea">
              {loading ? (
                <div className="loadingPage">
                  <div className="loadingSpinner" />
                  <p className="loadingPageTitle">{loadingHint ?? (gameData ? '正在扫描素材目录...' : '正在加载项目...')}</p>
                  <p className="loadingPageSub">{loadingHint ? '' : (gameData ? '解析数据库引用 · 建立引用索引' : '读取 RPG_RT.ldb · 检测编码 · 解码地图')}</p>
                </div>
              ) : !gameData ? (
                <div className="pageEmpty"><p className="pageEmptyTitle">请先打开一个 RPG Maker 2000 / 2003 项目</p></div>
              ) : filteredAssets.length === 0 ? (
                <div className="pageEmpty"><p className="pageEmptySub">该类别下没有素材</p></div>
              ) : (
                <VirtualGrid
                  items={filteredAssets} scrollContainerRef={scrollContainerRef}
                  cardMinWidth={210} gap={10} cardHeight={90}
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
                      if (e.shiftKey || inBatchMode) toggleSelect(k);
                      else setSelectedAssetKey(k);
                    }

                    return (
                      <div onClick={handleCardClick} onContextMenu={(e) => { e.preventDefault(); toggleSelect(k); }}
                        className="assetCard" data-selected={isSel || undefined} data-batch={isBatchSel || undefined}>
                        <div className="assetCardCheck" data-visible={isBatchSel || inBatchMode || undefined} data-batch={isBatchSel || undefined}>
                          {isBatchSel ? '✓' : ''}
                        </div>
                        <div className="assetCardName">{a.name}</div>
                        <div className="assetCardMeta">
                          {isOff ? (
                            <span className="assetCardRefs">引用 {entry?.references.length ?? 0} 处</span>
                          ) : (
                            <span style={{ color: entry?.inDatabase ? 'var(--color-success-text)' : 'var(--color-danger)', fontWeight: 500 }}>
                              {entry?.inDatabase ? `已使用 ${entry.references.length}` : '未使用'}
                            </span>
                          )}
                          {!isOff && isXyz && <span className="assetCardXyz">XYZ</span>}
                        </div>
                        {!isOff && <div className="assetCardSize">{(a.size/1024).toFixed(1)} KB</div>}
                        {isRtp && <div className="assetCardTag assetCardTagRtp">依赖 RTP</div>}
                        {isMissing && <div className="assetCardTag assetCardTagMissing">素材缺失</div>}
                      </div>
                    );
                  }}
                />
              )}
            </div>
          </div>

          <aside className="detailPanel">
            <div className="detailPreviewArea">
              <AssetPreview asset={selectedAsset} analysis={selectedAnalysis} engine={gameData?.engine} onSaved={() => {
                if (gameData?.rootHandle) { const { refreshSnapshots } = useStore.getState(); refreshSnapshots(gameData.rootHandle); }
              }} />
            </div>
            <div className="detailInfoArea">
              <AssetDetail
                analysis={selectedAnalysis} engine={gameData?.engine}
                onRename={(newStem) => { if (selectedAnalysis) handleRename(newStem, selectedAnalysis); }}
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
      {batchAction && <BatchModal action={batchAction} onClose={() => setBatchAction(null)} onConfirm={handleBatchConfirm} />}
    </div>
  );
}
