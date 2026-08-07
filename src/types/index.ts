// AssetCategory 严格对应 RM2k/2k3 标准磁盘目录（来自 EasyRPG Editor defines.h）
// 每个文件夹就是独立类别，不做合并
export type AssetCategory =
  | 'ChipSet'
  | 'CharSet'
  | 'FaceSet'
  | 'Backdrop'       // 战斗背景图（terrain.backgroundA/BName, cmd 13210, system.battletestBackground）
  | 'Battle'         // 战斗动画帧（DB animations[].animationName → 优先 Battle2，fallback Battle）
  | 'Battle2'        // 战斗动画帧 v2（同上）
  | 'BattleCharSet'  // 战斗角色精灵（actor/pose 的 battlerName）
  | 'BattleWeapon'   // 战斗武器精灵（battlerAnimation.weapon[].weaponName）
  | 'Monster'        // 敌人精灵（enemy.battlerName）
  | 'Panorama'       // 远景图（terrain.backgroundName, map.parallaxName）
  | 'Picture'        // Picture/（ShowPicture, ChangeBattleBG 的 cmd 13210 也用 Backdrop）
  | 'System'         // System/（system.systemName 等）
  | 'System2'        // System2/
  | 'Title'          // Title/（system.titleName）
  | 'GameOver'       // GameOver/（system.gameoverName）
  | 'Frame'          // Frame/（system.frameName）
  | 'Music'          // Music/（所有音乐：BGM/BGS/ME 在 RM2K3 里不分目录）
  | 'Sound'          // Sound/（所有音效）
  | 'Movie';         // Movie/

export interface AssetFile {
  name: string;          // 文件名（含扩展名）
  stem: string;          // 不含扩展名的主名
  category: AssetCategory;
  path: string;          // 相对项目根的路径，如 "Picture/xxx.png"
  size: number;          // 文件字节数
  ext: string;           // 扩展名小写
  handle?: FileSystemFileHandle;
}

export interface AssetReference {
  category: AssetCategory;         // 素材类别
  assetName: string;               // 被引用素材名（主名，不含扩展名）
  location: ReferenceLocation;
}

export type ReferenceLocation =
  | { kind: 'System'; field: string }
  | { kind: 'Actor'; actorId: number; field: string }
  | { kind: 'Terrain'; terrainId: number; field: string }
  | { kind: 'MapInfo'; mapId: number; field: string }
  | { kind: 'MapUnit'; mapId: number; field: string }
  | { kind: 'Event'; mapId: number; eventId: number; pageId: number; field: string }
  | { kind: 'MoveRoute'; mapId: number; eventId: number; pageId: number; commandIdx: number; field: string }
  | { kind: 'CommonEvent'; ceId: number; field: string }
  | { kind: 'ChipsetRef'; chipsetId: number; field: string }
  | { kind: 'TroopPage'; troopId: number; pageIdx: number; field: string }
  | { kind: 'Unknown'; note: string };

import type { Database, MapUnit, MapInfo, TreeMap } from 'rpgrt';

export type EngineVersion = '2k' | '2k3';
export type EncodingName = 'shift_jis' | 'gbk' | 'euc_jp' | 'utf8' | 'latin1';

export interface ProjectGameData {
  rootHandle: FileSystemDirectoryHandle;
  database: Database | null;
  treeMap: TreeMap | null;
  maps: Map<number, MapUnit>;
  mapInfos: Map<number, MapInfo>;
  encoding: EncodingName | string;
  engine: EngineVersion;
  rpgIni: Record<string, Record<string, string>> | null;
  rawIni: Uint8Array | null;
  rawLdb?: Uint8Array | null;
  rawLmt?: Uint8Array | null;
}

export interface AssetAnalysis {
  asset: AssetFile;
  references: AssetReference[];
  inDatabase: boolean;
  onDisk: boolean;
}
