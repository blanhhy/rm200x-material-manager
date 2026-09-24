import iconv from 'iconv-lite';
import type { AssetCategory, AssetReference } from '../types/index';

/** Shift_JIS 半角假名区（U+FF61–U+FF9F） */
const HALF_WIDTH_KANA = /[\uFF61-\uFF9F]/;

/**
 * 还原「Shift_JIS 字节被项目编码误读」的素材引用名。
 *
 * 背景：日文游戏译成中文后通常以 GBK 写回（游戏编码决定显示文本如何解码），
 * 而翻译流程不碰素材引用名，它们的字节仍是 Shift_JIS —— 按 GBK 解码即乱码，
 * 游戏也就拿乱码名去请求素材，与磁盘上的原始文件名失联。
 * 本函数把名字还原成原始日文名（写回时即以项目编码 = GBK 落盘），
 * 既恢复可读性，也让引用重新对上素材文件。
 *
 * 返回 null 表示无需/不能转换：
 *  - ASCII 名（两种编码字节相同，还原结果不变）
 *  - 原始字节不是合法 Shift_JIS 序列（含替换字符）
 *  - 还原结果是半角假名 —— 说明原名本就是正确编码的 GBK 文本，跳过以免二次转换损坏
 *  - 还原结果无法用项目编码表示（写回会丢字）
 */
export function sjisNameToGbk(name: string, projectEnc: string): string | null {
  if (!name) return null;
  if (name.includes('\uFFFD')) return null;
  // 还原文件里的原始字节：按项目编码解码得到的名字，编码回去即原始字节
  const raw = iconv.encode(name, projectEnc);
  if (raw.length === 0) return null;
  const decoded = iconv.decode(raw, 'shift_jis');
  if (decoded === name) return null;
  if (decoded.includes('\uFFFD')) return null;
  if (HALF_WIDTH_KANA.test(decoded)) return null;
  if (iconv.decode(iconv.encode(decoded, projectEnc), projectEnc) !== decoded) return null;
  return decoded;
}

export interface GbkConvertItem {
  category: AssetCategory;
  oldName: string;
  newName: string;
}

/** 从引用集合计算「Shift_JIS 误读名 → 原始日文名」的唯一转换清单。 */
export function buildGbkConvertPlan(
  refs: Iterable<Pick<AssetReference, 'category' | 'assetName'>>,
  projectEnc: string,
): GbkConvertItem[] {
  const seen = new Map<string, GbkConvertItem>();
  for (const r of refs) {
    if (!r.assetName) continue;
    const converted = sjisNameToGbk(r.assetName, projectEnc);
    if (!converted) continue;
    const key = `${r.category}\u0000${r.assetName.trim().toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, { category: r.category, oldName: r.assetName.trim(), newName: converted });
  }
  return Array.from(seen.values());
}