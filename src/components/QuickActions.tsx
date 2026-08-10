import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useClickOutside } from '../hooks/useClickOutside';
import type { BatchAction } from './BatchModal';

interface Props {
  onAction: (a: BatchAction) => void;
}

export default function QuickActions({ onAction }: Props) {
  const { gameData } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

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
