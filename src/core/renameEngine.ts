import {
  encodeDatabase,
  encodeMapUnit,
  encodeTreeMap,
} from 'rpgrt';
import type { Database, MapUnit, TreeMap, MapInfo } from 'rpgrt';
import type { AssetCategory, AssetFile, ProjectGameData } from '../types/index';
import { createSnapshot } from './snapshot';
import { makeTranscoder, writeFile } from './internal/lcfIo';
import { traverseDatabase, traverseMapUnit, traverseMapInfo } from './internal/dbTraversal';
import type { FieldChecker } from './internal/dbTraversal';

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

function makeRenameChecker(assetCat: AssetCategory, oldName: string, newName: string): { checker: FieldChecker; changed: boolean } {
  let changed = false;
  const checker: FieldChecker = (val, cat, set) => {
    if (cat !== assetCat) return false;
    const renamed = renameString(val, oldName, newName);
    if (renamed !== val) { set(renamed as string); changed = true; }
    return false;
  };
  return { checker, get changed() { return changed; } };
}

export function applyRenameToDatabase(
  db: Database,
  assetCat: AssetCategory,
  oldName: string,
  newName: string,
): boolean {
  const { checker, changed } = makeRenameChecker(assetCat, oldName, newName);
  traverseDatabase(db, checker);
  return changed;
}

export function applyRenameToMapUnit(
  mu: MapUnit,
  assetCat: AssetCategory,
  oldName: string,
  newName: string,
): boolean {
  const { checker, changed } = makeRenameChecker(assetCat, oldName, newName);
  traverseMapUnit(mu, checker);
  return changed;
}

export function applyRenameToMapInfo(
  mi: MapInfo,
  assetCat: AssetCategory,
  oldName: string,
  newName: string,
): boolean {
  const { checker, changed } = makeRenameChecker(assetCat, oldName, newName);
  traverseMapInfo(mi, checker);
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

  const dbClone: Database = JSON.parse(JSON.stringify(data.database));
  const dbChanged = applyRenameToDatabase(dbClone, asset.category, oldStem, newStemClean);
  console.log(`[RENAME] dbChanged=${dbChanged}`);

  const changedMapIds: number[] = [];
  const mapClones = new Map<number, MapUnit>();
  for (const [mapId, mu] of data.maps) {
    const muClone: MapUnit = JSON.parse(JSON.stringify(mu));
    if (applyRenameToMapUnit(muClone, asset.category, oldStem, newStemClean)) {
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
      } catch { /* 不存在，OK */ }

      const fh = fileHandle as unknown as { move?: (name: string) => Promise<void> };
      if (typeof fh.move === 'function') {
        await fh.move(newFileName);
      } else {
        const file = await fileHandle.getFile();
        const newHandle = await dirHandle.getFileHandle(newFileName, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(file);
        await writable.close();
        await dirHandle.removeEntry(asset.name);
      }
      filesRenamed.push(`${asset.name} → ${newFileName}`);
    } catch (e) {
      return { success: false, message: `磁盘文件重命名失败：${(e as Error).message}`, filesWritten, filesRenamed };
    }
  }

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
