import type { AssetCategory, AssetFile, AssetReference, AssetAnalysis } from '../types/index';

export function buildAnalyses(
  diskAssets: AssetFile[],
  refs: AssetReference[],
): { allAssets: AssetFile[]; analyses: Map<string, AssetAnalysis> } {
  const key = (cat: AssetCategory, stem: string) => `${cat}/${stem.toLowerCase()}`;
  const allAssets: AssetFile[] = [...diskAssets];
  const analyses = new Map<string, AssetAnalysis>();

  for (const a of diskAssets) {
    analyses.set(key(a.category, a.stem), { asset: a, references: [], inDatabase: false, onDisk: true });
  }

  for (const ref of refs) {
    const k = key(ref.category, ref.assetName);
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
      entry = { asset: vAsset, references: [], inDatabase: false, onDisk: false };
      analyses.set(k, entry);
    }
    entry.references.push(ref);
    entry.inDatabase = true;
  }

  return { allAssets, analyses };
}
