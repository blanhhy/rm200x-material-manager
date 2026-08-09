import iconv from 'iconv-lite';
import type { AssetCategory, EngineVersion } from '../types/index';
import mappingData from './rtp-data/rtp-mapping.json';
import rtpFilesData from './rtp-data/rtp-files.json';

// ── Types ───────────────────────────────────────────────────────────

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

/** One RTP source's available files: rtpTableDir → Set<lowercase stem> */
export type RtpFileSet = Map<string, Set<string>>;

// ── Load mapping data ───────────────────────────────────────────────

const mapping = mappingData as unknown as MappingData;
const rtpFiles = rtpFilesData as unknown as RtpFiles;

const EN_RTP_DIR: Record<EngineVersion, string> = {
  '2k': '2000en',
  '2k3': '2003steam',
};

const CATEGORY_TO_RTP_DIR: Record<AssetCategory, string> = mapping.categoryToRtpDir;

type RowEntry = { rowIdx: number; row: MappingRow };

// ── Name variant encoding ───────────────────────────────────────────

function addKey(idx: Record<string, RowEntry>, key: string, entry: RowEntry) {
  if (!idx[key.toLowerCase()]) idx[key.toLowerCase()] = entry;
}

function encodeVariants(name: string): string[] {
  const out: string[] = [name];
  try { out.push(iconv.decode(iconv.encode(name, 'big5'), 'gbk')); } catch {}
  try { out.push(iconv.decode(iconv.encode(name, 'gbk'), 'big5')); } catch {}
  try { out.push(iconv.decode(iconv.encode(name, 'shift_jis'), 'gbk')); } catch {}
  try { out.push(iconv.decode(iconv.encode(name, 'gbk'), 'shift_jis')); } catch {}
  return out;
}

// ── Build mapping index (language-agnostic) ─────────────────────────

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
const ALL_RTP_DIRS_2K = Object.keys(ROWS_2K);
const ALL_RTP_DIRS_2K3 = Object.keys(ROWS_2K3);

// ── Built-in file sets ──────────────────────────────────────────────

function buildBuiltinFileSet(engine: EngineVersion): RtpFileSet {
  const enDir = EN_RTP_DIR[engine];
  const cats = rtpFiles[enDir];
  const fs = new Map<string, Set<string>>();
  if (cats) {
    for (const [k, fileList] of Object.entries(cats)) {
      fs.set(k.toLowerCase(), new Set(fileList.map(f => f.toLowerCase())));
    }
  }
  return fs;
}

const BUILTIN_FS_2K = buildBuiltinFileSet('2k');
const BUILTIN_FS_2K3 = buildBuiltinFileSet('2k3');

function getBuiltinFileSet(engine: EngineVersion): RtpFileSet {
  return engine === '2k3' ? BUILTIN_FS_2K3 : BUILTIN_FS_2K;
}

// ── Mapping lookup (pure, no file existence check) ──────────────────

function lookupInMapping(
  dbName: string,
  engine: EngineVersion,
  preferredRtpDir?: string,
): RowEntry | null {
  if (!dbName) return null;
  const rowsByName = engine === '2k3' ? ROWS_2K3 : ROWS_2K;
  const key = dbName.toLowerCase();

  if (preferredRtpDir) {
    const entry = rowsByName[preferredRtpDir]?.[key];
    if (entry) return entry;
  }

  const allDirs = engine === '2k3' ? ALL_RTP_DIRS_2K3 : ALL_RTP_DIRS_2K;
  for (const dir of allDirs) {
    if (dir === preferredRtpDir) continue;
    const entry = rowsByName[dir]?.[key];
    if (entry) return entry;
  }
  return null;
}

/** Check if dbName is a known RTP asset name (any language, mapping-only, no file check) */
export function isRTPAsset(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): boolean {
  if (!dbName) return false;
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  return lookupInMapping(dbName, engine, rtpTableDir) !== null;
}

// ── FileSet helpers ─────────────────────────────────────────────────

function matchRowInFileSet(entry: RowEntry, fileSet: RtpFileSet): string | null {
  const dir = entry.row[0];
  const dirFiles = fileSet.get(dir.toLowerCase());
  if (!dirFiles) return null;
  // Iterate columns: try English first (col 2 = index 2 in most tables), then others
  const colOrder = [2, 1, 3, 4]; // en → ja → donMiguel → addon
  for (const col of colOrder) {
    const name = entry.row[col];
    if (name && dirFiles.has(name.toLowerCase())) return name;
  }
  return null;
}

/** Check if the asset is available in the given RTP file set */
export function isRTPInFileSet(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
  fileSet: RtpFileSet,
): boolean {
  if (!dbName) return false;
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  const entry = lookupInMapping(dbName, engine, rtpTableDir);
  if (!entry) return false;
  return matchRowInFileSet(entry, fileSet) !== null;
}

/** Get the best matching filename for the asset in the given file set */
export function lookupRTPInFileSet(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
  fileSet: RtpFileSet,
): string | null {
  if (!dbName) return null;
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  const entry = lookupInMapping(dbName, engine, rtpTableDir);
  if (!entry) return null;
  return matchRowInFileSet(entry, fileSet);
}

// ── Active source management (module-level) ─────────────────────────

type ActiveRtpSource = {
  fileSet: RtpFileSet;
  kind: 'builtin' | 'disk';
  diskHandle?: FileSystemDirectoryHandle;
} | null;

let activeSource: ActiveRtpSource = null;

export function setActiveRtpSource(source: ActiveRtpSource): void {
  activeSource = source;
}

export function getActiveRtpFileSet(): RtpFileSet | null {
  return activeSource?.fileSet ?? null;
}

export function getActiveRtpKind(): 'builtin' | 'disk' | null {
  return activeSource?.kind ?? null;
}

export function getActiveRtpDiskHandle(): FileSystemDirectoryHandle | null {
  return activeSource?.diskHandle ?? null;
}

// ── Public API (convenience wrappers using active source) ───────────

/** Check if the RTP asset is available in the currently active RTP source */
export function isRTPAvailable(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): boolean {
  if (!activeSource) return false;
  return isRTPInFileSet(dbName, category, engine, activeSource.fileSet);
}

/** Get display name (best match from active source) */
export function lookupRTPDisplayName(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): string | null {
  if (!activeSource) return null;
  return lookupRTPInFileSet(dbName, category, engine, activeSource.fileSet);
}

/** Get file info (dir + filename) from the active source for disk loading */
export function lookupRTPFileInfo(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): { rtpDir: string; fileName: string } | null {
  if (!activeSource) return null;
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  const entry = lookupInMapping(dbName, engine, rtpTableDir);
  if (!entry) return null;
  const name = matchRowInFileSet(entry, activeSource.fileSet);
  if (!name) return null;
  return { rtpDir: entry.row[0], fileName: name };
}

// ── Built-in bundle URL ─────────────────────────────────────────────

/** Get bundle URL for built-in RTP image preview */
export function getRtpBundleUrl(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): string | null {
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  if (!rtpTableDir) return null;
  // Look up English name in builtin file set
  const enStem = lookupRTPInFileSet(dbName, category, engine, getBuiltinFileSet(engine));
  if (!enStem) return null;
  return `${import.meta.env.BASE_URL}rtp/${engine}/${rtpTableDir}/${enStem}.png`;
}

// ── Disk RTP scanning ───────────────────────────────────────────────

const KNOWN_RTP_DIRS = new Set([
  'backdrop', 'battle', 'battle2', 'battlecharset', 'battleweapon',
  'charset', 'chipset', 'faceset', 'gameover', 'monster',
  'music', 'panorama', 'picture', 'sound', 'system', 'system2', 'title',
]);

/** Scan a disk directory and build an RTP file set. Returns null if no valid RTP subdirs found. */
export async function scanDiskRtpFileSet(
  rootHandle: FileSystemDirectoryHandle,
): Promise<RtpFileSet | null> {
  const fs: RtpFileSet = new Map();
  let foundAny = false;
  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind === 'directory' && KNOWN_RTP_DIRS.has(name.toLowerCase())) {
      const dirFiles = new Set<string>();
      for await (const [fname] of handle.entries()) {
        const stem = fname.replace(/\.[^.]+$/, '').toLowerCase();
        dirFiles.add(stem);
      }
      fs.set(name.toLowerCase(), dirFiles);
      foundAny = true;
    }
  }
  return foundAny ? fs : null;
}

// ── Legacy compat (kept for assetAnalyzer which only checks mapping) ─

/** @deprecated Use isRTPAvailable() for active-source check. This only checks mapping. */
export function lookupRTPAlternative(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): string | null {
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  const entry = lookupInMapping(dbName, engine, rtpTableDir);
  if (!entry) return null;
  // Try English first
  for (let col = 2; col < entry.row.length; col++) {
    if (entry.row[col]) return entry.row[col];
  }
  return entry.row[1] ?? null;
}

/** Initialize builtin RTP as the active source */
export function initBuiltinRtp(engine: EngineVersion): void {
  activeSource = {
    fileSet: getBuiltinFileSet(engine),
    kind: 'builtin',
  };
}

/** Initialize disk RTP as the active source */
export function initDiskRtp(
  fileSet: RtpFileSet,
  diskHandle: FileSystemDirectoryHandle,
): void {
  activeSource = { fileSet, kind: 'disk', diskHandle };
}
