import {
  encodeDatabase,
  encodeMapUnit,
  encodeTreeMap,
} from 'rpgrt';
import type { Database, MapUnit, TreeMap, MapInfo } from 'rpgrt';
import type { AssetCategory, AssetFile, ProjectGameData } from '../types/index';
import { createSnapshot } from './snapshot';
import { useStore } from '../store/useStore';
import { prefetchedFileData } from '../scanner/assetScanner';
import { makeTranscoder, writeFile } from './sharedEngine';
import { traverseDatabase, traverseMapUnit, traverseMapInfo } from './dbTraversal';
import type { FieldChecker } from './dbTraversal';

export interface DeleteResult {
  success: boolean;
  message: string;
  filesWritten: string[];
  filesDeleted: string[];
  deletedBlobs?: Map<string, Blob>;
}

function groupNamesByCategory(assets: AssetFile[]): Map<AssetCategory, Set<string>> {
  const map = new Map<AssetCategory, Set<string>>();
  for (const a of assets) {
    let set = map.get(a.category);
    if (!set) { set = new Set(); map.set(a.category, set); }
    set.add(a.stem.trim().toLowerCase());
  }
  return map;
}

function matchesAny(val: string | undefined | null, names: Set<string>): boolean {
  if (val == null) return false;
  return names.has(val.trim().toLowerCase());
}

/** 创建"清空匹配字段"的 checker */
function makeClearChecker(namesByCat: Map<AssetCategory, Set<string>>): { checker: FieldChecker; changed: boolean } {
  let changed = false;
  const checker: FieldChecker = (val, cat, set) => {
    const names = namesByCat.get(cat);
    if (!names || !names.has(val!.trim().toLowerCase())) return;
    set('');
    changed = true;
  };
  return { checker, get changed() { return changed; } };
}

/** 创建"检测是否引用指定素材"的 checker（匹配到即中止） */
function makeRefChecker(namesByCat: Map<AssetCategory, Set<string>>): FieldChecker {
  const categories = new Set(namesByCat.keys());
  return (val, cat, _set) => {
    if (!categories.has(cat)) return false;
    return matchesAny(val, namesByCat.get(cat)!);
  };
}

export function applyClearToDatabase(
  db: Database,
  namesByCat: Map<AssetCategory, Set<string>>,
): boolean {
  const { checker, changed } = makeClearChecker(namesByCat);
  traverseDatabase(db, checker);
  return changed;
}

export function applyClearToMapUnit(
  mu: MapUnit,
  namesByCat: Map<AssetCategory, Set<string>>,
): boolean {
  const { checker, changed } = makeClearChecker(namesByCat);
  traverseMapUnit(mu, checker);
  return changed;
}

export function applyClearToMapInfo(
  mi: MapInfo,
  namesByCat: Map<AssetCategory, Set<string>>,
): boolean {
  const { checker, changed } = makeClearChecker(namesByCat);
  traverseMapInfo(mi, checker);
  return changed;
}

function dbReferencesCategory(db: Database, namesByCat: Map<AssetCategory, Set<string>>): boolean {
  return traverseDatabase(db, makeRefChecker(namesByCat));
}

function mapReferencesCategory(mu: MapUnit, namesByCat: Map<AssetCategory, Set<string>>): boolean {
  return traverseMapUnit(mu, makeRefChecker(namesByCat));
}

function mapInfoReferencesCategory(mi: MapInfo, namesByCat: Map<AssetCategory, Set<string>>): boolean {
  return traverseMapInfo(mi, makeRefChecker(namesByCat));
}

export async function deleteAssets(
  data: ProjectGameData,
  assets: AssetFile[],
  clearReferences: boolean = false,
): Promise<DeleteResult> {
  if (!data.encoding) {
    return { success: false, message: '项目编码未知', filesWritten: [], filesDeleted: [] };
  }
  if (assets.length === 0) {
    return { success: false, message: '没有选中素材', filesWritten: [], filesDeleted: [] };
  }

  const transcoder = makeTranscoder(data.encoding);
  console.time('[DELETE] total');
  console.log(`[DELETE] ${assets.length} 个素材, clearRefs=${clearReferences}`);

  const namesByCat = groupNamesByCategory(assets);

  let needDbClone = false;
  let needTreeMapClone = false;
  const mapsNeedingClone: number[] = [];

  if (clearReferences && namesByCat.size > 0) {
    console.time('[DELETE] pre-scan');
    needDbClone = data.database ? dbReferencesCategory(data.database, namesByCat) : false;

    if (data.treeMap) {
      for (const mi of data.treeMap.maps ?? []) {
        if (mapInfoReferencesCategory(mi, namesByCat)) {
          needTreeMapClone = true;
          break;
        }
      }
    }

    for (const [mapId, mu] of data.maps) {
      if (mapReferencesCategory(mu, namesByCat)) {
        mapsNeedingClone.push(mapId);
      }
    }
    console.timeEnd('[DELETE] pre-scan');
  }

  const root = data.rootHandle!;
  const diskAssets = assets.filter(a => a.handle !== undefined);
  const filesToDelete = diskAssets.map(a => a.path);

  let dbClone: Database | null = null;
  let treeMapClone: TreeMap | null = null;
  const mapClones = new Map<number, MapUnit>();
  let dbChanged = false;
  let changedMapInfoIds = new Set<number>();
  let changedMapIds = new Set<number>();

  if (needDbClone || needTreeMapClone || mapsNeedingClone.length > 0) {
    console.time('[DELETE] clone+apply');
    if (needDbClone && data.database) {
      const dc: Database = JSON.parse(JSON.stringify(data.database));
      dbClone = dc;
      dbChanged = applyClearToDatabase(dc, namesByCat);
    }
    if (needTreeMapClone && data.treeMap) {
      const tmc: TreeMap = JSON.parse(JSON.stringify(data.treeMap));
      treeMapClone = tmc;
      for (const mi of tmc.maps ?? []) {
        if (applyClearToMapInfo(mi, namesByCat)) changedMapInfoIds.add(mi.id);
      }
    }
    for (const mapId of mapsNeedingClone) {
      const mu = data.maps.get(mapId);
      if (!mu) continue;
      const muClone = JSON.parse(JSON.stringify(mu));
      if (applyClearToMapUnit(muClone, namesByCat)) {
        changedMapIds.add(mapId);
        mapClones.set(mapId, muClone);
      }
    }
    console.timeEnd('[DELETE] clone+apply');
  }

  const willWrite: string[] = [];
  if (dbChanged || changedMapInfoIds.size > 0 || changedMapIds.size > 0) {
    willWrite.push('RPG_RT.ldb');
    if (changedMapInfoIds.size > 0) willWrite.push('RPG_RT.lmt');
  }
  for (const mapId of changedMapIds) willWrite.push(`Map${String(mapId).padStart(4, '0')}.lmu`);

  console.time('[DELETE] read-blobs');
  const blobResults = await Promise.allSettled(
    diskAssets.map(async (a) => {
      const pre = prefetchedFileData.get(a.path);
      if (pre instanceof Blob && pre.size > 0) return { path: a.path, blob: pre };
      const fh = a.handle!;
      const f = await fh.getFile();
      return { path: a.path, blob: f };
    })
  );
  const deletedBlobs = new Map<string, Blob>();
  for (const r of blobResults) {
    if (r.status === 'fulfilled') deletedBlobs.set(r.value.path, r.value.blob);
    else console.warn('[DELETE] read blob failed:', (r as PromiseRejectedResult).reason);
  }
  console.timeEnd('[DELETE] read-blobs');

  console.time('[DELETE] snapshot-db');
  if (willWrite.length > 0) {
    await createSnapshot(root, willWrite);
  }
  console.timeEnd('[DELETE] snapshot-db');

  const filesWritten: string[] = [];

  console.time('[DELETE] encode-write');
  if (dbChanged || changedMapInfoIds.size > 0 || changedMapIds.size > 0) {
    if (treeMapClone && changedMapInfoIds.size > 0) {
      const lmtEncoded = encodeTreeMap(treeMapClone, { engine: data.engine, transcoder });
      await writeFile(root, 'RPG_RT.lmt', lmtEncoded);
      filesWritten.push('RPG_RT.lmt');
    }
    if (dbClone) {
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
  }
  console.timeEnd('[DELETE] encode-write');

  console.time('[DELETE] disk-delete');
  const dirCache = new Map<string, FileSystemDirectoryHandle>();
  const getDir = async (dirName: string) => {
    let h = dirCache.get(dirName);
    if (!h) { h = await root.getDirectoryHandle(dirName); dirCache.set(dirName, h); }
    return h;
  };
  const deleteRslts = await Promise.allSettled(
    diskAssets.map(async (a) => {
      const dirHandle = await getDir(a.path.split('/')[0]);
      await dirHandle.removeEntry(a.name);
      return a.path;
    })
  );
  const filesDeleted: string[] = [];
  const failedToDelete: string[] = [];
  for (let i = 0; i < deleteRslts.length; i++) {
    const r = deleteRslts[i];
    if (r.status === 'fulfilled') filesDeleted.push(r.value);
    else failedToDelete.push(`${diskAssets[i].name}: ${(r.reason as Error).message}`);
  }
  console.timeEnd('[DELETE] disk-delete');

  if (filesToDelete.length > 0 && failedToDelete.length === 0) {
    const taskId = useStore.getState().addTask({ label: `备份 ${filesToDelete.length} 个已删除素材` });
    const rootForRefresh = root;
    createSnapshot(root, [], undefined, filesToDelete, deletedBlobs).then(
      () => {
        const store = useStore.getState();
        store.updateTask(taskId, { status: 'success', progress: 100 });
        store.refreshSnapshots(rootForRefresh);
        setTimeout(() => store.removeTask(taskId), 3000);
      },
      (e) => {
        const store = useStore.getState();
        store.updateTask(taskId, { status: 'error', message: String(e) });
        setTimeout(() => store.removeTask(taskId), 5000);
      }
    );
  }

  if (dbClone) {
    data.database = dbClone;
    if (data.rawLdb) data.rawLdb = encodeDatabase(dbClone, { engine: data.engine, transcoder });
  }
  if (treeMapClone) {
    data.treeMap = treeMapClone;
    if (data.rawLmt && changedMapInfoIds.size > 0)
      data.rawLmt = encodeTreeMap(treeMapClone, { engine: data.engine, transcoder });
  }
  for (const [mapId, muClone] of mapClones) data.maps.set(mapId, muClone);

  let msg = `已删除 ${filesDeleted.length}/${assets.length} 个素材`;
  if (dbChanged || changedMapIds.size > 0 || changedMapInfoIds.size > 0) {
    msg += `，清除了 ${dbChanged ? 'DB ' : ''}${changedMapIds.size > 0 ? changedMapIds.size + ' 张地图 ' : ''}${changedMapInfoIds.size > 0 ? 'TreeMap ' : ''}中的引用`;
  }
  if (failedToDelete.length > 0) msg += `（${failedToDelete.length} 个文件删除失败）`;

  console.timeEnd('[DELETE] total');
  return { success: failedToDelete.length === 0, message: msg, filesWritten, filesDeleted, deletedBlobs };
}
