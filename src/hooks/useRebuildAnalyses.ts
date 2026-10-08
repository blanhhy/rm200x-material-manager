import { useStore } from '../store/useStore';
import { traceAllReferences } from '../core/referenceTracker';
import { buildAnalyses } from '../core/assetAnalyzer';
import { resolvePathRefAssets } from '../scanner/pathRefAssets';
import type { AssetAnalysis, AssetFile, ProjectGameData } from '../types/index';

/** 追踪引用 → 解析相对路径引用 → 构建分析 → 写入 store。返回 analyses Map 供诊断使用 */
export function useRebuildAnalyses() {
  const setAssets = useStore(s => s.setAssets);
  const setAnalyses = useStore(s => s.setAnalyses);

  return async function rebuild(data: ProjectGameData, diskAssets: AssetFile[]): Promise<Map<string, AssetAnalysis>> {
    const refs = traceAllReferences(data);
    const allDisk = data.rootHandle
      ? [...diskAssets, ...(await resolvePathRefAssets(data.rootHandle, refs))]
      : diskAssets;
    const { allAssets, analyses: map } = buildAnalyses(allDisk, refs, data.engine);
    setAssets(allAssets);
    setAnalyses(map);
    return map;
  };
}
