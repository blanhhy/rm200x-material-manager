const BACKUP_DIR = '.rmm-backup';
const MAX_SNAPSHOTS = 20;

export interface SnapshotInfo {
  dirName: string;
  timestamp: number;
  files: string[];
  label: string;
}

async function ensureDir(root: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> {
  return await root.getDirectoryHandle(name, { create: true });
}

/**
 * 递归创建子目录并把文件复制进去。
 * `relPath` 形如 'Picture/花.png' —— 在 backup root 下建 Picture/ 再放花.png
 */
async function copyFileIntoBackup(
  srcRoot: FileSystemDirectoryHandle,
  backupRoot: FileSystemDirectoryHandle,
  relPath: string,
) {
  const parts = relPath.split('/');
  const fileName = parts.pop()!;
  let srcDir = srcRoot;
  let dstDir = backupRoot;
  for (const seg of parts) {
    srcDir = await srcDir.getDirectoryHandle(seg);
    dstDir = await ensureDir(dstDir, seg);
  }
  const srcHandle = await srcDir.getFileHandle(fileName);
  try {
    // 浏览器原生 copyTo
    await (srcHandle as FileSystemFileHandle & { copyTo?: (target: FileSystemDirectoryHandle, newName?: string) => Promise<FileSystemFileHandle> })
      .copyTo!(dstDir, fileName);
  } catch {
    // Fallback: 读 → 写
    const file = await srcHandle.getFile();
    const newHandle = await dstDir.getFileHandle(fileName, { create: true });
    const w = await newHandle.createWritable();
    await w.write(file);
    await w.close();
  }
}

/**
 * 从 backup 目录把文件复制回项目根。
 * 反向操作：backup root 下的 relPath → src root 下的 relPath
 */
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
  // 覆盖写入
  const dstHandle = await dstDir.getFileHandle(fileName, { create: true });
  const w = await dstHandle.createWritable();
  await w.write(file);
  await w.close();
}

/**
 * 对重命名操作做快照：oldRelPath + newRelPath 都要记住。
 * 恢复时：先把覆盖写的文件还原，再把 asset 从 new 名改回 old 名。
 * 但更简单的做法：快照记录 { filesBefore: [...], rename?: { from, to } }，
 * 恢复时先还原 filesBefore，再做 rename(new→old)。
 * 这里我们在快照里存一个 meta.json 记录 rename 信息。
 */
export async function createSnapshot(
  root: FileSystemDirectoryHandle,
  files: string[],        // 将要被覆盖写入的相对路径列表
  renameInfo?: { fromRel: string; toRel: string; label?: string },
  filesToDelete?: string[], // 将要被删除的文件（需要快照以便恢复）
): Promise<SnapshotInfo | null> {
  try {
    const backupRoot = await ensureDir(root, BACKUP_DIR);
    const dirName = new Date().toISOString().replace(/[:.]/g, '-');
    const snapDir = await ensureDir(backupRoot, dirName);

    const filesBefore: string[] = [];
    for (const rel of files) {
      try {
        await copyFileIntoBackup(root, snapDir, rel);
        filesBefore.push(rel);
      } catch {
        // 文件可能不存在，跳过
      }
    }

    if (renameInfo) {
      try {
        await copyFileIntoBackup(root, snapDir, renameInfo.fromRel);
        filesBefore.push(renameInfo.fromRel);
      } catch { /* skip */ }
    }

    const deletedFiles: string[] = [];
    if (filesToDelete) {
      for (const rel of filesToDelete) {
        try {
          await copyFileIntoBackup(root, snapDir, rel);
          deletedFiles.push(rel);
        } catch { /* skip */ }
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
      label: meta.label,
    };
  } catch (e) {
    console.warn('[SNAPSHOT] 创建失败：', e);
    return null;
  }
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
        label: meta.label ?? '',
      });
    } catch { /* skip bad snapshot */ }
  }
  result.sort((a, b) => b.timestamp - a.timestamp);
  return result;
}

export async function restoreSnapshot(root: FileSystemDirectoryHandle, snap: SnapshotInfo): Promise<boolean> {
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

  // 1. 如果有 rename：磁盘当前是 to 名，先把它 move 回 from 名
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

  // 2. 还原所有被覆盖写的文件
  for (const rel of meta.filesBefore) {
    if (rel === meta.rename?.from) continue;
    try {
      await copyFileFromBackup(snapDir, root, rel);
    } catch (e) {
      console.warn('[SNAPSHOT] 还原文件失败', rel, e);
    }
  }

  // 3. 还原所有被删除的文件（从备份复制回去）
  for (const rel of meta.deletedFiles ?? []) {
    try {
      await copyFileFromBackup(snapDir, root, rel);
    } catch (e) {
      console.warn('[SNAPSHOT] 还原被删文件失败', rel, e);
    }
  }

  // 还原成功，删掉这个快照
  try { await backupRoot.removeEntry(snap.dirName, { recursive: true }); } catch { /* skip */ }

  return true;
}
