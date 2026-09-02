import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useClickOutside } from '../hooks/useClickOutside';
import type { BatchAction } from './BatchModal';

interface Props { onAction: (a: BatchAction) => void; }

export default function QuickActions({ onAction }: Props) {
  const { gameData } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  if (!gameData) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} className="toolbarBtn">
        <span>便捷功能</span>
        <span className="dropdownArrow">▾</span>
      </button>
      {open && (
        <div className="popupMenuRight" style={{ minWidth: 160 }}>
          {([
            ['injectRtp', '注入RTP', '将所选RTP源中的素材复制到项目目录'],
            ['normalizeRtp', 'RTP标准化', '将所有RTP引用重命名为英文标准名'],
            ['cleanUnused', '清理无用素材', '删除磁盘上有但数据库未引用的素材'],
            ['clearMissing', '清除无效引用', '清除指向已缺失素材的数据库引用'],
          ] as const).map(([id, label, desc]) => (
            <button key={id} onClick={() => { setOpen(false); onAction(id); }} className="dropdownItem" title={desc}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
