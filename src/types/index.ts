// RPG Maker 200x 素材类别，每类对应一个文件夹
export type AssetCategory =
  | 'ChipSet'        // 地图芯片集
  | 'CharSet'        // 角色集
  | 'FaceSet'        // 角色脸图集
  | 'Backdrop'       // 战斗背景图
  | 'Battle'         // 战斗动画帧
  | 'Battle2'        // 2k3特有的战斗动画帧 v2
  | 'BattleCharSet'  // 2k3特有的战斗角色精灵
  | 'BattleWeapon'   // 2k3特有的战斗武器精灵
  | 'Monster'        // 敌人立绘
  | 'Panorama'       // 地图远景
  | 'Picture'        // 由命令自由显示的图片素材
  | 'System'         // 系统贴图（控制主题样式）
  | 'System2'        // 2k3特有的增补系统贴图
  | 'Title'          // 开始画面图像
  | 'GameOver'       // 游戏结束图像
  | 'Frame'          // 2k3特有的游戏边框贴图
  | 'Music'          // BGM（会循环播放的长音频）
  | 'Sound'          // 音效（只播放一次的短音频）
  | 'Movie';         // 由命令自由播放的视频素材

export interface AssetFile {
  name: string;
  stem: string;
  category: AssetCategory;
  path: string;
  size: number;
  ext: string;
  width?: number;
  height?: number;
  handle?: FileSystemFileHandle;
  prefetchedData?: ArrayBuffer;
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
  | { kind: 'Event'; mapId: number; eventId: number; pageId: number; commandIdx?: number; cmdName?: string; subIdx?: number; field: string }
  | { kind: 'MoveRoute'; mapId: number; eventId: number; pageId: number; commandIdx: number; routeCmdIdx?: number; field: string }
  | { kind: 'CommonEvent'; ceId: number; commandIdx?: number; cmdName?: string; subIdx?: number; field: string }
  | { kind: 'ChipsetRef'; chipsetId: number; field: string }
  | { kind: 'TroopPage'; troopId: number; pageIdx: number; field: string }
  | { kind: 'Unknown'; note: string };

import type { Database, MapUnit, MapInfo, TreeMap } from 'rpgrt';

export type EngineVersion = '2k' | '2k3';
export type EncodingName = 'shift_jis' | 'gbk' | 'eucjp' | 'utf8' | 'latin1';

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
  inRtp: boolean;
}
