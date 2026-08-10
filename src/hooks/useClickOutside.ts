import { useEffect, useRef } from 'react';

/**
 * 点击组件外部时触发回调。
 * 用法：<div ref={useClickOutside(() => setOpen(false))}>...
 */
export function useClickOutside(onClickOutside: () => void, deps: unknown[] = []) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClickOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
