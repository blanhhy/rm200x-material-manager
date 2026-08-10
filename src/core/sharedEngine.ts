import iconv from 'iconv-lite';
import type { Transcoder } from 'rpgrt';
import type { AssetCategory } from '../types/index';

/** 编码名到 iconv-lite 编码名的映射（仅 euc_jp 需要转换） */
export function resolveIconvEncoding(enc: string): string {
  return enc === 'euc_jp' ? 'eucjp' : enc;
}

export function makeTranscoder(enc: string): Transcoder {
  const target = resolveIconvEncoding(enc);
  return {
    decode(bytes: Uint8Array): string { return iconv.decode(bytes, target); },
    encode(str: string): Uint8Array { return new Uint8Array(iconv.encode(str, target)); },
  };
}

export async function writeFile(root: FileSystemDirectoryHandle, fileName: string, data: Uint8Array) {
  const handle = await root.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data as unknown as ArrayBuffer);
  await writable.close();
}

/** 事件命令码 → 引用的素材类别 */
export function refCatForEventCode(code: number): AssetCategory | null {
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

/** System 表中引用 Music 的字段 */
export const SYSTEM_MUSIC_FIELDS = [
  'titleMusic', 'battleMusic', 'battleEndMusic', 'innMusic',
  'boatMusic', 'shipMusic', 'airshipMusic', 'gameoverMusic',
];

/** System 表中引用 Sound 的字段 */
export const SYSTEM_SOUND_FIELDS = [
  'cursorSe', 'decisionSe', 'cancelSe', 'buzzerSe',
  'battleSe', 'escapeSe', 'enemyAttackSe', 'enemyDamagedSe',
  'actorDamagedSe', 'dodgeSe', 'enemyDeathSe', 'itemSe',
];

/** System 表中引用 CharSet 的载具字段 */
export const SYSTEM_VEHICLE_FIELDS = ['boatName', 'shipName', 'airshipName'];
