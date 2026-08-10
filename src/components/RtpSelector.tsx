import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useClickOutside } from '../hooks/useClickOutside';
import { initBuiltinRtp, scanDiskRtpFileSet, initDiskRtp, activateDiskRtp } from '../core/rtpIndex';

export default function RtpSelector() {
  const { gameData, activeRtpSourceId, setActiveRtpSourceId } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [diskSources, setDiskSources] = useState<{ id: string; label: string; stats: string }[]>([]);
  const menuRef = useClickOutside(() => setMenuOpen(false));

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
      if (!activateDiskRtp(id)) return;
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
