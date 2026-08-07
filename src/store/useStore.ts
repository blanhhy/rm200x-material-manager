import { create } from 'zustand';
import type { AssetFile, AssetAnalysis, ProjectGameData } from '../types/index';

interface Store {
  gameData: ProjectGameData | null;
  setGameData: (d: ProjectGameData | null) => void;

  assets: AssetFile[];
  setAssets: (a: AssetFile[]) => void;

  analyses: Map<string, AssetAnalysis>;
  setAnalyses: (a: Map<string, AssetAnalysis>) => void;

  activeCategory: string;
  setActiveCategory: (c: string) => void;
  selectedAssetKey: string | null;
  setSelectedAssetKey: (k: string | null) => void;

  filterUsed: 'all' | 'used' | 'unused';
  setFilterUsed: (f: 'all' | 'used' | 'unused') => void;

  loading: boolean;
  error: string | null;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useStore = create<Store>((set) => ({
  gameData: null,
  setGameData: (d) => set({ gameData: d }),
  assets: [],
  setAssets: (a) => set({ assets: a }),
  analyses: new Map(),
  setAnalyses: (a) => set({ analyses: a }),
  activeCategory: 'ChipSet',
  setActiveCategory: (c) => set({ activeCategory: c }),
  selectedAssetKey: null,
  setSelectedAssetKey: (k) => set({ selectedAssetKey: k }),
  filterUsed: 'all',
  setFilterUsed: (f) => set({ filterUsed: f }),
  loading: false,
  error: null,
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
}));
