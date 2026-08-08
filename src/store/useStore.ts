import { create } from 'zustand';
import type { AssetFile, AssetAnalysis, ProjectGameData } from '../types/index';
import { listSnapshots } from '../core/snapshot';
import type { SnapshotInfo } from '../core/snapshot';

export type TaskStatus = 'pending' | 'running' | 'success' | 'error';

export interface BackgroundTask {
  id: string;
  label: string;
  status: TaskStatus;
  progress: number; // 0-100, -1 = indeterminate
  createdAt: number;
  message?: string;
}

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

  filterUsed: 'all' | 'disk' | 'refs' | 'used' | 'unused' | 'missing';
  setFilterUsed: (f: 'all' | 'disk' | 'refs' | 'used' | 'unused' | 'missing') => void;

  loading: boolean;
  error: string | null;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;

  tasks: BackgroundTask[];
  addTask: (t: Omit<BackgroundTask, 'id' | 'createdAt' | 'status' | 'progress'> & { status?: TaskStatus; progress?: number }) => string;
  updateTask: (id: string, patch: Partial<BackgroundTask>) => void;
  removeTask: (id: string) => void;
  clearCompletedTasks: () => void;

  snapshots: SnapshotInfo[];
  setSnapshots: (s: SnapshotInfo[]) => void;
  refreshSnapshots: (root: FileSystemDirectoryHandle | null | undefined) => Promise<void>;
}

let taskCounter = 0;
function nextTaskId() {
  taskCounter += 1;
  return `t_${Date.now().toString(36)}_${taskCounter}`;
}

export const useStore = create<Store>((set, get) => ({
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
  filterUsed: 'disk',
  setFilterUsed: (f) => set({ filterUsed: f }),
  loading: false,
  error: null,
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
  tasks: [],
  addTask: (t) => {
    const id = nextTaskId();
    const task: BackgroundTask = {
      id,
      label: t.label,
      status: t.status ?? 'running',
      progress: t.progress ?? -1,
      createdAt: Date.now(),
      message: t.message,
    };
    set({ tasks: [...get().tasks, task] });
    return id;
  },
  updateTask: (id, patch) => {
    set({ tasks: get().tasks.map(t => t.id === id ? { ...t, ...patch } : t) });
  },
  removeTask: (id) => {
    set({ tasks: get().tasks.filter(t => t.id !== id) });
  },
  clearCompletedTasks: () => {
    set({ tasks: get().tasks.filter(t => t.status !== 'success' && t.status !== 'error') });
  },
  snapshots: [],
  setSnapshots: (s) => set({ snapshots: s }),
  refreshSnapshots: async (root) => {
    if (!root) return;
    try {
      const list = await listSnapshots(root);
      set({ snapshots: list });
    } catch (e) {
      console.warn('[STORE] refreshSnapshots failed', e);
    }
  },
}));
