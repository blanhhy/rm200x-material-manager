import type { AssetCategory } from '../types/index';

/**
 * 素材图片的「子图块单元」划分。
 *
 * RM 的最小素材单位是子图区域（ChipSet 是 16×16 的基础图块），但最小可引用单位是一整张图。
 * 本模块把一张素材图按该类别的切分规则切成若干**单元**，并给出「哪些 tile ID / 索引会用到这个单元」，
 * 供 UI 画出网格、判定已用/未用。
 *
 * 结论依据 EasyRPG Player（权威运行时），见文件内各处的行号注释。
 */

export type TileLayer = 'lower' | 'upper';

export interface TileUnit {
  /** 稳定标识，如 'A1' / 'D5' / 'E012' / 'F034' */
  id: string;
  /** 显示名 */
  label: string;
  /** 自动图块（由多块基础图块合成一个单元）还是单个基础图块 */
  kind: 'autotile' | 'tile';
  /** 单元在图片上的像素矩形 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 该单元可用在哪些图层 */
  layers: TileLayer[];
  /** 该单元覆盖的 tile ID 区间（含端点），用于反查 */
  ranges: Array<[from: number, to: number]>;
}

export interface TileLayout {
  category: AssetCategory;
  /** 基础图块边长（像素） */
  tileSize: number;
  cols: number;
  rows: number;
  units: TileUnit[];
  /** 单元 id → 单元 */
  unitById: Map<string, TileUnit>;
}

/**
 * 一个 tile ID 触及的所有单元。
 *
 * 注意这是**多对多**：A/B/A2/C 四个槽是自动图块的"四分块素材来源"，
 * 运行时会把它们的 2×2 象限拼成最终图块（EasyRPG Player/src/tilemap_layer.cpp:473-568），
 * 所以一个 tile ID 可能同时用到两个槽。例如 block 0/1（`ID/1000`）的 B 象限取自 B 槽，
 * 且仅当 `b_subtile != 0` 时才取；而 block 2（A1 + Lower B，海洋）无论 `b_subtile` 为何都会取 B 槽的第 6/7 行。
 */
export function unitsForTileId(layout: TileLayout, tileId: number): TileUnit[] {
  const out: TileUnit[] = [];
  const push = (id: string) => {
    const u = layout.unitById.get(id);
    if (u) out.push(u);
  };

  if (tileId >= 0 && tileId < 1000) {
    // block 0：A1 + Upper B
    push('A1');
    if (tileId % 1000 >= 50) push('B');
  } else if (tileId >= 1000 && tileId < 2000) {
    // block 1：A2 + Upper B
    push('A2');
    if (tileId % 1000 >= 50) push('B');
  } else if (tileId >= 2000 && tileId < 3000) {
    // block 2：A1 + Lower B（B 必然参与）
    push('A1');
    push('B');
  } else if (tileId >= 3000 && tileId < 3150) {
    push('C');
  } else if (tileId >= 4000 && tileId < 4600) {
    push(`D${Math.floor((tileId - 4000) / 50) + 1}`);
  } else if (tileId >= BLOCK_E && tileId < BLOCK_E + BLOCK_E_TILES) {
    push(`E${tileId - BLOCK_E}`);
  } else if (tileId >= BLOCK_F && tileId < BLOCK_F + BLOCK_F_TILES) {
    push(`F${tileId - BLOCK_F}`);
  }
  return out;
}

/** ChipSet 图片标准尺寸 480×256（EasyRPG Player/src/cache.cpp:188） */
export const CHIPSET_WIDTH = 480;
export const CHIPSET_HEIGHT = 256;
/** 基础图块 16×16（EasyRPG Player/src/options.h:50 TILE_SIZE） */
export const TILE_SIZE = 16;
/** 一行 30 个基础图块（480/16），共 16 行 */
export const CHIPSET_COLS = 30;
export const CHIPSET_ROWS = 16;

/** E / F 块的 tile ID 基址与数量（EasyRPG Player/src/map_data.h:46-56） */
export const BLOCK_E = 5000;
export const BLOCK_F = 10000;
export const BLOCK_E_TILES = 144;
export const BLOCK_F_TILES = 144;

/**
 * 事件图像索引 ↔ tile ID 的换算偏移：`tileId = characterIndex + EVENT_TILE_OFFSET`。
 *
 * `EventPage.character_name` 为空时用图块当图像（EasyRPG `game_character.h:1311-1317`
 * `HasTileSprite() = GetSpriteName().empty()`），此时 `character_index + 10000` 就是 tile ID
 * （R48 `.tech_support/R48/app/.../Help/Main/MapEdit.scm:199-201`：
 * "The @character_index + 10000 is the tile ID displayed"；EasyRPG `cache.cpp:441-475`
 * 把索引 0-143 映射到 F 区，即 tile ID 10000-10143，与该换算是同一个规则）。
 *
 * Editor 只会写入上层 F 区（索引 0-143），但工具可以直接写入下层 tile ID，此时索引为负：
 * 例如 `GW2016_完全版` M25E35 第 2/3 页的 `-4953/-4983` → tile ID `5047/5017` → E47/E17。
 */
export const EVENT_TILE_OFFSET = BLOCK_F;

const px = (col: number, row: number, w = 1, h = 1) => ({
  x: col * TILE_SIZE,
  y: row * TILE_SIZE,
  w: w * TILE_SIZE,
  h: h * TILE_SIZE,
});

/**
 * 左边 4×4 共 16 个自动图块单元，每个占 3 列 × 4 行基础图块
 * （即 cols 0-11 × rows 0-15 = 192×256，正好铺满、无重叠无空隙）。
 *
 * 槽位与 tile ID 的对应来自 EasyRPG Player/src/tilemap_layer.cpp：
 *  - A1/A2 的 A 四分块：`col = animID + (block==1 ? 3 : 0)`（:523）→ A1 在 cols 0-2、A2 在 cols 3-5
 *  - B 的 4 行：`col = animID, row = 4 + t`（:511-512）→ B 在 cols 0-2, rows 4-7
 *  - C：`col = 3 + (ID-3000)/50, row = 4 + animation_step_c`（:358-359）→ cols 3-5, rows 4-7
 *  - D：`GenerateAutotileD`（:571-632）12 个单元，排布 cols 6-11 rows 0-7 / cols 0-5 rows 8-15 / cols 6-11 rows 8-15
 */
const AUTOTILE_UNITS: ReadonlyArray<{
  id: string; label: string; col: number; row: number;
  ranges: Array<[number, number]>;
}> = [
  // 左上 2×2：A1 / A2 / B / C
  { id: 'A1', label: 'A1 自动图块', col: 0, row: 0, ranges: [[0, 999], [2000, 2999]] },
  { id: 'A2', label: 'A2 自动图块', col: 3, row: 0, ranges: [[1000, 1999]] },
  { id: 'B',  label: 'B 自动图块',  col: 0, row: 4, ranges: [[0, 2999]] },
  { id: 'C',  label: 'C 自动图块（动画）', col: 3, row: 4, ranges: [[3000, 3149]] },
  // D1..D12：cols 6-8 / 9-11 两列 + rows 0-3 / 4-7 / 8-11 / 12-15
  { id: 'D1',  label: 'D1 自动图块',  col: 0, row: 8,  ranges: [[4000, 4049]] },
  { id: 'D2',  label: 'D2 自动图块',  col: 3, row: 8,  ranges: [[4050, 4099]] },
  { id: 'D3',  label: 'D3 自动图块',  col: 0, row: 12, ranges: [[4100, 4149]] },
  { id: 'D4',  label: 'D4 自动图块',  col: 3, row: 12, ranges: [[4150, 4199]] },
  { id: 'D5',  label: 'D5 自动图块',  col: 6, row: 0,  ranges: [[4200, 4249]] },
  { id: 'D6',  label: 'D6 自动图块',  col: 9, row: 0,  ranges: [[4250, 4299]] },
  { id: 'D7',  label: 'D7 自动图块',  col: 6, row: 4,  ranges: [[4300, 4349]] },
  { id: 'D8',  label: 'D8 自动图块',  col: 9, row: 4,  ranges: [[4350, 4399]] },
  { id: 'D9',  label: 'D9 自动图块',  col: 6, row: 8,  ranges: [[4400, 4449]] },
  { id: 'D10', label: 'D10 自动图块', col: 9, row: 8,  ranges: [[4450, 4499]] },
  { id: 'D11', label: 'D11 自动图块', col: 6, row: 12, ranges: [[4500, 4549]] },
  { id: 'D12', label: 'D12 自动图块', col: 9, row: 12, ranges: [[4550, 4599]] },
];

/** E 块（下层普通图块，tile ID 5000-5143）在图片上的坐标（tilemap_layer.cpp:335-350） */
function eTileColRow(index: number): { col: number; row: number } {
  return index < 96
    ? { col: 12 + (index % 6), row: Math.floor(index / 6) }
    : { col: 18 + ((index - 96) % 6), row: Math.floor((index - 96) / 6) };
}

/** F 块（上层图块，tile ID 10000-10143）在图片上的坐标（tilemap_layer.cpp:391-404） */
function fTileColRow(index: number): { col: number; row: number } {
  return index < 48
    ? { col: 18 + (index % 6), row: 8 + Math.floor(index / 6) }
    : { col: 24 + ((index - 48) % 6), row: Math.floor((index - 48) / 6) };
}

function buildChipsetLayout(): TileLayout {
  const units: TileUnit[] = [];
  const unitById = new Map<string, TileUnit>();
  const add = (u: TileUnit) => { units.push(u); unitById.set(u.id, u); };

  // 自动图块单元：全部下层专用（tilemap_layer.cpp:331-386 只在 layer==0 绘制 A/B/C/D）
  for (const def of AUTOTILE_UNITS) {
    add({
      id: def.id,
      label: def.label,
      kind: 'autotile',
      ...px(def.col, def.row, 3, 4),
      layers: ['lower'],
      ranges: def.ranges,
    });
  }

  // E 块：144 个下层普通图块，每个 16×16
  for (let i = 0; i < BLOCK_E_TILES; i++) {
    const { col, row } = eTileColRow(i);
    add({
      id: `E${i}`,
      label: `E${i}`,
      kind: 'tile',
      ...px(col, row),
      layers: ['lower'],
      ranges: [[BLOCK_E + i, BLOCK_E + i]],
    });
  }

  // F 块：144 个上层图块，每个 16×16；也是 Editor 给事件图像提供的标准 tile ID 区
  for (let i = 0; i < BLOCK_F_TILES; i++) {
    const { col, row } = fTileColRow(i);
    add({
      id: `F${i}`,
      label: `F${i}`,
      kind: 'tile',
      ...px(col, row),
      layers: ['upper'],
      ranges: [[BLOCK_F + i, BLOCK_F + i]],
    });
  }

  return {
    category: 'ChipSet',
    tileSize: TILE_SIZE,
    cols: CHIPSET_COLS,
    rows: CHIPSET_ROWS,
    units,
    unitById,
  };
}

let chipsetLayoutCache: TileLayout | null = null;

/**
 * 取某类别素材图的单元划分；暂只支持 ChipSet，其余类别返回 null。
 *
 * 其它类别（CharSet 3×4 一格、FaceSet 4×2、Battle 5 帧…）后续按同样结构补即可。
 */
export function buildTileLayout(category: AssetCategory): TileLayout | null {
  if (category !== 'ChipSet') return null;
  if (!chipsetLayoutCache) chipsetLayoutCache = buildChipsetLayout();
  return chipsetLayoutCache;
}