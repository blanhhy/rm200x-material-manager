import {
  encodeDatabase,
  encodeMapUnit,
  encodeTreeMap,
} from 'rpgrt';
import { MoveCommandCode } from 'rpgrt';
import type { Database, MapUnit, TreeMap, MapInfo } from 'rpgrt';
import type { AssetCategory, AssetFile, ProjectGameData } from '../types/index';
import { createSnapshot } from './snapshot';
import { makeTranscoder, writeFile, refCatForEventCode, SYSTEM_PICTURE_FIELDS, SYSTEM_MUSIC_FIELDS, SYSTEM_SOUND_FIELDS, SYSTEM_VEHICLE_FIELDS } from './sharedEngine';

export interface RenameResult {
  success: boolean;
  message: string;
  filesWritten: string[];
  filesRenamed: string[];
}


function renameString<T extends string | undefined | null>(val: T, oldName: string, newName: string): T {
  if (val != null && (val as string).trim().toLowerCase() === oldName.trim().toLowerCase()) return newName as unknown as T;
  return val;
}

export function applyRenameToDatabase(
  db: Database,
  assetCat: AssetCategory,
  oldName: string,
  newName: string,
): boolean {
  let changed = false;
  const check = (val: string | undefined | null, refCat: AssetCategory, set: (v: string) => void) => {
    if (refCat !== assetCat) return;
    if (val == null) return;
    const renamed = renameString(val, oldName, newName);
    if (renamed !== val) { set(renamed as string); changed = true; }
  };

  const sys = db.system as unknown as Record<string, unknown> | undefined;
  if (sys) {
    for (const f of SYSTEM_PICTURE_FIELDS) {
      check(sys[f] as string | undefined, assetCat, v => { sys[f] = v; });
    }
    for (const f of SYSTEM_MUSIC_FIELDS) {
      const m = sys[f] as { name?: string } | undefined;
      if (m?.name) check(m.name, 'Music', v => { m.name = v; });
    }
    for (const f of SYSTEM_SOUND_FIELDS) {
      const s = sys[f] as { name?: string } | undefined;
      if (s?.name) check(s.name, 'Sound', v => { s.name = v; });
    }
    for (const f of SYSTEM_VEHICLE_FIELDS) {
      check(sys[f] as string | undefined, 'CharSet', v => { sys[f] = v; });
    }
  }

  for (const actor of db.actors ?? []) {
    check(actor.characterName, 'CharSet', v => { actor.characterName = v; });
    check(actor.faceName, 'FaceSet', v => { actor.faceName = v; });
  }

  for (const cs of db.chipsets ?? []) {
    check(cs.chipsetName, 'ChipSet', v => { cs.chipsetName = v; });
  }

  for (const t of db.terrains ?? []) {
    check(t.backgroundName, 'Backdrop', v => { t.backgroundName = v; });
    check(t.backgroundAName, 'Panorama', v => { t.backgroundAName = v; });
    check(t.backgroundBName, 'Panorama', v => { t.backgroundBName = v; });
    const fs = t.footstep as { name?: string } | undefined;
    if (fs?.name) check(fs.name, 'Sound', v => { fs.name = v; });
  }

  for (const ba of db.battleranimations ?? []) {
    for (const pose of ba.poses ?? []) {
      check(pose.battlerName, 'BattleCharSet', v => { pose.battlerName = v; });
    }
    for (const wep of ba.weapons ?? []) {
      check(wep.weaponName, 'BattleWeapon', v => { wep.weaponName = v; });
    }
  }

  for (const enemy of db.enemies ?? []) {
    check(enemy.battlerName, 'Monster', v => { enemy.battlerName = v; });
  }

  for (const anim of db.animations ?? []) {
    if (assetCat === 'Battle' || assetCat === 'Battle2') {
      const renamed = renameString(anim.animationName, oldName, newName);
      if (renamed !== anim.animationName) { anim.animationName = renamed as string; changed = true; }
    }
    for (const timing of anim.timings ?? []) {
      const se = timing.se as { name?: string } | undefined;
      if (se?.name) check(se.name, 'Sound', v => { se.name = v; });
    }
  }

  function renameCmdString(cmd: { code: number; string?: string }) {
    const refCat = refCatForEventCode(cmd.code);
    if (refCat && refCat === assetCat && cmd.string !== undefined) {
      const renamed = renameString(cmd.string, oldName, newName);
      if (renamed !== cmd.string) { cmd.string = renamed; changed = true; }
    }
  }

  for (const ce of db.commonevents ?? []) {
    for (const cmd of ce.eventCommands ?? []) renameCmdString(cmd);
  }

  for (const troop of db.troops ?? []) {
    for (const page of troop.pages ?? []) {
      for (const cmd of page.eventCommands ?? []) renameCmdString(cmd);
    }
  }

  return changed;
}

export function applyRenameToMapUnit(
  mu: MapUnit,
  assetCat: AssetCategory,
  oldName: string,
  newName: string,
): boolean {
  let changed = false;

  const check = (val: string | undefined | null, refCat: AssetCategory, set: (v: string) => void) => {
    if (refCat !== assetCat) return;
    if (val == null) return;
    const renamed = renameString(val, oldName, newName);
    if (renamed !== val) { set(renamed as string); changed = true; }
  };

  check(mu.parallaxName, 'Panorama', v => { mu.parallaxName = v; });

  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      check(page.characterName, 'CharSet', v => { page.characterName = v; });

      for (const cmd of page.eventCommands ?? []) {
        const refCat = refCatForEventCode(cmd.code);
        if (refCat === assetCat && cmd.string !== undefined) {
          const renamed = renameString(cmd.string, oldName, newName);
          if (renamed !== cmd.string) { cmd.string = renamed; changed = true; }
        }
      }

      for (const mc of page.moveRoute?.moveCommands ?? []) {
        if ((mc.commandId === MoveCommandCode.changeGraphic && assetCat === 'CharSet' && mc.parameterString) ||
            (mc.commandId === MoveCommandCode.playSoundEffect && assetCat === 'Sound' && mc.parameterString)) {
          const renamed = renameString(mc.parameterString, oldName, newName);
          if (renamed !== mc.parameterString) { mc.parameterString = renamed; changed = true; }
        }
      }
    }
  }

  return changed;
}

export function applyRenameToMapInfo(
  mi: MapInfo,
  assetCat: AssetCategory,
  oldName: string,
  newName: string,
): boolean {
  let changed = false;
  const oldLc = oldName.trim().toLowerCase();

  if (assetCat === 'Music' && mi.musicType === 2) {
    const m = mi.music as { name?: string } | undefined;
    if (m?.name && m.name.trim().toLowerCase() === oldLc) {
      m.name = newName;
      changed = true;
    }
  }
  if (assetCat === 'Picture') {
    if (mi.backgroundName && mi.backgroundName.trim().toLowerCase() === oldLc) {
      mi.backgroundName = newName;
      changed = true;
    }
  }

  return changed;
}

export async function renameAsset(
  data: ProjectGameData,
  asset: AssetFile,
  newStem: string,
): Promise<RenameResult> {
  const oldStem = asset.stem;
  const newStemClean = newStem.trim();
  if (!newStemClean) return { success: false, message: '新名字不能为空', filesWritten: [], filesRenamed: [] };
  if (newStemClean.toLowerCase() === oldStem.toLowerCase()) {
    return { success: true, message: '名字未改变', filesWritten: [], filesRenamed: [] };
  }

  if (!data.encoding) {
    return { success: false, message: '项目编码未知', filesWritten: [], filesRenamed: [] };
  }
  const transcoder = makeTranscoder(data.encoding);
  console.log(`[RENAME] old="${oldStem}" new="${newStemClean}" cat=${asset.category} enc=${data.encoding}`);

  if (asset.category === 'ChipSet' && data.database?.chipsets) {
    const matches = data.database.chipsets.filter(cs =>
      cs.chipsetName?.toLowerCase().includes(oldStem.toLowerCase()) ||
      cs.chipsetName?.toLowerCase() === oldStem.toLowerCase()
    );
    console.log(`[RENAME DB DIAG] total chipsets=${data.database.chipsets.length} matching="${oldStem}" →`,
      matches.map(c => c.chipsetName));
  }

  const dbClone: Database = JSON.parse(JSON.stringify(data.database));
  const dbChanged = applyRenameToDatabase(dbClone, asset.category, oldStem, newStemClean);
  console.log(`[RENAME] dbChanged=${dbChanged}`);
  if (dbChanged && asset.category === 'ChipSet' && dbClone.chipsets) {
    const match = dbClone.chipsets.find(cs => cs.chipsetName === newStemClean);
    console.log(`[RENAME DB DIAG] after rename, chipset now="${match?.chipsetName}"`);
  }

  const changedMapIds: number[] = [];
  const mapClones = new Map<number, MapUnit>();
  for (const [mapId, mu] of data.maps) {
    const muClone: MapUnit = JSON.parse(JSON.stringify(mu));
    const muChanged = applyRenameToMapUnit(muClone, asset.category, oldStem, newStemClean);
    if (muChanged) {
      changedMapIds.push(mapId);
      mapClones.set(mapId, muClone);
    }
  }

  const changedMapInfoIds: number[] = [];
  let treeMapClone: TreeMap | null = null;
  if (data.treeMap) {
    treeMapClone = JSON.parse(JSON.stringify(data.treeMap)) as TreeMap;
    for (const mi of treeMapClone.maps ?? []) {
      if (applyRenameToMapInfo(mi, asset.category, oldStem, newStemClean)) {
        changedMapInfoIds.push(mi.id);
      }
    }
  }

  const root = data.rootHandle!;

  // 预测所有将要覆盖写的文件 + rename 信息，快照后再动磁盘
  const willWrite: string[] = [];
  if (dbChanged || changedMapInfoIds.length > 0 || changedMapIds.length > 0) {
    if (treeMapClone && changedMapInfoIds.length > 0) willWrite.push('RPG_RT.lmt');
    willWrite.push('RPG_RT.ldb');
  }
  for (const mapId of changedMapIds) willWrite.push(`Map${String(mapId).padStart(4, '0')}.lmu`);
  const newFileName = newStemClean + asset.ext;
  const dirName = asset.path.split('/')[0];
  const oldRel = `${dirName}/${asset.name}`;
  const newRel = `${dirName}/${newFileName}`;

  await createSnapshot(root, willWrite, {
    fromRel: oldRel,
    toRel: newRel,
    label: `${oldStem} → ${newStemClean}`,
  });

  const filesWritten: string[] = [];

  if (dbChanged || changedMapInfoIds.length > 0 || changedMapIds.length > 0) {
    if (treeMapClone && changedMapInfoIds.length > 0) {
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

  const filesRenamed: string[] = [];
  if (asset.handle !== undefined) {
    try {
      const dirHandle = await root.getDirectoryHandle(dirName);
      const fileHandle = await dirHandle.getFileHandle(asset.name);

      try {
        await dirHandle.getFileHandle(newFileName);
        return { success: false, message: `目标文件名已存在：${newFileName}`, filesWritten, filesRenamed };
      } catch {
        // 不存在
      }

      // move() 重命名（Chrome 123+）
      const fh = fileHandle as unknown as { move?: (name: string) => Promise<void> };
      if (typeof fh.move === 'function') {
        await fh.move(newFileName);
      } else {
        // Fallback: read → write new → remove old
        const file = await fileHandle.getFile();
        const newHandle = await dirHandle.getFileHandle(newFileName, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(file);
        await writable.close();
        // remove old via dir handle
        await dirHandle.removeEntry(asset.name);
      }
      filesRenamed.push(`${asset.name} → ${newFileName}`);
    } catch (e) {
      return {
        success: false,
        message: `磁盘文件重命名失败：${(e as Error).message}`,
        filesWritten,
        filesRenamed,
      };
    }
  }

  // 更新内存
  data.database = dbClone;
  if (treeMapClone) {
    data.treeMap = treeMapClone;
    if (data.rawLmt && changedMapInfoIds.length > 0) {
      data.rawLmt = encodeTreeMap(treeMapClone, { engine: data.engine, transcoder });
    }
  }
  if (data.rawLdb && (dbChanged || changedMapInfoIds.length > 0 || changedMapIds.length > 0)) {
    data.rawLdb = encodeDatabase(dbClone, { engine: data.engine, transcoder });
  }
  for (const [mapId, muClone] of mapClones) {
    data.maps.set(mapId, muClone);
  }

  return {
    success: true,
    message: `重命名成功：${dbChanged ? 'DB ' : ''}${changedMapIds.length > 0 ? changedMapIds.length + ' 张地图 ' : ''}${changedMapInfoIds.length > 0 ? 'TreeMap ' : ''}`,
    filesWritten,
    filesRenamed,
  };
}
