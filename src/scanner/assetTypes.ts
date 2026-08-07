import type { AssetCategory } from '../types/index';

// 严格对应 RM2k/2k3 标准磁盘目录（来自 EasyRPG Editor defines.h）
// 一对一映射，每个文件夹独立成 category
export const DIR_TO_CATEGORY: Record<string, AssetCategory> = {
  chipset:       'ChipSet',
  charset:       'CharSet',
  faceset:       'FaceSet',
  backdrop:      'Backdrop',
  battle:        'Battle',
  battle2:       'Battle2',
  battlecharset: 'BattleCharSet',
  battleweapon:  'BattleWeapon',
  monster:       'Monster',
  panorama:      'Panorama',
  picture:       'Picture',
  system:        'System',
  system2:       'System2',
  title:         'Title',
  gameover:      'GameOver',
  frame:         'Frame',
  music:         'Music',
  sound:         'Sound',
  movie:         'Movie',
};

// 反查表：category → 磁盘目录列表（通常只有一个）
export const CATEGORY_DIRS: Record<AssetCategory, string[]> = {
  ChipSet:      ['chipset'],
  CharSet:      ['charset'],
  FaceSet:      ['faceset'],
  Backdrop:     ['backdrop'],
  Battle:       ['battle'],
  Battle2:      ['battle2'],
  BattleCharSet: ['battlecharset'],
  BattleWeapon:  ['battleweapon'],
  Monster:      ['monster'],
  Panorama:     ['panorama'],
  Picture:      ['picture'],
  System:       ['system'],
  System2:      ['system2'],
  Title:        ['title'],
  GameOver:     ['gameover'],
  Frame:        ['frame'],
  Music:        ['music'],
  Sound:        ['sound'],
  Movie:        ['movie'],
};

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
  Music:        ['.mid', '.midi', '.wav', '.ogg'],
  Sound:        ['.wav', '.ogg'],
  Movie:        ['.avi', '.mpg'],
};

export function matchesCategory(ext: string, category: AssetCategory): boolean {
  return CATEGORY_EXTS[category].includes(ext.toLowerCase());
}
