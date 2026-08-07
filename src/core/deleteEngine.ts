import iconv from 'iconv-lite';
import {
  encodeDatabase,
  encodeMapUnit,
  encodeTreeMap,
} from 'rpgrt';
import type { Database, MapUnit, TreeMap, Transcoder, MapInfo } from 'rpgrt';
import type { AssetCategory, AssetFile, ProjectGameData } from '../types/index';
import { createSnapshot } from './snapshot';

export interface DeleteResult {
  success: boolean;
  message: string;
  filesWritten: string[];
  filesDeleted: string[];
}

function matchesRefCategory(refCat: AssetCategory, assetCat: AssetCategory): boolean {
  return refCat === assetCat;
}

function clearStringIfMatch(val: string | undefined | null, targetName: string, set: (v: string) => void): boolean {
  if (val == null) return false;
  if (val.trim().toLowerCase() === targetName.trim().toLowerCase()) {
    set('');
    return true;
  }
  return false;
}

function refCatForEventCode(code: number): AssetCategory | null {
  switch (code) {
    case 10130: return 'FaceSet';
    case 10630: return 'CharSet';
    case 10640: return 'FaceSet';
    case 10650: return 'CharSet';
    case 10660: return 'Music';
    case 10670: return 'Sound';
    case 10680: return 'System';
    case 10690: return 'System';
    case 11110: return 'Picture';
    case 11510: return 'Music';
    case 11550: return 'Sound';
    case 11560: return 'Movie';
    case 11720: return 'Panorama';
    case 13210: return 'Backdrop';
    default: return null;
  }
}

export function applyClearToDatabase(
  db: Database,
  assetCat: AssetCategory,
  name: string,
): boolean {
  let changed = false;
  const check = (val: string | undefined | null, refCat: AssetCategory, set: (v: string) => void) => {
    if (!matchesRefCategory(refCat, assetCat)) return;
    if (clearStringIfMatch(val, name, set)) changed = true;
  };

  const sys = db.system as unknown as Record<string, unknown> | undefined;
  if (sys) {
    const pictureFields = ['titleName', 'gameoverName', 'systemName', 'system2Name', 'frameName', 'battletestBackground'];
    for (const f of pictureFields) check(sys[f] as string | undefined, assetCat, v => { sys[f] = v; });
    const musicFields = ['titleMusic','battleMusic','battleEndMusic','innMusic','boatMusic','shipMusic','airshipMusic','gameoverMusic'];
    for (const f of musicFields) {
      const m = sys[f] as { name?: string } | undefined;
      if (m?.name) check(m.name, 'Music', v => { m.name = v; });
    }
    const seFields = ['cursorSe','decisionSe','cancelSe','buzzerSe','battleSe','escapeSe','enemyAttackSe','enemyDamagedSe','actorDamagedSe','dodgeSe','enemyDeathSe','itemSe'];
    for (const f of seFields) {
      const s = sys[f] as { name?: string } | undefined;
      if (s?.name) check(s.name, 'Sound', v => { s.name = v; });
    }
    const vehicleFields = ['boatName', 'shipName', 'airshipName'];
    for (const f of vehicleFields) check(sys[f] as string | undefined, 'CharSet', v => { sys[f] = v; });
  }

  for (const actor of db.actors ?? []) {
    check(actor.characterName, 'CharSet', v => { actor.characterName = v; });
    check(actor.faceName, 'FaceSet', v => { actor.faceName = v; });
  }

  for (const cs of db.chipsets ?? []) {
    check(cs.chipsetName, 'ChipSet', v => { cs.chipsetName = v; });
  }

  for (const t of db.terrains ?? []) {
    check(t.backgroundName, 'Panorama', v => { t.backgroundName = v; });
    check(t.backgroundAName, 'Backdrop', v => { t.backgroundAName = v; });
    check(t.backgroundBName, 'Backdrop', v => { t.backgroundBName = v; });
    const fs = t.footstep as { name?: string } | undefined;
    if (fs?.name) check(fs.name, 'Sound', v => { fs.name = v; });
  }

  for (const ba of db.battleranimations ?? []) {
    for (const pose of ba.poses ?? []) check(pose.battlerName, 'BattleCharSet', v => { pose.battlerName = v; });
    for (const wep of ba.weapons ?? []) check(wep.weaponName, 'BattleWeapon', v => { wep.weaponName = v; });
  }

  for (const enemy of db.enemies ?? []) {
    check(enemy.battlerName, 'Monster', v => { enemy.battlerName = v; });
  }

  for (const anim of db.animations ?? []) {
    if (assetCat === 'Battle' || assetCat === 'Battle2') {
      if (clearStringIfMatch(anim.animationName, name, v => { anim.animationName = v; })) changed = true;
    }
    for (const timing of anim.timings ?? []) {
      const se = timing.se as { name?: string } | undefined;
      if (se?.name) check(se.name, 'Sound', v => { se.name = v; });
    }
  }

  for (const ce of db.commonevents ?? []) {
    for (const cmd of ce.eventCommands ?? []) {
      const refCat = refCatForEventCode(cmd.code);
      if (refCat && matchesRefCategory(refCat, assetCat) && cmd.string !== undefined) {
        if (clearStringIfMatch(cmd.string, name, v => { cmd.string = v; })) changed = true;
      }
    }
  }

  for (const troop of db.troops ?? []) {
    for (const page of troop.pages ?? []) {
      for (const cmd of page.eventCommands ?? []) {
        const refCat = refCatForEventCode(cmd.code);
        if (refCat && matchesRefCategory(refCat, assetCat) && cmd.string !== undefined) {
          if (clearStringIfMatch(cmd.string, name, v => { cmd.string = v; })) changed = true;
        }
      }
    }
  }

  return changed;
}

export function applyClearToMapUnit(
  mu: MapUnit,
  assetCat: AssetCategory,
  name: string,
): boolean {
  let changed = false;
  const check = (val: string | undefined | null, refCat: AssetCategory, set: (v: string) => void) => {
    if (!matchesRefCategory(refCat, assetCat)) return;
    if (clearStringIfMatch(val, name, set)) changed = true;
  };

  check(mu.parallaxName, 'Panorama', v => { mu.parallaxName = v; });

  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      check(page.characterName, 'CharSet', v => { page.characterName = v; });

      for (const cmd of page.eventCommands ?? []) {
        const refCat = refCatForEventCode(cmd.code);
        if (refCat && matchesRefCategory(refCat, assetCat) && cmd.string !== undefined) {
          if (clearStringIfMatch(cmd.string, name, v => { cmd.string = v; })) changed = true;
        }
      }

      for (const mc of page.moveRoute?.moveCommands ?? []) {
        if ((mc.commandId === 34 && assetCat === 'CharSet' && mc.parameterString) ||
            (mc.commandId === 35 && assetCat === 'Sound' && mc.parameterString)) {
          if (clearStringIfMatch(mc.parameterString, name, v => { mc.parameterString = v; })) changed = true;
        }
      }
    }
  }

  return changed;
}

export function applyClearToMapInfo(
  mi: MapInfo,
  assetCat: AssetCategory,
  name: string,
): boolean {
  let changed = false;
  const lc = name.trim().toLowerCase();

  if (assetCat === 'Music' && mi.musicType === 2) {
    const m = mi.music as { name?: string } | undefined;
    if (m?.name && m.name.trim().toLowerCase() === lc) {
      m.name = '';
      changed = true;
    }
  }
  if (assetCat === 'Picture') {
    if (mi.backgroundName && mi.backgroundName.trim().toLowerCase() === lc) {
      mi.backgroundName = '';
      changed = true;
    }
  }

  return changed;
}

function makeTranscoder(enc: string): Transcoder {
  const map: Record<string, string> = {
    latin1: 'latin1', gbk: 'gbk', shift_jis: 'shift_jis', euc_jp: 'eucjp', utf8: 'utf8',
  };
  const target = map[enc] ?? enc;
  return {
    decode(bytes: Uint8Array): string { return iconv.decode(bytes, target); },
    encode(str: string): Uint8Array { return new Uint8Array(iconv.encode(str, target)); },
  };
}

async function writeFile(root: FileSystemDirectoryHandle, fileName: string, data: Uint8Array) {
  const handle = await root.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data as unknown as ArrayBuffer);
  await writable.close();
}

export async function deleteAssets(
  data: ProjectGameData,
  assets: AssetFile[],
  clearReferences: boolean = true,
): Promise<DeleteResult> {
  if (!data.encoding) {
    return { success: false, message: '项目编码未知', filesWritten: [], filesDeleted: [] };
  }
  if (assets.length === 0) {
    return { success: false, message: '没有选中素材', filesWritten: [], filesDeleted: [] };
  }

  const transcoder = makeTranscoder(data.encoding);
  console.log(`[DELETE] ${assets.length} 个素材, clearRefs=${clearReferences}`);

  // 克隆所有要改的结构
  const dbClone: Database = JSON.parse(JSON.stringify(data.database));
  const treeMapClone: TreeMap | null = data.treeMap ? JSON.parse(JSON.stringify(data.treeMap)) : null;
  const mapClones = new Map<number, MapUnit>();
  let dbChanged = false;
  let changedMapInfoIds = new Set<number>();
  let changedMapIds = new Set<number>();

  if (clearReferences) {
    for (const a of assets) {
      const d = applyClearToDatabase(dbClone, a.category, a.stem);
      if (d) dbChanged = true;
    }

    if (treeMapClone) {
      for (const mi of treeMapClone.maps ?? []) {
        for (const a of assets) {
          if (applyClearToMapInfo(mi, a.category, a.stem)) changedMapInfoIds.add(mi.id);
        }
      }
    }

    for (const [mapId, mu] of data.maps) {
      const muClone: MapUnit = JSON.parse(JSON.stringify(mu));
      let muChanged = false;
      for (const a of assets) {
        if (applyClearToMapUnit(muClone, a.category, a.stem)) muChanged = true;
      }
      if (muChanged) {
        changedMapIds.add(mapId);
        mapClones.set(mapId, muClone);
      }
    }
  }

  const root = data.rootHandle!;

  // 预测所有将要覆盖写的文件 + 要删的 asset，快照
  const willWrite: string[] = [];
  if (dbChanged || changedMapInfoIds.size > 0 || changedMapIds.size > 0) {
    willWrite.push('RPG_RT.ldb');
    if (changedMapInfoIds.size > 0) willWrite.push('RPG_RT.lmt');
  }
  for (const mapId of changedMapIds) willWrite.push(`Map${String(mapId).padStart(4, '0')}.lmu`);

  const filesToDelete = assets.map(a => `${a.path.split('/')[0]}/${a.name}`);
  await createSnapshot(root, willWrite, undefined, filesToDelete);

  const filesWritten: string[] = [];

  if (dbChanged || changedMapInfoIds.size > 0 || changedMapIds.size > 0) {
    if (treeMapClone && changedMapInfoIds.size > 0) {
      const lmtEncoded = encodeTreeMap(treeMapClone, { engine: data.engine, transcoder });
      await writeFile(root, 'RPG_RT.lmt', lmtEncoded);
      filesWritten.push('RPG_RT.lmt');
    }
    const ldbEncoded = encodeDatabase(dbClone, { engine: data.engine, transcoder });
    await writeFile(root, 'RPG_RT.ldb', ldbEncoded);
    filesWritten.push('RPG_RT.ldb');
  }

  for (const [mapId, muClone] of mapClones) {
    const encoded = encodeMapUnit(muClone, { engine: data.engine, transcoder });
    const lmuName = `Map${String(mapId).padStart(4, '0')}.lmu`;
    await writeFile(root, lmuName, encoded);
    filesWritten.push(lmuName);
  }

  const filesDeleted: string[] = [];
  const failedToDelete: string[] = [];
  for (const a of assets) {
    try {
      const dirName = a.path.split('/')[0];
      const dirHandle = await root.getDirectoryHandle(dirName);
      await dirHandle.removeEntry(a.name);
      filesDeleted.push(a.path);
    } catch (e) {
      failedToDelete.push(`${a.name}: ${(e as Error).message}`);
    }
  }

  // 更新内存
  data.database = dbClone;
  if (treeMapClone) data.treeMap = treeMapClone;
  if (data.rawLdb) {
    data.rawLdb = encodeDatabase(dbClone, { engine: data.engine, transcoder });
  }
  if (treeMapClone && data.rawLmt && changedMapInfoIds.size > 0) {
    data.rawLmt = encodeTreeMap(treeMapClone, { engine: data.engine, transcoder });
  }
  for (const [mapId, muClone] of mapClones) {
    data.maps.set(mapId, muClone);
  }

  let msg = `已删除 ${filesDeleted.length}/${assets.length} 个素材`;
  if (dbChanged || changedMapIds.size > 0 || changedMapInfoIds.size > 0) {
    msg += `，清除了 ${dbChanged ? 'DB ' : ''}${changedMapIds.size > 0 ? changedMapIds.size + ' 张地图 ' : ''}${changedMapInfoIds.size > 0 ? 'TreeMap ' : ''}中的引用`;
  }
  if (failedToDelete.length > 0) {
    msg += `（${failedToDelete.length} 个文件删除失败）`;
  }

  return { success: failedToDelete.length === 0, message: msg, filesWritten, filesDeleted };
}
