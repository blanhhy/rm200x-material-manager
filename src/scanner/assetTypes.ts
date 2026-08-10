import type { AssetCategory } from '../types/index';

// RM2k/2k3 standard disk directories (from EasyRPG Editor defines.h)
export const ASSET_DIRECTORIES = [
  'Backdrop',
  'Battle',
  'Battle2',
  'BattleCharSet',
  'BattleWeapon',
  'CharSet',
  'ChipSet',
  'FaceSet',
  'Frame',
  'GameOver',
  'Monster',
  'Movie',
  'Music',
  'Panorama',
  'Picture',
  'Sound',
  'System',
  'System2',
  'Title',
] as const satisfies ReadonlyArray<AssetCategory>;

// 受支持的素材文件扩展名（唯一权威来源）
export const CATEGORY_EXTS: Record<AssetCategory, string[]> = {
  ChipSet:      ['.png', '.bmp', '.xyz'],
  CharSet:      ['.png', '.bmp', '.xyz'],
  FaceSet:      ['.png', '.bmp', '.xyz'],
  Backdrop:     ['.png', '.bmp', '.xyz'],
  Battle:       ['.png', '.bmp', '.xyz'],
  Battle2:      ['.png', '.bmp', '.xyz'],
  BattleCharSet: ['.png', '.bmp', '.xyz'],
  BattleWeapon:  ['.png', '.bmp', '.xyz'],
  Monster:      ['.png', '.bmp', '.xyz'],
  Panorama:     ['.png', '.bmp', '.xyz'],
  Picture:      ['.png', '.bmp', '.xyz'],
  System:       ['.png', '.bmp', '.xyz'],
  System2:      ['.png', '.bmp', '.xyz'],
  Title:        ['.png', '.bmp', '.xyz'],
  GameOver:     ['.png', '.bmp', '.xyz'],
  Frame:        ['.png', '.bmp', '.xyz'],
  Music:        ['.mid', '.midi', '.wav', '.ogg', '.mp3'],
  Sound:        ['.wav', '.ogg', '.mp3'],
  Movie:        ['.avi', '.mpg', '.mpeg'],
};

/** 取类别的首选扩展名（列表第一项） */
export function getPrimaryExt(category: AssetCategory): string {
  return CATEGORY_EXTS[category][0];
}

/** 2k3 独有类别（RM2k 中不存在） */
export const V2K3_ONLY_CATEGORIES = new Set<AssetCategory>([
  'Battle2', 'BattleCharSet', 'BattleWeapon', 'System2', 'Frame',
]);

/** 图片素材类别（ASSET_DIRECTORIES 中排除音频和视频） */
export const IMAGE_CATEGORIES: readonly AssetCategory[] = ASSET_DIRECTORIES.filter(
  c => c !== 'Music' && c !== 'Sound' && c !== 'Movie',
);

/** 根据引擎版本获取有效素材目录列表 */
export function getCategories(engine: '2k' | '2k3'): readonly AssetCategory[] {
  if (engine === '2k3') return ASSET_DIRECTORIES;
  return ASSET_DIRECTORIES.filter(c => !V2K3_ONLY_CATEGORIES.has(c));
}

/** 数据库文件的扩展名 */
export const DB_FILE_EXTS = ['.ldb', '.lmt', '.lmu'] as const;
