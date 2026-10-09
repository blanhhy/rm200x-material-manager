import { EventCommandCode as EventCmdCode } from 'rpgrt';
import type { ProjectGameData } from '../types/index';
import { buildTileLayout, unitsForTileId, EVENT_TILE_OFFSET } from './tileLayout';
import type { TileLayer, TileLayout, TileUnit } from './tileLayout';

/**
 * ChipSet 的「子图块单元级」引用统计。
 *
 * 与 referenceTracker 的文件级引用不同：这里回答"这张 ChipSet 里具体哪些单元被用到了"。
 * 数据来源（均在运行时有效，见各条注释）：
 *  - 地图图层1 `MapUnit.lowerLayer` / 图层2 `MapUnit.upperLayer`
 *  - 事件命令 `TileSubstitution`(11750)：params[0] 0=下层/1=上层，params[1]=旧 tile ID，params[2]=新 tile ID
 *    （EasyRPG Player/src/game_interpreter.cpp:3448-3461）
 *  - 事件图像：`EventPage.characterName` 为空时用图块当图像，
 *    `characterIndex + 10000` 即 tile ID（见 tileLayout.ts 的 EVENT_TILE_OFFSET）。
 *    Editor 只写上层 F 区（索引 0-143），但工具可直接写下层 tile ID（索引为负，
 *    如 `GW2016_完全版` 的 -4953 → E47）
 */

export interface MapTileUsage {
  mapId: number;
  layer: TileLayer;
  count: number;
}

export interface SubstitutionUsage {
  mapId: number;
  eventId: number;
  pageId: number;
  commandIdx: number;
  layer: TileLayer;
  /** 该单元是被命令里的旧图块还是新图块引用 */
  role: 'old' | 'new';
  tileId: number;
}

export interface EventTileUsage {
  mapId: number;
  eventId: number;
  pageId: number;
  /** `EventPage.characterIndex` 原值（Editor 写入为 0-143，工具可写负值） */
  characterIndex: number;
  /** `characterIndex + 10000` 得到的 tile ID */
  tileId: number;
}

export interface TileUnitUsage {
  unit: TileUnit;
  used: boolean;
  /** 用到的 tile ID → 在地图图层的出现总次数 */
  tileIdCounts: Map<number, number>;
  mapTiles: MapTileUsage[];
  substitutions: SubstitutionUsage[];
  eventGraphics: EventTileUsage[];
}

export interface ChipsetTileUsage {
  layout: TileLayout;
  /** 单元 id → 用量 */
  unitUsages: Map<string, TileUnitUsage>;
  /** 事件图像里解析不到任何单元的 tile ID：运行时当空图块处理 */
  outOfRangeEventTiles: EventTileUsage[];
  /** 统计覆盖的地图数（引用了该 ChipSet 的地图） */
  mapCount: number;
}

function usageFor(unitUsages: Map<string, TileUnitUsage>, unit: TileUnit): TileUnitUsage {
  let u = unitUsages.get(unit.id);
  if (!u) {
    u = { unit, used: false, tileIdCounts: new Map(), mapTiles: [], substitutions: [], eventGraphics: [] };
    unitUsages.set(unit.id, u);
  }
  return u;
}

/**
 * 统计某个 ChipSet 各单元的引用情况。
 *
 * @param chipsetIds 引用了该 ChipSet 的 Chipset.id 集合（取自文件级引用里的 `ChipsetRef`）
 */
export function analyzeChipsetTileUsage(
  data: ProjectGameData,
  chipsetIds: Set<number>,
): ChipsetTileUsage | null {
  const layout = buildTileLayout('ChipSet');
  if (!layout) return null;

  const unitUsages = new Map<string, TileUnitUsage>();
  for (const unit of layout.units) usageFor(unitUsages, unit);

  // 每个单元在每个地图上的图层出现次数，最后再折叠成 mapTiles 数组
  const perMap = new Map<string, Map<number, { lower: number; upper: number }>>();
  const outOfRangeEventTiles: EventTileUsage[] = [];
  let mapCount = 0;

  const bump = (mapId: number, layer: TileLayer, tileId: number, unit: TileUnit) => {
    const u = usageFor(unitUsages, unit);
    u.tileIdCounts.set(tileId, (u.tileIdCounts.get(tileId) ?? 0) + 1);
    let m = perMap.get(unit.id);
    if (!m) { m = new Map(); perMap.set(unit.id, m); }
    let e = m.get(mapId);
    if (!e) { e = { lower: 0, upper: 0 }; m.set(mapId, e); }
    e[layer]++;
  };

  for (const [mapId, mu] of data.maps) {
    if (!chipsetIds.has(mu.chipsetId)) continue;
    mapCount++;

    for (const [layer, ids] of [['lower', mu.lowerLayer], ['upper', mu.upperLayer]] as const) {
      for (const tileId of ids ?? []) {
        for (const unit of unitsForTileId(layout, tileId)) bump(mapId, layer, tileId, unit);
      }
    }

    for (const ev of mu.events ?? []) {
      for (const page of ev.pages ?? []) {
        // 事件图像：characterName 为空即"用图块当图像"，tile ID = characterIndex + 10000。
        // characterIndex === 0 表示"无图像"（EasyRPG game_map.cpp:864 用 GetTileId() != 0 判定有图块图像）
        if (!page.characterName) {
          const characterIndex = page.characterIndex ?? 0;
          if (characterIndex !== 0) {
            const tileId = characterIndex + EVENT_TILE_OFFSET;
            const ref: EventTileUsage = { mapId, eventId: ev.id, pageId: page.id, characterIndex, tileId };
            const units = unitsForTileId(layout, tileId);
            if (units.length) {
              for (const unit of units) usageFor(unitUsages, unit).eventGraphics.push(ref);
            } else {
              outOfRangeEventTiles.push(ref);
            }
          }
        }

        const cmds = page.eventCommands ?? [];
        for (let ci = 0; ci < cmds.length; ci++) {
          const cmd = cmds[ci];
          if (cmd.code !== EventCmdCode.TileSubstitution) continue;
          const p = cmd.parameters ?? [];
          const layer: TileLayer = p[0] === 1 ? 'upper' : 'lower';
          for (const [role, tileId] of [['old', p[1]], ['new', p[2]]] as const) {
            if (typeof tileId !== 'number') continue;
            for (const unit of unitsForTileId(layout, tileId)) {
              usageFor(unitUsages, unit).substitutions.push({
                mapId, eventId: ev.id, pageId: page.id, commandIdx: ci, layer, role, tileId,
              });
            }
          }
        }
      }
    }
  }

  for (const [unitId, m] of perMap) {
    const unit = layout.unitById.get(unitId);
    if (!unit) continue;
    const u = usageFor(unitUsages, unit);
    u.mapTiles = [...m.entries()]
      .map(([mapId, c]) => {
        const out: MapTileUsage[] = [];
        if (c.lower > 0) out.push({ mapId, layer: 'lower', count: c.lower });
        if (c.upper > 0) out.push({ mapId, layer: 'upper', count: c.upper });
        return out;
      })
      .flat()
      .sort((a, b) => b.count - a.count);
  }

  for (const u of unitUsages.values()) {
    u.used = u.tileIdCounts.size > 0 || u.substitutions.length > 0 || u.eventGraphics.length > 0;
  }

  return { layout, unitUsages, outOfRangeEventTiles, mapCount };
}