import { useEffect, useRef } from 'react';

/**
 * 点击组件外部时触发回调。
 * 用法：<div ref={useClickOutside(() => setOpen(false))}>...
 * 用 ref 保存最新回调，避免因闭包过期导致调用旧版本的回调函数。
 */
export function useClickOutside(onClickOutside: () => void, deps: unknown[] = []) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onClickOutside);

  useEffect(() => {
    cbRef.current = onClickOutside;
  }, [onClickOutside]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cbRef.current();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
