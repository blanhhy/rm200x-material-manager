import { useState } from 'react';
import type { AssetFile } from '../types/index';

export function useSelection(filteredAssets: AssetFile[]) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  function toggleSelect(k: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedKeys(new Set(filteredAssets.map(a => `${a.category}/${a.stem.toLowerCase()}`)));
  }

  function invertSelection() {
    const all = new Set(filteredAssets.map(a => `${a.category}/${a.stem.toLowerCase()}`));
    setSelectedKeys(prev => {
      const next = new Set<string>();
      for (const k of all) if (!prev.has(k)) next.add(k);
      return next;
    });
  }

  return { selectedKeys, setSelectedKeys, toggleSelect, selectAllFiltered, invertSelection };
}
