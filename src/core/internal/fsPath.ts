/** 按游戏根目录相对路径取目录句柄；`dirRel` 为空表示根目录本身。 */
export async function getDirHandleByRelPath(
  root: FileSystemDirectoryHandle,
  dirRel: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let handle = root;
  for (const seg of dirRel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') throw new Error('路径不能向上越出游戏根目录');
    handle = await handle.getDirectoryHandle(seg, { create });
  }
  return handle;
}

/** 按游戏根目录相对路径取文件句柄。 */
export async function getFileHandleByRelPath(
  root: FileSystemDirectoryHandle,
  fileRel: string,
): Promise<FileSystemFileHandle> {
  const dir = await getDirHandleByRelPath(root, dirRelOf(fileRel));
  return dir.getFileHandle(baseOf(fileRel));
}

export function dirRelOf(relPath: string): string {
  const slash = relPath.lastIndexOf('/');
  return slash < 0 ? '' : relPath.slice(0, slash);
}

export function baseOf(relPath: string): string {
  const slash = relPath.lastIndexOf('/');
  return slash < 0 ? relPath : relPath.slice(slash + 1);
}
