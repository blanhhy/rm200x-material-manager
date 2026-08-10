import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useClickOutside } from '../hooks/useClickOutside';

interface Props {
  onOpen: () => void;
  onClose: () => void;
  assetCount: number;
  mapCount: number;
  onEncodingChange: (enc: string) => void;
}

export default function WorkspaceSelector({
  onOpen, onClose, assetCount, mapCount, onEncodingChange,
}: Props) {
  const { gameData, loading, error } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useClickOutside(() => setMenuOpen(false));

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
