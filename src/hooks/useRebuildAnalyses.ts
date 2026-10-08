import { useStore } from '../store/useStore';
import { traceAllReferences } from '../core/referenceTracker';
import { buildAnalyses } from '../core/assetAnalyzer';
import { resolvePathRefAssets } from '../scanner/pathRefAssets';
import { diskAssetKey } from '../core/assetPath';
import type { AssetAnalysis, AssetFile, ProjectGameData } from '../types/index';

/** 追踪引用 → 解析相对路径引用 → 构建分析 → 写入 store。返回 analyses Map 供诊断使用 */
export function useRebuildAnalyses() {
  const setAssets = useStore(s => s.setAssets);
  const setAnalyses = useStore(s => s.setAnalyses);

  return async function rebuild(data: ProjectGameData, diskAssets: AssetFile[]): Promise<Map<string, AssetAnalysis>> {
    const refs = traceAllReferences(data);

    // 相对路径引用解析出的目标可能与传入的磁盘资产重叠（例如调用方手里还留着改名前的
    // 内存条目），按身份键去重，否则同一个文件会出现两张卡片共用一个分析条目
    const allDisk = diskAssets.slice();
    if (data.rootHandle) {
      const seen = new Set(allDisk.map(diskAssetKey));
      for (const extra of await resolvePathRefAssets(data.rootHandle, refs)) {
        const k = diskAssetKey(extra);
        if (seen.has(k)) continue;
        seen.add(k);
        allDisk.push(extra);
      }
    }

    const { allAssets, analyses: map } = buildAnalyses(allDisk, refs, data.engine);
    setAssets(allAssets);
    setAnalyses(map);
    return map;
  };
}