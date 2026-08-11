import { EventCommandCode as EventCmdCode } from 'rpgrt';
import type { AssetCategory } from '../../types/index';

/**
 * LCF 字段 / 事件命令码 → 素材类别的权威映射。
 *
 * 引用扫描（referenceTracker）与批量改写（dbTraversal）两侧共用本模块，
 * 任何字段与类别的对应关系只在这里定义一次。
 */

/** 事件命令码 → 引用的素材类别 */
export function refCatForEventCode(code: number): AssetCategory | null {
  switch (code) {
    case EventCmdCode.ChangeFaceGraphic:       return 'FaceSet';
    case EventCmdCode.ChangeSpriteAssociation: return 'CharSet';
    case EventCmdCode.ChangeActorFace:         return 'FaceSet';
    case EventCmdCode.ChangeVehicleGraphic:    return 'CharSet';
    case EventCmdCode.ChangeSystemBGM:         return 'Music';
    case EventCmdCode.ChangeSystemSFX:         return 'Sound';
    case EventCmdCode.ChangeSystemGraphics:    return 'System';
    case EventCmdCode.ChangeScreenTransitions: return 'System';
    case EventCmdCode.ShowPicture:             return 'Picture';
    case EventCmdCode.PlayBGM:                 return 'Music';
    case EventCmdCode.PlaySound:               return 'Sound';
    case EventCmdCode.PlayMovie:               return 'Movie';
    case EventCmdCode.ChangePBG:               return 'Panorama';
    case EventCmdCode.ChangeBattleBG:          return 'Backdrop';
    default: return null;
  }
}

/**
 * System 表中直接存素材文件名（纯字符串）的字段 → 素材类别。
 *
 * ⚠️ 字段挂在 System 表下 ≠ 引用 System/ 目录的素材。
 * 这里每个字段指向的目录都不同，不要按字段名望文生义归并。
 */
export const SYSTEM_STRING_FIELDS: Array<[field: string, category: AssetCategory]> = [
  // 载具行走图
  ['boatName', 'CharSet'],
  ['shipName', 'CharSet'],
  ['airshipName', 'CharSet'],
  // 图片类，各自独立目录
  ['titleName', 'Title'],
  ['gameoverName', 'GameOver'],
  ['systemName', 'System'],
  ['system2Name', 'System2'],
  ['frameName', 'Frame'],
  ['battletestBackground', 'Backdrop'],
];

/** System 表中存 Music / Sound 结构（文件名在 .name 上）的字段 → 素材类别 */
export const SYSTEM_AUDIO_FIELDS: Array<[field: string, category: AssetCategory]> = [
  ['titleMusic', 'Music'],
  ['battleMusic', 'Music'],
  ['battleEndMusic', 'Music'],
  ['innMusic', 'Music'],
  ['boatMusic', 'Music'],
  ['shipMusic', 'Music'],
  ['airshipMusic', 'Music'],
  ['gameoverMusic', 'Music'],
  ['cursorSe', 'Sound'],
  ['decisionSe', 'Sound'],
  ['cancelSe', 'Sound'],
  ['buzzerSe', 'Sound'],
  ['battleSe', 'Sound'],
  ['escapeSe', 'Sound'],
  ['enemyAttackSe', 'Sound'],
  ['enemyDamagedSe', 'Sound'],
  ['actorDamagedSe', 'Sound'],
  ['dodgeSe', 'Sound'],
  ['enemyDeathSe', 'Sound'],
  ['itemSe', 'Sound'],
];
