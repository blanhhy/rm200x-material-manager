import iconv from 'iconv-lite';
import type { Transcoder } from 'rpgrt';

/** 按指定编码构造 rpgrt 用的转码器 */
export function makeTranscoder(enc: string): Transcoder {
  return {
    decode(bytes: Uint8Array): string { return iconv.decode(bytes, enc); },
    encode(str: string): Uint8Array { return new Uint8Array(iconv.encode(str, enc)); },
  };
}

/** 覆盖写入游戏根目录下的单个文件 */
export async function writeFile(root: FileSystemDirectoryHandle, fileName: string, data: Uint8Array) {
  const handle = await root.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data as unknown as ArrayBuffer);
  await writable.close();
}
