import iconv from 'iconv-lite';
import type { AssetCategory, EngineVersion } from '../types/index';
import mappingData from './rtp-data/rtp-mapping.json';
import rtpFilesData from './rtp-data/rtp-files.json';

type MappingRow = string[];

type MappingTables = {
  '2k': { numCols: number; colNames: string[]; rows: MappingRow[] };
  '2k3': { numCols: number; colNames: string[]; rows: MappingRow[] };
};

interface MappingData {
  version: number;
  tables: MappingTables;
  categoryToRtpDir: Record<AssetCategory, string>;
}

interface RtpFiles {
  [dirName: string]: { [category: string]: string[] };
}

const mapping = mappingData as unknown as MappingData;
const rtpFiles = rtpFilesData as unknown as RtpFiles;

const EN_RTP_DIR: Record<EngineVersion, string> = {
  '2k': '2000en',
  '2k3': '2003steam',
};

const CATEGORY_TO_RTP_DIR: Record<AssetCategory, string> = mapping.categoryToRtpDir;

type RowEntry = { rowIdx: number; row: MappingRow };

function addKey(idx: Record<string, RowEntry>, key: string, entry: RowEntry) {
  const k = key.toLowerCase();
  if (!idx[k]) idx[k] = entry;
}

function encodeVariants(name: string): string[] {
  const out: string[] = [name];
  try { out.push(iconv.decode(iconv.encode(name, 'big5'), 'gbk')); } catch {}
  try { out.push(iconv.decode(iconv.encode(name, 'gbk'), 'big5')); } catch {}
  try { out.push(iconv.decode(iconv.encode(name, 'shift_jis'), 'gbk')); } catch {}
  try { out.push(iconv.decode(iconv.encode(name, 'gbk'), 'shift_jis')); } catch {}
  return out;
}

function buildRowIndex(rows: MappingRow[]): Record<string, Record<string, RowEntry>> {
  const idx: Record<string, Record<string, RowEntry>> = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dir = row[0];
    if (!dir) continue;
    if (!idx[dir]) idx[dir] = {};
    const entry: RowEntry = { rowIdx: i, row };
    for (let col = 1; col < row.length; col++) {
      const name = row[col];
      if (!name) continue;
      for (const variant of encodeVariants(name)) {
        addKey(idx[dir], variant, entry);
      }
    }
  }
  return idx;
}

const ROWS_2K = buildRowIndex(mapping.tables['2k'].rows);
const ROWS_2K3 = buildRowIndex(mapping.tables['2k3'].rows);

// All unique dirs in the mapping tables (e.g. "backdrop", "battle", ...)
const ALL_RTP_DIRS_2K = Object.keys(ROWS_2K);
const ALL_RTP_DIRS_2K3 = Object.keys(ROWS_2K3);

function getEnRtpFilesByDir(engine: EngineVersion, rtpTableDir: string): Set<string> | null {
  const enDir = EN_RTP_DIR[engine];
  const cats = rtpFiles[enDir];
  if (!cats) return null;
  for (const [k, files] of Object.entries(cats)) {
    if (k.toLowerCase() === rtpTableDir.toLowerCase()) {
      return new Set(files.map(f => f.toLowerCase()));
    }
  }
  return null;
}

function matchRowAgainstEnFiles(
  entry: RowEntry,
  engine: EngineVersion,
): boolean {
  const dir = entry.row[0];
  const enFiles = getEnRtpFilesByDir(engine, dir);
  if (!enFiles) return false;
  for (let col = 1; col < entry.row.length; col++) {
    const name = entry.row[col];
    if (!name) continue;
    if (enFiles.has(name.toLowerCase())) return true;
  }
  return false;
}

function tryLookup(
  dbName: string,
  engine: EngineVersion,
  preferredRtpDir?: string,
): RowEntry | null {
  const rowsByName = engine === '2k3' ? ROWS_2K3 : ROWS_2K;

  if (preferredRtpDir) {
    const entry = rowsByName[preferredRtpDir]?.[dbName.toLowerCase()];
    if (entry && matchRowAgainstEnFiles(entry, engine)) return entry;
  }

  // Fallback: search ALL dirs (handles category mixing, e.g. Backdrop used as Panorama)
  const allDirs = engine === '2k3' ? ALL_RTP_DIRS_2K3 : ALL_RTP_DIRS_2K;
  for (const dir of allDirs) {
    if (dir === preferredRtpDir) continue;
    const entry = rowsByName[dir]?.[dbName.toLowerCase()];
    if (entry && matchRowAgainstEnFiles(entry, engine)) return entry;
  }
  return null;
}

export function isRTPAsset(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): boolean {
  if (!dbName) return false;
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  return tryLookup(dbName, engine, rtpTableDir) !== null;
}

export function lookupRTPAlternative(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): string | null {
  if (!dbName) return null;
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  const entry = tryLookup(dbName, engine, rtpTableDir);
  if (!entry) return null;
  const dir = entry.row[0];
  const enFiles = getEnRtpFilesByDir(engine, dir);
  if (!enFiles) return null;
  for (let col = 1; col < entry.row.length; col++) {
    const name = entry.row[col];
    if (!name) continue;
    if (enFiles.has(name.toLowerCase())) return name;
  }
  return null;
}

/**
 * 获取内置 RTP 图片的 URL。
 * 统一映射为英文文件名，定位到 public/rtp/{engine}/{rtpDir}/{stem}.png
 */
export function getBundledRtpUrl(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): string | null {
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  if (!rtpTableDir) return null;
  const enStem = lookupRTPAlternative(dbName, category, engine);
  if (!enStem) return null;
  return `${import.meta.env.BASE_URL}rtp/${engine}/${rtpTableDir}/${enStem}.png`;
}
