const BACKUP_DIR = '.rmm-backup';
const MAX_SNAPSHOTS = 20;

export interface SnapshotInfo {
  dirName: string;
  timestamp: number;
  files: string[];
  deletedFiles?: string[];
  label: string;
}

/** 快照涉及文件的分类统计：数据库(ldb/lmt) / 地图(lmu) / 素材 */ 
export interface SnapshotFileStats {
  db: number;
  maps: number;
  assets: number;
}

export function snapshotFileStats(files: string[], deletedFiles: string[] = []): SnapshotFileStats {
  const stats: SnapshotFileStats = { db: 0, maps: 0, assets: 0 };
  for (const p of [...files, ...deletedFiles]) {
    const name = p.split('/').pop() ?? '';
    const lower = name.toLowerCase();
    if (lower === 'rpg_rt.ldb' || lower === 'rpg_rt.lmt') stats.db++;
    else if (/^map\d{4}\.lmu$/i.test(name)) stats.maps++;
    else stats.assets++;
  }
  return stats;
}

async function ensureDir(root: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> {
  return await root.getDirectoryHandle(name, { create: true });
}

/**
 * 预热所有需要的源目录与备份子目录，缓存到 Map 里。
 * 返回 [srcDirs, dstDirs] — 同一批文件共享 handle，避免重复遍历。
 */
async function prefetchDirs(
  srcRoot: FileSystemDirectoryHandle,
  dstRoot: FileSystemDirectoryHandle,
  relPaths: string[],
): Promise<{ src: Map<string, FileSystemDirectoryHandle>; dst: Map<string, FileSystemDirectoryHandle> }> {
  const src = new Map<string, FileSystemDirectoryHandle>();
  const dst = new Map<string, FileSystemDirectoryHandle>();

  const dirs = new Set<string>();
  for (const rel of relPaths) {
    const parts = rel.split('/');
    parts.pop();
    dirs.add(parts.join('/'));
  }

  const srcWork: [string[], string][] = [];
  for (const dir of dirs) if (dir) srcWork.push([dir.split('/'), dir]);

  await Promise.all(srcWork.map(async ([parts, key]) => {
    let cur = srcRoot;
    for (const seg of parts) cur = await cur.getDirectoryHandle(seg);
    src.set(key, cur);
  }));

  await Promise.all(srcWork.map(async ([parts, key]) => {
    let cur = dstRoot;
    for (const seg of parts) cur = await ensureDir(cur, seg);
    dst.set(key, cur);
  }));

  src.set('', srcRoot);
  dst.set('', dstRoot);

  return { src, dst };
}

async function copyOne(
  srcDir: FileSystemDirectoryHandle,
  dstDir: FileSystemDirectoryHandle,
  fileName: string,
): Promise<void> {
  const srcHandle = await srcDir.getFileHandle(fileName);
  try {
    await (srcHandle as FileSystemFileHandle & { copyTo?: (t: FileSystemDirectoryHandle, n?: string) => Promise<FileSystemFileHandle> })
      .copyTo!(dstDir, fileName);
  } catch {
    const file = await srcHandle.getFile();
    const newHandle = await dstDir.getFileHandle(fileName, { create: true });
    const w = await newHandle.createWritable();
    await w.write(file);
    await w.close();
  }
}

interface BlobBatchResult {
  ok: string[];
  offsets: Record<string, { offset: number; length: number }>;
  totalBytes: number;
}

export async function createSnapshot(
  root: FileSystemDirectoryHandle,
  files: string[],
  renameInfo?: { fromRel: string; toRel: string; label?: string },
  filesToDelete?: string[],
  blobBuffer?: Map<string, Blob>,
  labelOverride?: string,
): Promise<SnapshotInfo | null> {
  try {
    const backupRoot = await ensureDir(root, BACKUP_DIR);
    const dirName = new Date().toISOString().replace(/[:.]/g, '-');
    const snapDir = await ensureDir(backupRoot, dirName);

    const allFiles = [...files];
    if (renameInfo) allFiles.push(renameInfo.fromRel);
    if (filesToDelete) allFiles.push(...filesToDelete);

    let srcDirs: Map<string, FileSystemDirectoryHandle> | null = null;
    let dstDirs: Map<string, FileSystemDirectoryHandle> | null = null;
    if (allFiles.length > 0) {
      ({ src: srcDirs, dst: dstDirs } = await prefetchDirs(root, snapDir, allFiles));
    }

    const copied = await batchCopy(srcDirs!, dstDirs!, files);
    const filesBefore = [...copied];

    let renameCopied: string[] = [];
    if (renameInfo) {
      renameCopied = await batchCopy(srcDirs!, dstDirs!, [renameInfo.fromRel]);
      filesBefore.push(...renameCopied);
    }

    const deletedFiles: string[] = [];
    let blobOffsets: Record<string, { offset: number; length: number }> | null = null;
    if (filesToDelete && filesToDelete.length > 0) {
      if (blobBuffer && blobBuffer.size > 0) {
        console.time('[SNAPSHOT] blob-write deleted');
        const blobResult = await batchWriteBlobs(dstDirs!, filesToDelete, blobBuffer);
        deletedFiles.push(...blobResult.ok);
        blobOffsets = blobResult.offsets;
        console.timeEnd('[SNAPSHOT] blob-write deleted');
      } else {
        console.time('[SNAPSHOT] batch-copy deleted');
        deletedFiles.push(...await batchCopy(srcDirs!, dstDirs!, filesToDelete));
        console.timeEnd('[SNAPSHOT] batch-copy deleted');
      }
    }

    let label = labelOverride ?? renameInfo?.label ?? '';
    if (!label && deletedFiles.length > 0) {
      label = `删除 ${deletedFiles.length} 个素材`;
    }

    const meta = {
      filesBefore,
      rename: renameInfo ? { from: renameInfo.fromRel, to: renameInfo.toRel } : null,
      deletedFiles,
      blobOffsets,
      createdAt: Date.now(),
      label,
    };
    const metaHandle = await snapDir.getFileHandle('meta.json', { create: true });
    const w = await metaHandle.createWritable();
    await w.write(JSON.stringify(meta, null, 2));
    await w.close();

    await pruneOldSnapshots(backupRoot);

    return {
      dirName,
      timestamp: meta.createdAt,
      files: filesBefore,
      deletedFiles,
      label: meta.label,
    };
  } catch (e) {
    console.warn('[SNAPSHOT] 创建失败：', e);
    return null;
  }
}

async function batchCopy(
  srcDirs: Map<string, FileSystemDirectoryHandle>,
  dstDirs: Map<string, FileSystemDirectoryHandle>,
  relPaths: string[],
): Promise<string[]> {
  if (relPaths.length === 0) return [];

  const byDir = new Map<string, string[]>();
  for (const rel of relPaths) {
    const parts = rel.split('/');
    parts.pop();
    const dirKey = parts.join('/');
    if (!byDir.has(dirKey)) byDir.set(dirKey, []);
    byDir.get(dirKey)!.push(rel);
  }

  const tasks = [...byDir.entries()].map(async ([dirKey, paths]) => {
    const srcDir = srcDirs.get(dirKey)!;
    const dstDir = dstDirs.get(dirKey)!;
    const ok: string[] = [];
    for (const rel of paths) {
      const fileName = rel.split('/').pop()!;
      try {
        await copyOne(srcDir, dstDir, fileName);
        ok.push(rel);
      } catch (e) {
        console.warn('[SNAPSHOT] copy failed:', rel, (e as Error).message);
      }
    }
    return ok;
  });

  const results = await Promise.all(tasks);
  const ok = results.flat();
  console.log(`[SNAPSHOT] batchCopy: ${ok.length}/${relPaths.length} ok, dirs=${byDir.size}`);
  return ok;
}

async function batchWriteBlobs(
  dstDirs: Map<string, FileSystemDirectoryHandle>,
  relPaths: string[],
  blobBuffer: Map<string, Blob>,
): Promise<BlobBatchResult> {
  const offsets: Record<string, { offset: number; length: number }> = {};
  const chunks: BlobPart[] = [];
  let offset = 0;
  const ok: string[] = [];

  for (const rel of relPaths) {
    const blob = blobBuffer.get(rel);
    if (!blob) { console.warn('[SNAPSHOT] blob not found:', rel); continue; }
    offsets[rel] = { offset, length: blob.size };
    chunks.push(blob);
    offset += blob.size;
    ok.push(rel);
  }

  const combined = new Blob(chunks);
  const totalBytes = combined.size;

  const rootDir = dstDirs.get('')!;
  try {
    const fh = await rootDir.getFileHandle('deleted.blobs', { create: true });
    const w = await fh.createWritable();
    await w.write(combined);
    await w.close();
  } catch (e) {
    console.warn('[SNAPSHOT] combined blob write failed:', (e as Error).message);
  }

  console.log(`[SNAPSHOT] batchWriteBlobs: ${ok.length}/${relPaths.length} ok, totalBytes=${totalBytes}`);
  return { ok, offsets, totalBytes };
}

async function pruneOldSnapshots(backupRoot: FileSystemDirectoryHandle) {
  const entries: string[] = [];
  for await (const [name, handle] of backupRoot.entries()) {
    if (handle.kind === 'directory' && name !== BACKUP_DIR) entries.push(name);
  }
  entries.sort((a, b) => b.localeCompare(a));
  for (const old of entries.slice(MAX_SNAPSHOTS)) {
    try { await backupRoot.removeEntry(old, { recursive: true }); } catch { /* skip */ }
  }
}

export async function listSnapshots(root: FileSystemDirectoryHandle): Promise<SnapshotInfo[]> {
  const backupRoot = await root.getDirectoryHandle(BACKUP_DIR).catch(() => null);
  if (!backupRoot) return [];

  const result: SnapshotInfo[] = [];
  for await (const [name, handle] of backupRoot.entries()) {
    if (handle.kind !== 'directory') continue;
    try {
      const metaHandle = await (handle as FileSystemDirectoryHandle).getFileHandle('meta.json');
      const file = await metaHandle.getFile();
      const meta = JSON.parse(await file.text());
      result.push({
        dirName: name,
        timestamp: meta.createdAt ?? 0,
        files: meta.filesBefore ?? [],
        deletedFiles: meta.deletedFiles ?? [],
        label: meta.label ?? '',
      });
    } catch { /* skip bad snapshot */ }
  }
  result.sort((a, b) => b.timestamp - a.timestamp);
  return result;
}

export async function deleteSnapshot(
  root: FileSystemDirectoryHandle,
  snap: SnapshotInfo,
): Promise<boolean> {
  const backupRoot = await root.getDirectoryHandle(BACKUP_DIR).catch(() => null);
  if (!backupRoot) return false;
  try {
    await backupRoot.removeEntry(snap.dirName, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export async function restoreSnapshot(
  root: FileSystemDirectoryHandle,
  snap: SnapshotInfo,
  blobBuffer?: Map<string, Blob>,
): Promise<boolean> {
  const t0 = performance.now();
  const backupRoot = await root.getDirectoryHandle(BACKUP_DIR).catch(() => null);
  if (!backupRoot) return false;
  const snapDir = await backupRoot.getDirectoryHandle(snap.dirName).catch(() => null);
  if (!snapDir) return false;

  let meta: {
    filesBefore: string[];
    rename: { from: string; to: string } | null;
    deletedFiles: string[];
    blobOffsets?: Record<string, { offset: number; length: number }> | null;
  };
  try {
    const metaHandle = await snapDir.getFileHandle('meta.json');
    meta = JSON.parse(await (await metaHandle.getFile()).text());
  } catch {
    return false;
  }
  console.log(`[RESTORE] meta-load: ${(performance.now() - t0).toFixed(0)}ms, filesBefore=${meta.filesBefore.length}, deletedFiles=${meta.deletedFiles?.length ?? 0}`);

  const allFiles = [
    ...meta.filesBefore.filter(f => f !== meta.rename?.from),
    ...(meta.deletedFiles ?? []),
  ];
  const { dst: dstDirs } = await prefetchDirs(snapDir, root, allFiles);
  console.log(`[RESTORE] prefetch-dirs: ${(performance.now() - t0).toFixed(0)}ms`);

  const t1 = performance.now();
  if (meta.rename) {
    const { from: fromRel, to: toRel } = meta.rename;
    const toParts = toRel.split('/');
    const toName = toParts.pop()!;
    let toDir = root;
    for (const seg of toParts) toDir = await toDir.getDirectoryHandle(seg);

    const fromParts = fromRel.split('/');
    const fromName = fromParts.pop()!;
    let fromDir = root;
    for (const seg of fromParts) fromDir = await fromDir.getDirectoryHandle(seg);

    try {
      const fh = await toDir.getFileHandle(toName);
      const fromExists = await fromDir.getFileHandle(fromName).then(() => true).catch(() => false);
      if (!fromExists) {
        try {
          await (fh as FileSystemFileHandle & { move?: (name: string) => Promise<void> }).move!(fromName);
        } catch {
          const file = await fh.getFile();
          const newHandle = await fromDir.getFileHandle(fromName, { create: true });
          const w = await newHandle.createWritable();
          await w.write(file);
          await w.close();
          await toDir.removeEntry(toName);
        }
      } else {
        await toDir.removeEntry(toName);
      }
    } catch (e) {
      console.warn('[SNAPSHOT] rename 还原失败', e);
    }
  }
  console.log(`[RESTORE] rename: ${(performance.now() - t1).toFixed(0)}ms`);

  const t2 = performance.now();
  let fbOk = 0;
  const fbFailed: string[] = [];
  const fbTasks = [...groupByDir(meta.filesBefore.filter(f => f !== meta.rename?.from)).entries()].map(async ([dirKey, paths]) => {
    const dstDir = dstDirs.get(dirKey)!;
    const snapSub = await (async () => {
      if (!dirKey) return snapDir;
      let cur = snapDir;
      for (const seg of dirKey.split('/')) cur = await cur.getDirectoryHandle(seg);
      return cur;
    })();
    for (const rel of paths) {
      const fileName = rel.split('/').pop()!;
      try {
        const srcHandle = await snapSub.getFileHandle(fileName);
        const file = await srcHandle.getFile();
        const fh = await dstDir.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(file);
        await w.close();
        fbOk++;
      } catch (e) {
        fbFailed.push(rel);
        console.warn('[SNAPSHOT] 还原 filesBefore 失败', rel, (e as Error).message);
      }
    }
  });
  await Promise.all(fbTasks);
  console.log(`[RESTORE] filesBefore-write(${meta.filesBefore.length}): ok=${fbOk}, failed=${fbFailed.length}, ${(performance.now() - t2).toFixed(0)}ms`);

  const t3 = performance.now();
  const combinedBlob: Blob | null = meta.blobOffsets
    ? await snapDir.getFileHandle('deleted.blobs').then(h => h.getFile()).catch(() => null)
    : null;
  if (combinedBlob) {
    const keys = Object.keys(meta.blobOffsets ?? {});
    const sample = keys.slice(0, 3).map(k => `${k}: ${meta.blobOffsets![k].offset}-${meta.blobOffsets![k].length}`).join(', ');
    console.log(`[RESTORE] combinedBlob size=${combinedBlob.size}, offsets.count=${keys.length}, sample=[${sample}]`);
  } else {
    console.warn('[RESTORE] combinedBlob is null — blobOffsets mode unavailable');
  }

  let okCount = 0;
  const failed: string[] = [];

  const delTasks = [...groupByDir(meta.deletedFiles ?? []).entries()].map(async ([dirKey, paths]) => {
    const dstDir = dstDirs.get(dirKey)!;
    for (const rel of paths) {
      try {
        if (combinedBlob && meta.blobOffsets) {
          const entry = meta.blobOffsets[rel];
          if (!entry) throw new Error('offset not found in blobOffsets');
          const slice = combinedBlob.slice(entry.offset, entry.offset + entry.length);
          const fileName = rel.split('/').pop()!;
          const fh = await dstDir.getFileHandle(fileName, { create: true });
          const w = await fh.createWritable();
          await w.write(slice);
          await w.close();
          okCount++;
        } else {
          const fileName = rel.split('/').pop()!;
          let snapSub = snapDir;
          if (dirKey) {
            for (const seg of dirKey.split('/')) snapSub = await snapSub.getDirectoryHandle(seg);
          }
          const srcHandle = await snapSub.getFileHandle(fileName);
          const file = await srcHandle.getFile();
          const fh = await dstDir.getFileHandle(fileName, { create: true });
          const w = await fh.createWritable();
          await w.write(file);
          await w.close();
          okCount++;
        }
      } catch (e) {
        const blob = blobBuffer?.get(rel);
        if (blob) {
          try {
            const fileName = rel.split('/').pop()!;
            const fh = await dstDir.getFileHandle(fileName, { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
            okCount++;
          } catch (e2) {
            failed.push(rel);
            console.warn('[SNAPSHOT] 还原被删文件失败（blob fallback 也不行）', rel, (e2 as Error).message);
          }
        } else {
          failed.push(rel);
          console.warn('[SNAPSHOT] 还原被删文件失败', rel, (e as Error).message);
        }
      }
    }
  });
  await Promise.all(delTasks);
  console.log(`[RESTORE] deletedFiles-write(${meta.deletedFiles?.length ?? 0}): ok=${okCount}, failed=${failed.length}, ${(performance.now() - t3).toFixed(0)}ms`);

  if (failed.length > 0) {
    console.error(`[RESTORE] ${failed.length} 个文件恢复失败，保留快照目录不删除`);
    console.error('[RESTORE] 失败样本:', failed.slice(0, 5));
    return false;
  }

  const t4 = performance.now();
  try { await backupRoot.removeEntry(snap.dirName, { recursive: true }); } catch { /* skip */ }
  console.log(`[RESTORE] cleanup: ${(performance.now() - t4).toFixed(0)}ms`);
  console.log(`[RESTORE] total: ${(performance.now() - t0).toFixed(0)}ms`);

  return true;
}

function groupByDir(rels: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const rel of rels) {
    const parts = rel.split('/');
    parts.pop();
    const key = parts.join('/');
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(rel);
  }
  return m;
}
