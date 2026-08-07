const BACKUP_DIR = '.rmm-backup';
const MAX_SNAPSHOTS = 20;

export interface SnapshotInfo {
  dirName: string;
  timestamp: number;
  files: string[];
  deletedFiles?: string[];
  label: string;
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

async function copyFileFromBackup(
  backupRoot: FileSystemDirectoryHandle,
  dstRoot: FileSystemDirectoryHandle,
  relPath: string,
) {
  const parts = relPath.split('/');
  const fileName = parts.pop()!;
  let srcDir = backupRoot;
  let dstDir = dstRoot;
  for (const seg of parts) {
    srcDir = await srcDir.getDirectoryHandle(seg);
    dstDir = await ensureDir(dstDir, seg);
  }
  const srcHandle = await srcDir.getFileHandle(fileName);
  const file = await srcHandle.getFile();
  const dstHandle = await dstDir.getFileHandle(fileName, { create: true });
  const w = await dstHandle.createWritable();
  await w.write(file);
  await w.close();
}

export async function createSnapshot(
  root: FileSystemDirectoryHandle,
  files: string[],
  renameInfo?: { fromRel: string; toRel: string; label?: string },
  filesToDelete?: string[],
  blobBuffer?: Map<string, ArrayBuffer>,
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
    if (filesToDelete && filesToDelete.length > 0) {
      if (blobBuffer && blobBuffer.size > 0) {
        console.time('[SNAPSHOT] blob-write deleted');
        deletedFiles.push(...await batchWriteBlobs(dstDirs!, filesToDelete, blobBuffer));
        console.timeEnd('[SNAPSHOT] blob-write deleted');
      } else {
        console.time('[SNAPSHOT] batch-copy deleted');
        deletedFiles.push(...await batchCopy(srcDirs!, dstDirs!, filesToDelete));
        console.timeEnd('[SNAPSHOT] batch-copy deleted');
      }
    }

    let label = renameInfo?.label ?? '';
    if (!label && deletedFiles.length > 0) {
      label = `删除 ${deletedFiles.length} 个素材`;
    }

    const meta = {
      filesBefore,
      rename: renameInfo ? { from: renameInfo.fromRel, to: renameInfo.toRel } : null,
      deletedFiles,
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
  blobBuffer: Map<string, ArrayBuffer>,
): Promise<string[]> {
  // Chrome File System Access API 对同一个目录并行 createWritable 有竞态 bug
  // 所以按目录分组，目录内串行，跨目录并行
  const byDir = new Map<string, string[]>();
  for (const rel of relPaths) {
    const parts = rel.split('/');
    parts.pop();
    const dirKey = parts.join('/');
    if (!byDir.has(dirKey)) byDir.set(dirKey, []);
    byDir.get(dirKey)!.push(rel);
  }

  const tasks = [...byDir.entries()].map(async ([dirKey, paths]) => {
    const dstDir = dstDirs.get(dirKey)!;
    const ok: string[] = [];
    for (const rel of paths) {
      const buf = blobBuffer.get(rel);
      if (!buf) { console.warn('[SNAPSHOT] buffer not found:', rel); continue; }
      const fileName = rel.split('/').pop()!;
      try {
        const fh = await dstDir.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(buf.slice(0));
        await w.close();
        ok.push(rel);
      } catch (e) {
        console.warn('[SNAPSHOT] blob write failed:', rel, (e as Error).message);
      }
    }
    return ok;
  });

  const totalBytes = relPaths.reduce((s, p) => s + (blobBuffer.get(p)?.byteLength ?? 0), 0);
  const results = await Promise.all(tasks);
  const ok = results.flat();
  console.log(`[SNAPSHOT] batchWriteBlobs: ${ok.length}/${relPaths.length} ok, dirs=${byDir.size}, totalBytes=${totalBytes}`);
  return ok;
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

export async function restoreSnapshot(
  root: FileSystemDirectoryHandle,
  snap: SnapshotInfo,
  blobBuffer?: Map<string, ArrayBuffer>,
): Promise<boolean> {
  const backupRoot = await root.getDirectoryHandle(BACKUP_DIR).catch(() => null);
  if (!backupRoot) return false;
  const snapDir = await backupRoot.getDirectoryHandle(snap.dirName).catch(() => null);
  if (!snapDir) return false;

  let meta: { filesBefore: string[]; rename: { from: string; to: string } | null; deletedFiles: string[] };
  try {
    const metaHandle = await snapDir.getFileHandle('meta.json');
    meta = JSON.parse(await (await metaHandle.getFile()).text());
  } catch {
    return false;
  }

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

  for (const rel of meta.filesBefore) {
    if (rel === meta.rename?.from) continue;
    try {
      await copyFileFromBackup(snapDir, root, rel);
    } catch (e) {
      console.warn('[SNAPSHOT] 还原文件失败', rel, e);
    }
  }

  for (const rel of meta.deletedFiles ?? []) {
    try {
      await copyFileFromBackup(snapDir, root, rel);
    } catch (e) {
      const blob = blobBuffer?.get(rel);
      if (blob) {
        try {
          const parts = rel.split('/');
          const fileName = parts.pop()!;
          let dstDir = root;
          for (const seg of parts) dstDir = await ensureDir(dstDir, seg);
          const fh = await dstDir.getFileHandle(fileName, { create: true });
          const w = await fh.createWritable();
          await w.write(blob.slice(0));
          await w.close();
        } catch (e2) {
          console.warn('[SNAPSHOT] 还原被删文件失败（blob 也不行）', rel, e2);
        }
      } else {
        console.warn('[SNAPSHOT] 还原被删文件失败，且无内存备份', rel, e);
      }
    }
  }

  try { await backupRoot.removeEntry(snap.dirName, { recursive: true }); } catch { /* skip */ }

  return true;
}
