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

function addKey(idx: Record<string, RowEntry[]>, key: string, entry: RowEntry) {
  const k = key.toLowerCase();
  if (!idx[k]) idx[k] = [];
  idx[k].push(entry);
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

function buildRowIndex(rows: MappingRow[]): Record<string, Record<string, RowEntry[]>> {
  const idx: Record<string, Record<string, RowEntry[]>> = {};
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
): RowEntry[] {
  if (!dbName || !preferredRtpDir) return [];
  const key = dbName.toLowerCase();

  const results: RowEntry[] = [];
  // Search current engine first, then the other (cross-engine RTP compat)
  const engines: EngineVersion[] = engine === '2k3' ? ['2k3', '2k'] : ['2k', '2k3'];

  for (const eng of engines) {
    const rowsByName = eng === '2k3' ? ROWS_2K3 : ROWS_2K;
    const entries = rowsByName[preferredRtpDir]?.[key];
    if (entries) for (const e of entries) if (!results.some(r => r.rowIdx === e.rowIdx && r.row === e.row)) results.push(e);
  }

  return results;
}

/** Check if dbName is a known RTP asset name (any language, mapping-only, no file check) */
export function isRTPAsset(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): boolean {
  if (!dbName) return false;
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  return lookupInMapping(dbName, engine, rtpTableDir).length > 0;
}

// ── FileSet helpers ─────────────────────────────────────────────────

function matchRowInFileSet(entry: RowEntry, fileSet: RtpFileSet): string | null {
  const dir = entry.row[0];
  const dirFiles = fileSet.get(dir.toLowerCase());
  if (!dirFiles) return null;
  // Iterate columns: try English first (col 2 = index 2 in most tables), then others
  const colOrder = [2, 1, 3, 4, 5, 6, 7]; // en → ja → donMiguel → addon → ko → zh
  for (const col of colOrder) {
    const name = entry.row[col];
    if (name && dirFiles.has(name.toLowerCase())) return name;
  }
  return null;
}

/** Try all mapping entries against the fileSet, return first match */
function matchEntriesInFileSet(entries: RowEntry[], fileSet: RtpFileSet): string | null {
  for (const entry of entries) {
    const name = matchRowInFileSet(entry, fileSet);
    if (name) return name;
  }
  return null;
}

/** Check if the asset directly matches a file in the fileSet (no mapping) */
function isRTPDirectMatch(
  dbName: string,
  category: AssetCategory,
  fileSet: RtpFileSet,
): boolean {
  if (!dbName) return false;
  const rtpDir = CATEGORY_TO_RTP_DIR[category];
  if (!rtpDir) return false;
  const dirFiles = fileSet.get(rtpDir.toLowerCase());
  if (!dirFiles) return false;
  return dirFiles.has(dbName.toLowerCase());
}

/** Find direct filename match in fileSet */
function lookupRTPDirectMatch(
  dbName: string,
  category: AssetCategory,
  fileSet: RtpFileSet,
): string | null {
  if (!dbName) return null;
  const rtpDir = CATEGORY_TO_RTP_DIR[category];
  if (!rtpDir) return null;
  const dirFiles = fileSet.get(rtpDir.toLowerCase());
  if (!dirFiles) return null;
  const key = dbName.toLowerCase();
  return dirFiles.has(key) ? dbName : null;
}

/** Check if the asset is available in the given RTP file set */
function isRTPInFileSet(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
  fileSet: RtpFileSet,
): boolean {
  if (!dbName) return false;
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  const entries = lookupInMapping(dbName, engine, rtpTableDir);
  if (entries.length > 0) {
    return matchEntriesInFileSet(entries, fileSet) !== null;
  }
  // Fallback: direct filename match (for standard tracks not in mapping)
  return isRTPDirectMatch(dbName, category, fileSet);
}

/** Get the best matching filename for the asset in the given file set */
function lookupRTPInFileSet(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
  fileSet: RtpFileSet,
): string | null {
  if (!dbName) return null;
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  const entries = lookupInMapping(dbName, engine, rtpTableDir);
  if (entries.length > 0) {
    const mapped = matchEntriesInFileSet(entries, fileSet);
    if (mapped) return mapped;
  }
  return lookupRTPDirectMatch(dbName, category, fileSet);
}

// ── Active source management (module-level) ─────────────────────────

type ActiveRtpSource = {
  fileSet: RtpFileSet;
  kind: 'builtin' | 'disk';
  diskHandle?: FileSystemDirectoryHandle;
  /** lowercase rtpDir → actual disk directory name */
  dirNames?: Map<string, string>;
} | null;

let activeSource: ActiveRtpSource = null;

/** Registry of disk RTP sources by ID, for switching between them */
const diskSourceRegistry = new Map<string, { fileSet: RtpFileSet; diskHandle: FileSystemDirectoryHandle; dirNames: Map<string, string> }>();

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
  const name = lookupRTPInFileSet(dbName, category, engine, activeSource.fileSet);
  if (!name) return null;
  // Determine which rtpDir this match came from
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  const entries = lookupInMapping(dbName, engine, rtpTableDir);
  if (entries.length > 0) {
    // Check if the match came from mapping (returns mapping dir) or direct (returns category dir)
    const mapped = matchEntriesInFileSet(entries, activeSource.fileSet);
    if (mapped === name) return { rtpDir: entries[0].row[0], fileName: name };
  }
  return { rtpDir: rtpTableDir, fileName: name };
}

// ── Built-in bundle URL ─────────────────────────────────────────────

/** Default extension for builtin RTP files by category */
export const CATEGORY_RTP_EXT: Partial<Record<AssetCategory, string>> = {
  Music: '.mid',
  Sound: '.wav',
  Movie: '.avi',
};

/** Stems in the Music directory that are actually .wav files (SE sounds bundled with Music) */
const MUSIC_WAV_STEMS = new Set([
  'clock', 'earthquake', 'rain1', 'rain2', 'sea',
  'seclock', 'seearthquake', 'serain', 'serain2', 'sesea',
  'se-alarm', 'se-bird', 'se-clock', 'se-crowd', 'se-gale',
  'se-jungle', 'se-ocean', 'se-quake', 'se-rain', 'se-torrent',
]);

/** Get bundle URL for built-in RTP asset */
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
  // Always use lowercase stem to match rtp-files.json canonical names
  const stem = enStem.toLowerCase();
  const ext = (category === 'Music' && MUSIC_WAV_STEMS.has(stem))
    ? '.wav'
    : CATEGORY_RTP_EXT[category] ?? '.png';
  return `${import.meta.env.BASE_URL}rtp/${engine}/${rtpTableDir}/${stem}${ext}`;
}

// ── Disk RTP scanning ───────────────────────────────────────────────

const KNOWN_RTP_DIRS = new Set([
  'backdrop', 'battle', 'battle2', 'battlecharset', 'battleweapon',
  'charset', 'chipset', 'faceset', 'gameover', 'monster',
  'music', 'panorama', 'picture', 'sound', 'system', 'system2', 'title',
]);

/** Get the actual disk directory name for a given rtpDir (lowercase) */
export function resolveRtpDirName(rtpDir: string): string | null {
  return activeSource?.dirNames?.get(rtpDir.toLowerCase()) ?? null;
}

/** Scan a disk directory, returning the fileSet and a dirNames map (lowercase→actual). Returns null if no valid RTP subdirs found. */
export async function scanDiskRtpFileSet(
  rootHandle: FileSystemDirectoryHandle,
): Promise<{ fileSet: RtpFileSet; dirNames: Map<string, string> } | null> {
  const fs: RtpFileSet = new Map();
  const dirNames = new Map<string, string>();
  let foundAny = false;
  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind === 'directory' && KNOWN_RTP_DIRS.has(name.toLowerCase())) {
      const dirFiles = new Set<string>();
      for await (const [fname] of handle.entries()) {
        const stem = fname.replace(/\.[^.]+$/, '').toLowerCase();
        dirFiles.add(stem);
      }
      const lower = name.toLowerCase();
      fs.set(lower, dirFiles);
      dirNames.set(lower, name);
      foundAny = true;
    }
  }
  return foundAny ? { fileSet: fs, dirNames } : null;
}

// ── Legacy compat (kept for assetAnalyzer which only checks mapping) ─

/** @deprecated Use isRTPAvailable() for active-source check. This only checks mapping. */
export function lookupRTPAlternative(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): string | null {
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  const entries = lookupInMapping(dbName, engine, rtpTableDir);
  if (entries.length === 0) return null;
  // Try English first across all entries
  for (const entry of entries) {
    for (let col = 2; col < entry.row.length; col++) {
      if (entry.row[col]) return entry.row[col];
    }
  }
  return entries[0].row[1] ?? null;
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
  id: string,
  fileSet: RtpFileSet,
  diskHandle: FileSystemDirectoryHandle,
  dirNames: Map<string, string>,
): void {
  const entry = { fileSet, diskHandle, dirNames };
  diskSourceRegistry.set(id, entry);
  activeSource = { fileSet, kind: 'disk', diskHandle, dirNames };
}

/** Switch to a previously registered disk RTP source */
export function activateDiskRtp(id: string): boolean {
  const entry = diskSourceRegistry.get(id);
  if (!entry) return false;
  activeSource = {
    fileSet: entry.fileSet,
    kind: 'disk',
    diskHandle: entry.diskHandle,
    dirNames: entry.dirNames,
  };
  return true;
}
