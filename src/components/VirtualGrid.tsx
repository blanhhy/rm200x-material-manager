import { useEffect, useRef, useState } from 'react';

interface VirtualGridProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  cardMinWidth?: number;
  gap?: number;
  cardHeight: number;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  overscan?: number;
}

export default function VirtualGrid<T>({
  items,
  renderItem,
  cardMinWidth = 210,
  gap = 10,
  cardHeight,
  scrollContainerRef,
  overscan = 3,
}: VirtualGridProps<T>) {
  const [columns, setColumns] = useState(1);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const rowHeight = cardHeight + gap;

  // 测量容器宽度 → 计算列数
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) {
          const cols = Math.max(1, Math.floor((w + gap) / (cardMinWidth + gap)));
          setColumns(cols);
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cardMinWidth, gap]);

  // 监听父容器滚动 + 尺寸
  useEffect(() => {
    const sc = scrollContainerRef.current;
    if (!sc) return;

    const onScroll = () => {
      setScrollTop(sc.scrollTop);
    };
    const onResize = () => {
      setViewportHeight(sc.clientHeight);
      setScrollTop(sc.scrollTop);
    };

    sc.addEventListener('scroll', onScroll, { passive: true });
    setViewportHeight(sc.clientHeight);

    const ro = new ResizeObserver(onResize);
    ro.observe(sc);

    return () => {
      sc.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [scrollContainerRef]);

  const totalRows = Math.ceil(items.length / columns);
  const totalHeight = totalRows * rowHeight;

  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);

  const startIdx = startRow * columns;
  const endIdx = Math.min(items.length, endRow * columns);
  const visibleItems = items.slice(startIdx, endIdx);

  const topPad = startRow * rowHeight;
  const bottomPad = totalHeight - endRow * rowHeight;

  return (
    <div
      ref={wrapperRef}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: `${gap}px`,
        paddingTop: topPad,
        paddingBottom: bottomPad,
      }}
    >
      {visibleItems.map((item, i) => (
        <div key={startIdx + i} style={{ height: cardHeight, minWidth: 0, overflow: 'hidden' }}>
          {renderItem(item, startIdx + i)}
        </div>
      ))}
    </div>
  );
}
