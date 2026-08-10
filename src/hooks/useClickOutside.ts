import { useEffect, useRef } from 'react';

/**
 * 点击组件外部时触发回调。
 * 用法：<div ref={useClickOutside(() => setOpen(false))}>...
 * 用 ref 保存最新回调，事件监听器只注册一次，无闭包过期问题。
 */
export function useClickOutside(onClickOutside: () => void) {
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
  }, []);
  return ref;
}
