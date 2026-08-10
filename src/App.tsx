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
import type { AssetReference } from './types/index';
import { initBuiltinRtp, scanDiskRtpFileSet, initDiskRtp, activateDiskRtp, getRtpBundleUrl, lookupRTPFileInfo, resolveRtpDirName, getActiveRtpKind, getActiveRtpDiskHandle } from './core/rtpIndex';
import { CATEGORY_EXTS, getPrimaryExt, getCategories, DB_FILE_EXTS } from './scanner/assetTypes';



function assetKey(cat: string, stem: string): string {
  return `${cat}/${stem.toLowerCase()}`;
}

const FILTER_LABEL: Record<string, string> = { all:'全部', disk:'素材库', refs:'数据库', used:'已使用', unused:'未使用', rtp:'RTP', missing:'缺失' };

const batchBtnStyle: React.CSSProperties = {
  padding: '4px 10px', fontSize: 12, borderRadius: 4,
  border: '1px solid var(--color-border)', background: 'var(--color-bg-elev)', color: 'var(--color-text)',
  cursor: 'pointer',
};

type Theme = 'dark' | 'light';
const _savedTheme = (typeof localStorage !== 'undefined' ? localStorage.getItem('rmm-theme') : null) as Theme | null;
const initialTheme: Theme = _savedTheme ?? 'dark';

function WorkspaceSelector({
  onOpen, onClose, assetCount, mapCount, onEncodingChange,
}: {
  onOpen: () => void;
  onClose: () => void;
  assetCount: number;
  mapCount: number;
  onEncodingChange: (enc: string) => void;
}) {
  const { gameData, loading, error } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { projectName, iniStatus } = (() => {
    const ini = gameData?.rpgIni;
    if (!ini) return { projectName: '', iniStatus: 'missing' as const };
    const t1 = ini['RPG_RT']?.GameTitle?.trim();
    if (t1) return { projectName: t1, iniStatus: 'ok' as const };
    const t2 = ini['Game']?.GameTitle?.trim();
    if (t2) return { projectName: t2, iniStatus: 'ok' as const };
    return { projectName: '', iniStatus: 'no-title' as const };
  })();

  const dirName = gameData?.rootHandle?.name || '';

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', fontSize: 13, fontWeight: 500,
          background: gameData ? 'var(--color-bg-elev)' : 'transparent',
          border: gameData ? '1px solid var(--color-border)' : '1px dashed var(--color-text-dim)',
          borderRadius: 6, cursor: 'pointer',
          color: gameData ? 'var(--color-text)' : 'var(--color-text-muted)',
          maxWidth: 360,
        }}
      >
        <span style={{ filter: 'grayscale(1)', opacity: 0.6 }}>📁</span>
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1, textAlign: 'left',
        }}>
          {gameData
            ? (dirName || '未命名项目')
            : '打开项目'}
        </span>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>▾</span>
      </button>

      {menuOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          minWidth: 320, background: 'var(--color-bg-elev)',
          border: '1px solid var(--color-border)', borderRadius: 8,
          boxShadow: '0 10px 25px rgba(0,0,0,0.1)', zIndex: 1000,
          padding: 8,
        }}>
          {error && (
            <div style={{ padding: '6px 10px', background: 'var(--color-danger-soft)', color: 'var(--color-danger)', borderRadius: 4, fontSize: 12, marginBottom: 6 }}>
              {error}
            </div>
          )}
          {loading ? (
            <div style={{ padding: 12, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
              加载中...
            </div>
          ) : gameData ? (
            <>
              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-bg-hover)', marginBottom: 4 }}>
                {projectName ? (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4, wordBreak: 'break-all' }}>
                      {projectName}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {dirName}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4, wordBreak: 'break-all' }}>
                      {dirName}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-warning-text)', wordBreak: 'break-all' }}>
                      {iniStatus === 'missing' ? '⚠ INI 读取被拒绝' : '⚠ 未设置 GameTitle'}
                    </div>
                  </>
                )}
              </div>

              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                gap: '4px 12px', padding: '4px 10px 10px',
                fontSize: 12,
              }}>
                <div><span style={{ color: 'var(--color-text-muted)' }}>引擎</span><br /><b>{gameData.engine === '2k' ? 'RPG Maker 2000' : 'RPG Maker 2003'}</b></div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>编码</span><br />
                  <select
                    value={gameData.encoding}
                    onChange={e => { onEncodingChange(e.target.value); }}
                    style={{
                      padding: '2px 6px', fontSize: 12, border: '1px solid var(--color-border)',
                      borderRadius: 4, background: 'var(--color-bg-elev)', cursor: 'pointer',
                    }}
                  >
                    <option value="shift_jis">Shift_JIS</option>
                    <option value="gbk">GBK</option>
                    <option value="euc_jp">EUC-JP</option>
                    <option value="utf8">UTF-8</option>
                    <option value="latin1">Latin-1</option>
                  </select>
                </div>
                <div><span style={{ color: 'var(--color-text-muted)' }}>素材总数</span><br /><b>{assetCount}</b></div>
                <div><span style={{ color: 'var(--color-text-muted)' }}>地图数</span><br /><b>{mapCount}</b></div>
                <div><span style={{ color: 'var(--color-text-muted)' }}>角色数</span><br /><b>{gameData.database?.actors?.length ?? 0}</b></div>
                <div><span style={{ color: 'var(--color-text-muted)' }}>数据库</span><br /><b>{(gameData.database ? '已加载' : '—')}</b></div>
              </div>

              <div style={{ borderTop: '1px solid var(--color-bg-hover)', paddingTop: 4 }}>
                <button
                  onClick={() => { setMenuOpen(false); onOpen(); }}
                  style={{
                    width: '100%', padding: '8px 10px', textAlign: 'left',
                    background: 'transparent', border: 'none',
                    cursor: 'pointer', fontSize: 13, color: 'var(--color-text)',
                    borderRadius: 4,
                  }}
                  onMouseEnter={e => ((e.target as HTMLElement).style.background = 'var(--color-bg-hover)')}
                  onMouseLeave={e => ((e.target as HTMLElement).style.background = 'transparent')}
                >
                  切换目录...
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onClose(); }}
                  style={{
                    width: '100%', padding: '8px 10px', textAlign: 'left',
                    background: 'transparent', border: 'none',
                    cursor: 'pointer', fontSize: 13, color: 'var(--color-danger)',
                    borderRadius: 4,
                  }}
                  onMouseEnter={e => ((e.target as HTMLElement).style.background = 'var(--color-danger-soft)')}
                  onMouseLeave={e => ((e.target as HTMLElement).style.background = 'transparent')}
                >
                  关闭项目
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: '10px 12px', color: 'var(--color-text-muted)', fontSize: 13 }}>
                未打开项目
              </div>
              <button
                onClick={() => { setMenuOpen(false); onOpen(); }}
                style={{
                  width: '100%', padding: '8px 10px', textAlign: 'left',
                  background: 'transparent', border: 'none',
                  cursor: 'pointer', fontSize: 13, color: 'var(--color-primary-text)',
                  borderRadius: 4,
                }}
                onMouseEnter={e => ((e.target as HTMLElement).style.background = 'var(--color-primary-soft)')}
                onMouseLeave={e => ((e.target as HTMLElement).style.background = 'transparent')}
              >
                选择目录...
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RtpSelector() {
  const { gameData, activeRtpSourceId, setActiveRtpSourceId } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [diskSources, setDiskSources] = useState<{ id: string; label: string; stats: string }[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentLabel = activeRtpSourceId === 'builtin' ? '内置RTP' : diskSources.find(s => s.id === activeRtpSourceId)?.label ?? '未选择';

  async function handleAddDiskRtp() {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      const result = await scanDiskRtpFileSet(handle);
      if (!result) {
        alert('所选目录不包含任何有效的 RTP 素材子目录（如 Backdrop、ChipSet、Music 等）。');
        return;
      }
      const { fileSet, dirNames } = result;
      const id = `disk_${Date.now()}`;
      const label = handle.name;
      let totalFiles = 0;
      for (const files of fileSet.values()) totalFiles += files.size;
      const stats = `${fileSet.size} 个子目录 · ${totalFiles} 个文件`;
      initDiskRtp(id, fileSet, handle, dirNames);
      setDiskSources(prev => [...prev, { id, label, stats }]);
      setActiveRtpSourceId(id);
      setMenuOpen(false);
    } catch (e) {
      if ((e as Error).message?.includes('aborted')) return;
      alert('添加 RTP 目录失败：' + (e as Error).message);
    }
  }

  function handleSelect(id: string) {
    if (id === 'builtin' && gameData) {
      initBuiltinRtp(gameData.engine);
    } else if (id !== 'builtin') {
      // Disk source — activate from registry
      if (!activateDiskRtp(id)) return; // source not found (shouldn't happen)
    }
    setActiveRtpSourceId(id);
    setMenuOpen(false);
  }

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', fontSize: 12,
          background: 'var(--color-bg-elev)',
          border: '1px solid var(--color-border)',
          borderRadius: 6, cursor: 'pointer',
          color: 'var(--color-text)',
          whiteSpace: 'nowrap',
          opacity: gameData ? 1 : 0.5,
        }}
        title="选择 RTP 素材来源"
      >
        <span>{currentLabel}</span>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>▾</span>
      </button>

      {menuOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          minWidth: 220, background: 'var(--color-bg-elev)',
          border: '1px solid var(--color-border)', borderRadius: 8,
          boxShadow: '0 10px 25px rgba(0,0,0,0.1)', zIndex: 1000,
          padding: 4,
        }}>
          {/* Built-in */}
          <button
            onClick={() => handleSelect('builtin')}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 10px', border: 'none', background: activeRtpSourceId === 'builtin' ? 'var(--color-primary-soft)' : 'transparent',
              cursor: 'pointer', borderRadius: 4, fontSize: 12,
              color: activeRtpSourceId === 'builtin' ? 'var(--color-primary-text)' : 'var(--color-text)',
            }}
          >
            内置RTP<br />
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>预置图片与音频素材</span>
          </button>

          {/* Disk sources */}
          {diskSources.map(s => (
            <button
              key={s.id}
              onClick={() => handleSelect(s.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 10px', border: 'none', background: activeRtpSourceId === s.id ? 'var(--color-primary-soft)' : 'transparent',
                cursor: 'pointer', borderRadius: 4, fontSize: 12,
                color: activeRtpSourceId === s.id ? 'var(--color-primary-text)' : 'var(--color-text)',
                marginTop: 2,
              }}
            >
              {s.label}<br />
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{s.stats}</span>
            </button>
          ))}

          <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />

          <button
            onClick={handleAddDiskRtp}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 10px', border: 'none', background: 'transparent',
              cursor: 'pointer', borderRadius: 4, fontSize: 12,
              color: 'var(--color-primary-text)',
            }}
          >
            + 添加本地 RTP 目录...
          </button>
        </div>
      )}
    </div>
  );
}

// ── Batch action modal ──────────────────────────────────────────────

type BatchAction = 'injectRtp' | 'cleanUnused' | 'clearMissing';

function BatchModal({
  action,
  onClose,
  onConfirm,
}: {
  action: BatchAction;
  onClose: () => void;
  onConfirm: (cats: string[]) => Promise<void>;
}) {
  const { gameData, analyses } = useStore();
  const cats = getCategories(gameData?.engine ?? '2k3');
  const [selected, setSelected] = useState<Set<string>>(new Set(cats));
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    const allAnalyses = Array.from(analyses.values());

    if (action === 'injectRtp') {
      for (const a of allAnalyses) {
        if (a.inRtp && !a.onDisk) {
          m.set(a.asset.category, (m.get(a.asset.category) || 0) + 1);
        }
      }
    } else if (action === 'cleanUnused') {
      for (const a of allAnalyses) {
        if (a.onDisk && !a.inDatabase) {
          m.set(a.asset.category, (m.get(a.asset.category) || 0) + 1);
        }
      }
    } else if (action === 'clearMissing') {
      for (const a of allAnalyses) {
        if (!a.onDisk && a.inDatabase && !a.inRtp) {
          m.set(a.asset.category, (m.get(a.asset.category) || 0) + 1);
        }
      }
    }
    return m;
  }, [analyses, action]);

  const total = Array.from(counts.values()).reduce((s, c) => s + c, 0);

  const labels: Record<BatchAction, string> = {
    injectRtp: '注入RTP',
    cleanUnused: '清理无用素材',
    clearMissing: '清除无效引用',
  };

  function toggle(cat: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm(Array.from(selected));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--color-bg-elev)', borderRadius: 10,
        padding: 20, minWidth: 320, maxWidth: 400,
        boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--color-text)' }}>
          {labels[action]}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
          选择要处理的类别（共 {total} 项）
        </p>
        <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 12, border: '1px solid var(--color-border)', borderRadius: 6, padding: 4 }}>
          {cats.map(cat => {
            const cnt = counts.get(cat) || 0;
            return (
              <label key={cat} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 8px', cursor: 'pointer', fontSize: 13,
                borderRadius: 4,
                opacity: cnt === 0 ? 0.4 : 1,
              }}>
                <input
                  type="checkbox"
                  checked={selected.has(cat)}
                  onChange={() => toggle(cat)}
                  disabled={cnt === 0}
                />
                <span style={{ flex: 1, color: 'var(--color-text)' }}>{cat}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', minWidth: 24, textAlign: 'right' }}>{cnt}</span>
              </label>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy} style={{
            padding: '6px 16px', borderRadius: 6, border: '1px solid var(--color-border)',
            background: 'var(--color-bg-elev)', color: 'var(--color-text)',
            cursor: busy ? 'not-allowed' : 'pointer', fontSize: 13,
          }}>取消</button>
          <button onClick={handleConfirm} disabled={busy || selected.size === 0} style={{
            padding: '6px 16px', borderRadius: 6, border: 'none',
            background: busy ? 'var(--color-text-muted)' : 'var(--color-primary)',
            color: 'var(--color-text-inverse)', cursor: busy || selected.size === 0 ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 500,
          }}>{busy ? '处理中...' : '确认'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Quick actions dropdown ──────────────────────────────────────────

function QuickActions({ onAction }: { onAction: (a: BatchAction) => void }) {
  const { gameData } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (!gameData) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '5px 10px', fontSize: 12,
        background: 'var(--color-bg-elev)', border: '1px solid var(--color-border)',
        borderRadius: 6, cursor: 'pointer', color: 'var(--color-text)',
        whiteSpace: 'nowrap',
      }}>
        <span>便捷功能</span>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          minWidth: 160, background: 'var(--color-bg-elev)',
          border: '1px solid var(--color-border)', borderRadius: 8,
          boxShadow: '0 10px 25px rgba(0,0,0,0.1)', zIndex: 1000, padding: 4,
        }}>
          {([
            ['injectRtp', '注入RTP', '将所选RTP源中的素材复制到项目目录'],
            ['cleanUnused', '清理无用素材', '删除磁盘上有但数据库未引用的素材'],
            ['clearMissing', '清除无效引用', '清除指向已缺失素材的数据库引用'],
          ] as const).map(([id, label, desc]) => (
            <button key={id} onClick={() => { setOpen(false); onAction(id); }} title={desc} style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 10px', border: 'none', background: 'transparent',
              cursor: 'pointer', borderRadius: 4, fontSize: 12,
              color: 'var(--color-text)',
            }}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Filter dropdown ─────────────────────────────────────────────────

const FILTER_OPTIONS = ['all','disk','refs','used','unused','rtp','missing'] as const;

function FilterDropdown({
  value,
  onChange,
  disabled,
}: {
  value: typeof FILTER_OPTIONS[number];
  onChange: (f: typeof FILTER_OPTIONS[number]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        style={{
          padding: '4px 0', fontSize: 12,
          background: 'transparent', border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: 'var(--color-text)',
          opacity: disabled ? 0.4 : 1,
          display: 'flex', alignItems: 'center', gap: 2,
        }}
      >
        {FILTER_LABEL[value]}
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 2,
          minWidth: 100, background: 'var(--color-bg-elev)',
          border: '1px solid var(--color-border)', borderRadius: 6,
          boxShadow: '0 6px 16px rgba(0,0,0,0.12)', zIndex: 1000, padding: 4,
        }}>
          {FILTER_OPTIONS.map(f => (
            <button key={f} onClick={() => { setOpen(false); onChange(f); }} style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '5px 10px', border: 'none',
              background: value === f ? 'var(--color-primary-soft)' : 'transparent',
              cursor: 'pointer', borderRadius: 4, fontSize: 12,
              color: value === f ? 'var(--color-primary-text)' : 'var(--color-text)',
            }}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskPanel({ tasks, onClearCompleted }: {
  tasks: ReturnType<typeof useStore.getState>['tasks'];
  onClearCompleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const running = tasks.filter(t => t.status === 'running' || t.status === 'pending');
  const done = tasks.filter(t => t.status === 'success' || t.status === 'error');
  const hasError = tasks.some(t => t.status === 'error');

  return (
    <div ref={panelRef} style={{ position: 'relative', marginRight: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={`${running.length} 个进行中，${done.length} 个已完成`}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 8px', height: 30,
          background: hasError ? 'rgba(255,80,80,0.12)' : 'transparent',
          border: `1px solid ${hasError ? 'rgba(255,80,80,0.5)' : 'var(--color-border)'}`,
          borderRadius: 6, cursor: 'pointer',
          color: hasError ? '#ff6b6b' : 'var(--color-text)',
          fontSize: 12,
        }}
      >
        {running.length > 0 && (
          <span style={{
            width: 12, height: 12, border: '2px solid var(--color-border)',
            borderTopColor: 'var(--color-primary)', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
        )}
        {running.length > 0 ? `${running.length} 进行中` : done.length > 0 ? `${done.length} 已完成` : '任务'}
        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 36, zIndex: 1000,
          minWidth: 280, maxWidth: 380, maxHeight: 320,
          overflow: 'auto',
          background: 'var(--color-bg-elev, #2a2a2e)',
          border: '1px solid var(--color-border)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          padding: 4,
        }}>
          {tasks.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
              暂无后台任务
            </div>
          )}
          {tasks.map(t => (
            <div key={t.id} style={{
              padding: '8px 10px',
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 12,
              borderBottom: '1px solid var(--color-border)',
            }}>
              <TaskIcon status={t.status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: t.status === 'error' ? '#ff6b6b' : 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.label}
                </div>
                {t.message && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.message}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>
                {formatRelativeTime(t.createdAt)}
              </span>
            </div>
          ))}
          {done.length > 0 && (
            <button
              onClick={onClearCompleted}
              style={{
                width: '100%', padding: '6px 10px',
                background: 'transparent', border: 'none',
                color: 'var(--color-text-muted)', fontSize: 11,
                cursor: 'pointer', textAlign: 'center',
              }}
            >
              清除已完成
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TaskIcon({ status }: { status: string }) {
  const base: React.CSSProperties = { width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (status === 'running' || status === 'pending') {
    return (
      <span style={{ ...base }}>
        <span style={{
          width: 12, height: 12, border: '2px solid var(--color-border)',
          borderTopColor: 'var(--color-primary)', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </span>
    );
  }
  if (status === 'success') {
    return <span style={{ ...base, color: '#4ade80' }}>✓</span>;
  }
  if (status === 'error') {
    return <span style={{ ...base, color: '#ff6b6b' }}>✗</span>;
  }
  return <span style={base}>•</span>;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return '刚刚';
  if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

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








