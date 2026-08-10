import { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { getCategories } from '../scanner/assetTypes';

export type BatchAction = 'injectRtp' | 'cleanUnused' | 'clearMissing';

const LABELS: Record<BatchAction, string> = {
  injectRtp: '注入RTP',
  cleanUnused: '清理无用素材',
  clearMissing: '清除无效引用',
};

interface Props {
  action: BatchAction;
  onClose: () => void;
  onConfirm: (cats: string[]) => Promise<void>;
}

export default function BatchModal({ action, onClose, onConfirm }: Props) {
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
          {LABELS[action]}
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
