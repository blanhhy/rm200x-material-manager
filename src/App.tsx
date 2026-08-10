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

  // ── 编码切换 ──────────────────────────────────────────────────────
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

  // ── 选中资产 ──────────────────────────────────────────────────────
  const selectedAsset = selectedAssetKey ? analyses.get(selectedAssetKey)?.asset ?? null : null;
  const selectedAnalysis = selectedAssetKey ? analyses.get(selectedAssetKey) ?? null : null;

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assets) m.set(a.category, (m.get(a.category) || 0) + 1);
    return m;
  }, [assets]);

  const mapCount = gameData?.maps?.size ?? 0;

  // ── 主题 ──────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('rmm-theme', theme);
  }, [theme]);

  // ── 工具函数 ──────────────────────────────────────────────────────
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
              onClick={async () => {
                setSnapMenuOpen(!snapMenuOpen);
                const { refreshSnapshots } = useStore.getState();
                await refreshSnapshots(gameData.rootHandle);
              }}
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
              <AssetPreview asset={selectedAsset} analysis={selectedAnalysis} engine={gameData?.engine} onSaved={() => {
                if (gameData?.rootHandle) {
                  const { refreshSnapshots } = useStore.getState();
                  refreshSnapshots(gameData.rootHandle);
                }
              }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <AssetDetail
                analysis={selectedAnalysis}
                engine={gameData?.engine}
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
