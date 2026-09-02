import {
  encodeDatabase,
  encodeMapUnit,
  encodeTreeMap,
} from 'rpgrt';
import type { Database, MapUnit, TreeMap } from 'rpgrt';
import type { AssetFile, ProjectGameData } from '../types/index';
import { createSnapshot } from './snapshot';
import { prefetchedFileData } from '../scanner/assetScanner';
import { makeTranscoder, writeFile } from './internal/lcfIo';
import { applyRenameToDatabase, applyRenameToMapInfo, applyRenameToMapUnit } from './renameEngine';
import type { RtpNormalizeItem } from './rtpIndex';

export interface RtpStandardizeResult {
  success: boolean;
  message: string;
  pairs: number;                    // 实际执行的重命名对数
  refsChanged: boolean;             // 是否有 LCF 引用被改写
  filesWritten: string[];
  filesRenamed: string[];           // "dir/old → new"
  skipped: string[];                // 目标已存在等情况被跳过的项
}

/**
 * 批量把 RTP 引用从其本地化名改写成英文标准名：
 * 1. 改写 DB / LMT / LMU 里的引用（一次快照 + 一次写入）
 * 2. 若同名素材文件在游戏目录里，一并重命名磁盘文件
 * 3. 同步更新 rawLdb / rawLmt / data.maps
 */
export async function standardizeRtpReferences(
  data: ProjectGameData,
  plan: RtpNormalizeItem[],
  assets: AssetFile[],
): Promise<RtpStandardizeResult> {
  const failed = { success: false, message: '', pairs: 0, refsChanged: false, filesWritten: [], filesRenamed: [], skipped: [] as string[] };

  if (!data.encoding) {
    return { ...failed, message: '项目编码未知' };
  }
  const transcoder = makeTranscoder(data.encoding);

  // 折叠脏数据 + 检测目标名冲突（目标名不能顶着另一个待改名的旧名）
  const items: RtpNormalizeItem[] = [];
  const allOld = new Map<string, string>();   // lowercase newName -> oldName
  for (const item of plan) {
    const oldName = item.oldName?.trim();
    const newName = item.newName?.trim();
    if (!oldName || !newName) continue;
    if (oldName.toLowerCase() === newName.toLowerCase()) continue;
    if (/[/\\]/.test(oldName) || /[/\\]/.test(newName)) continue;
    items.push({ category: item.category, oldName, newName });
  }
  if (items.length === 0) {
    return { success: true, message: '没有需要标准化的 RTP 引用', pairs: 0, refsChanged: false, filesWritten: [], filesRenamed: [], skipped: [] };
  }

  const skipped: string[] = [];
  const activeItems: RtpNormalizeItem[] = [];
  for (const item of items) {
    const targetKey = item.newName.toLowerCase();
    const oldOfTarget = allOld.get(targetKey);
    if (oldOfTarget !== undefined && oldOfTarget.toLowerCase() !== item.oldName.toLowerCase()) {
      skipped.push(`${item.category}/${item.oldName} → ${item.newName}（目标名与另一旧名冲突）`);
      continue;
    }
    allOld.set(item.oldName.toLowerCase(), item.newName);
    activeItems.push(item);
  }

  const root = data.rootHandle!;
  const changedMapInfoIds = new Set<number>();
  const changedMapIds = new Set<number>();

  let dbClone: Database | null = null;
  let dbChanged = false;
  let treeMapClone: TreeMap | null = null;
  if (data.database) {
    dbClone = JSON.parse(JSON.stringify(data.database));
    for (const item of activeItems) {
      if (dbClone && applyRenameToDatabase(dbClone, item.category, item.oldName, item.newName, transcoder)) dbChanged = true;
    }
  }
  if (data.treeMap) {
    treeMapClone = JSON.parse(JSON.stringify(data.treeMap));
    for (const mi of treeMapClone?.maps ?? []) {
      for (const item of activeItems) {
        if (applyRenameToMapInfo(mi, item.category, item.oldName, item.newName)) changedMapInfoIds.add(mi.id);
      }
    }
  }
  const mapClones = new Map<number, MapUnit>();
  for (const [mapId, mu] of data.maps) {
    const muClone: MapUnit = JSON.parse(JSON.stringify(mu));
    let changed = false;
    for (const item of activeItems) {
      if (applyRenameToMapUnit(muClone, item.category, item.oldName, item.newName, transcoder)) changed = true;
    }
    if (changed) { changedMapIds.add(mapId); mapClones.set(mapId, muClone); }
  }

  const willWrite: string[] = [];
  if (dbChanged || changedMapInfoIds.size > 0 || changedMapIds.size > 0) {
    willWrite.push('RPG_RT.ldb');
    if (changedMapInfoIds.size > 0) willWrite.push('RPG_RT.lmt');
  }
  for (const mapId of changedMapIds) willWrite.push(`Map${String(mapId).padStart(4, '0')}.lmu`);

  // 找出游戏目录里需要随引用一起重命名的物理文件
  const stemToAsset = new Map<string, AssetFile>();
  for (const a of assets) {
    if (a.handle !== undefined) stemToAsset.set(`${a.category}\u0000${a.stem.toLowerCase()}`, a);
  }
  const toRenameDisk = activeItems
    .map(item => ({ item, asset: stemToAsset.get(`${item.category}\u0000${item.oldName.toLowerCase()}`) }))
    .filter((x): x is { item: RtpNormalizeItem; asset: AssetFile } => !!x.asset);

  // 快照：一次覆盖 LCF 写入 + 将被改名文件的旧内容
  const oldPaths = toRenameDisk.map(x => x.asset.path);
  const blobResults = await Promise.allSettled(
    toRenameDisk.map(async (x) => {
      const pre = prefetchedFileData.get(x.asset.path);
      if (pre instanceof Blob && pre.size > 0) return { path: x.asset.path, blob: pre };
      return { path: x.asset.path, blob: await x.asset.handle!.getFile() };
    })
  );
  const blobs = new Map<string, Blob>();
  for (const r of blobResults) if (r.status === 'fulfilled') blobs.set(r.value.path, r.value.blob);

  if (willWrite.length > 0 || oldPaths.length > 0) {
    await createSnapshot(root, willWrite, undefined, oldPaths, blobs, `RTP标准化：${activeItems.length} 组引用`);
  }

  const filesWritten: string[] = [];
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

  // 磁盘文件改名（同名目标已存在且不是大小写差异时跳过，避免覆盖）
  const filesRenamed: string[] = [];
  const dirCache = new Map<string, FileSystemDirectoryHandle>();
  const getDir = async (dirName: string) => {
    let h = dirCache.get(dirName);
    if (!h) { h = await root.getDirectoryHandle(dirName); dirCache.set(dirName, h); }
    return h;
  };

  for (const { item, asset } of toRenameDisk) {
    const dirName = asset.path.split('/')[0];
    const newFileName = item.newName + asset.ext;
    const caseOnly = item.oldName.toLowerCase() === item.newName.toLowerCase();
    try {
      const dirHandle = await getDir(dirName);
      if (!caseOnly) {
        const targetExists = await dirHandle.getFileHandle(newFileName).then(() => true).catch(() => false);
        if (targetExists) { skipped.push(`${asset.path} → ${newFileName}（目标已存在）`); continue; }
      }
      const oldHandle = await dirHandle.getFileHandle(asset.name);
      const fh = oldHandle as unknown as { move?: (name: string) => Promise<void> };
      if (typeof fh.move === 'function') {
        await fh.move(newFileName);
      } else {
        const file = await oldHandle.getFile();
        const newHandle = await dirHandle.getFileHandle(newFileName, { create: true });
        const w = await newHandle.createWritable();
        await w.write(file);
        await w.close();
        await dirHandle.removeEntry(asset.name);
      }
      filesRenamed.push(`${asset.path} → ${newFileName}`);
    } catch (e) {
      skipped.push(`${asset.path} → ${newFileName}（${(e as Error).message}）`);
    }
  }

  // 更新内存态，避免换编码重解码时用旧 raw 覆盖
  if (dbClone) {
    data.database = dbClone;
    if (data.rawLdb && dbChanged) data.rawLdb = encodeDatabase(dbClone, { engine: data.engine, transcoder });
  }
  if (treeMapClone) {
    data.treeMap = treeMapClone;
    if (data.rawLmt && changedMapInfoIds.size > 0) data.rawLmt = encodeTreeMap(treeMapClone, { engine: data.engine, transcoder });
  }
  for (const [mapId, muClone] of mapClones) data.maps.set(mapId, muClone);

  const pairs = activeItems.length;
  let msg = `已标准化 ${pairs} 个 RTP 引用`;
  if (filesRenamed.length > 0) msg += `，重命名 ${filesRenamed.length} 个磁盘文件`;
  if (skipped.length > 0) msg += `，跳过 ${skipped.length} 项`;
  console.log(`[RTP-STD] ${msg} | refsChanged=${dbChanged || changedMapInfoIds.size > 0 || changedMapIds.size > 0}`);

  return {
    success: skipped.length === 0,
    message: msg,
    pairs,
    refsChanged: dbChanged || changedMapInfoIds.size > 0 || changedMapIds.size > 0,
    filesWritten,
    filesRenamed,
    skipped,
  };
}