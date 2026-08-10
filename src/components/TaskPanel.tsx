import { useState } from 'react';
import { useClickOutside } from '../hooks/useClickOutside';
import type { BackgroundTask } from '../store/useStore';

function TaskIcon({ status }: { status: string }) {
  const base: React.CSSProperties = { width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (status === 'running' || status === 'pending') {
    return <span style={base}><div className="loadingSpinnerSmall" /></span>;
  }
  if (status === 'success') return <span style={{ ...base, color: '#4ade80' }}>✓</span>;
  if (status === 'error') return <span style={{ ...base, color: '#ff6b6b' }}>✗</span>;
  return <span style={base}>•</span>;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return '刚刚';
  if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

interface Props { tasks: BackgroundTask[]; onClearCompleted: () => void; }

export default function TaskPanel({ tasks, onClearCompleted }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useClickOutside(() => setOpen(false), [open]);

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
        {running.length > 0 && <div className="loadingSpinnerSmall" />}
        {running.length > 0 ? `${running.length} 进行中` : done.length > 0 ? `${done.length} 已完成` : '任务'}
        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 36, zIndex: 1000,
          minWidth: 280, maxWidth: 380, maxHeight: 320, overflow: 'auto',
          background: 'var(--color-bg-elev, #2a2a2e)',
          border: '1px solid var(--color-border)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          padding: 4,
        }}>
          {tasks.length === 0 && (
            <div className="popupMenuEmpty">暂无后台任务</div>
          )}
          {tasks.map(t => (
            <div key={t.id} style={{
              padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 12, borderBottom: '1px solid var(--color-border)',
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
            <button onClick={onClearCompleted} style={{
              width: '100%', padding: '6px 10px', background: 'transparent', border: 'none',
              color: 'var(--color-text-muted)', fontSize: 11, cursor: 'pointer', textAlign: 'center',
            }}>清除已完成</button>
          )}
        </div>
      )}
    </div>
  );
}
