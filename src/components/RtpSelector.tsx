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
      if (!result) { alert('所选目录不包含任何有效的 RTP 素材子目录（如 Backdrop、ChipSet、Music 等）。'); return; }
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
    if (id === 'builtin' && gameData) { initBuiltinRtp(gameData.engine); }
    else if (id !== 'builtin') { if (!activateDiskRtp(id)) return; }
    setActiveRtpSourceId(id);
    setMenuOpen(false);
  }

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button onClick={() => setMenuOpen(!menuOpen)} className="toolbarBtn" style={{ gap: 6, opacity: gameData ? 1 : 0.5 }} title="选择 RTP 素材来源">
        <span>{currentLabel}</span>
        <span className="dropdownArrow">▾</span>
      </button>

      {menuOpen && (
        <div className="popupMenu" style={{ minWidth: 220, padding: 4 }}>
          <button onClick={() => handleSelect('builtin')} className="dropdownItem"
            data-active={activeRtpSourceId === 'builtin' || undefined}>
            内置RTP<br />
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>预置图片与音频素材</span>
          </button>

          {diskSources.map(s => (
            <button key={s.id} onClick={() => handleSelect(s.id)} className="dropdownItem" style={{ marginTop: 2 }}
              data-active={activeRtpSourceId === s.id || undefined}>
              {s.label}<br />
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{s.stats}</span>
            </button>
          ))}

          <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />

          <button onClick={handleAddDiskRtp} className="dropdownItem" style={{ color: 'var(--color-primary-text)' }}>
            + 添加本地 RTP 目录...
          </button>
        </div>
      )}
    </div>
  );
}
