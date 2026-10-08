import type { AssetFile, AssetReference, AssetAnalysis, EngineVersion } from '../types/index';
import { isRTPAsset } from './rtpIndex';
import { diskAssetKey, refAnalysisKey } from './assetPath';

export function buildAnalyses(
  diskAssets: AssetFile[],
  refs: AssetReference[],
  engine?: EngineVersion,
): { allAssets: AssetFile[]; analyses: Map<string, AssetAnalysis> } {
  const allAssets: AssetFile[] = [...diskAssets];
  const analyses = new Map<string, AssetAnalysis>();

  for (const a of diskAssets) {
    analyses.set(diskAssetKey(a), { asset: a, references: [], inDatabase: false, onDisk: true, inRtp: false });
  }

  for (const ref of refs) {
    const k = refAnalysisKey(ref.category, ref.assetName);
    let entry = analyses.get(k);
    if (!entry) {
      const vAsset: AssetFile = {
        name: ref.assetName,
        stem: ref.assetName,
        category: ref.category,
        path: `${ref.category}/${ref.assetName}`,
        size: 0,
        ext: '',
      };
      allAssets.push(vAsset);
      const inRtp = engine ? isRTPAsset(ref.assetName, ref.category, engine) : false;
      entry = { asset: vAsset, references: [], inDatabase: false, onDisk: false, inRtp };
      analyses.set(k, entry);
    }
    entry.references.push(ref);
    entry.inDatabase = true;
  }

  return { allAssets, analyses };
}
