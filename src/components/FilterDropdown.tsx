import { useState } from 'react';
import { useClickOutside } from '../hooks/useClickOutside';

export const FILTER_OPTIONS = ['all', 'disk', 'refs', 'used', 'unused', 'rtp', 'missing'] as const;
export const FILTER_LABEL: Record<string, string> = {
  all: '全部', disk: '素材库', refs: '数据库',
  used: '已使用', unused: '未使用', rtp: 'RTP', missing: '缺失',
};

interface Props {
  value: (typeof FILTER_OPTIONS)[number];
  onChange: (f: (typeof FILTER_OPTIONS)[number]) => void;
  disabled?: boolean;
}

export default function FilterDropdown({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => !disabled && setOpen(!open)} disabled={disabled}
        style={{ padding: '4px 0', fontSize: 12, background: 'transparent', border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer', color: 'var(--color-text)',
          opacity: disabled ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 2 }}>
        {FILTER_LABEL[value]}
        <span className="dropdownArrow">▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2,
          minWidth: 100, background: 'var(--color-bg-elev)', border: '1px solid var(--color-border)',
          borderRadius: 6, boxShadow: '0 6px 16px rgba(0,0,0,0.12)', zIndex: 1000, padding: 4 }}>
          {FILTER_OPTIONS.map(f => (
            <button key={f} onClick={() => { setOpen(false); onChange(f); }} className="dropdownItem" style={{ padding: '5px 10px' }}
              data-active={value === f || undefined}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
