import iconv from 'iconv-lite';
import type { AssetCategory, AssetReference, EngineVersion } from '../types/index';
import { getPrimaryExt } from '../scanner/assetTypes';
import { ASSET_DIRECTORIES } from '../scanner/assetTypes';
import mappingData from './data/rtp-mapping.json';
import rtpFilesData from './data/rtp-files.json';

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
  [engine: string]: { [category: string]: string[] };
}

/** One RTP source's available files: rtpTableDir → Set<lowercase stem> */
export type RtpFileSet = Map<string, Set<string>>;

// ── Load mapping data ───────────────────────────────────────────────

const mapping = mappingData as unknown as MappingData;
const rtpFiles = rtpFilesData as unknown as RtpFiles;

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

function buildBuiltinFileSet(engine: EngineVersion, full = false): RtpFileSet {
  const cats = rtpFiles[engine];
  const fs = new Map<string, Set<string>>();
  // tsx / node 等非 Vite 环境没有 import.meta.env
  const isProd = (import.meta as any).env?.PROD === true;
  if (cats) {
    for (const [k, fileList] of Object.entries(cats)) {
      const lowerK = k.toLowerCase();
      // 在线版生产构建不打包音频；full 模式保留音频（对齐仓库 public/rtp 完整托管），供注入回退下载
      if (!full && isProd && (lowerK === 'music' || lowerK === 'sound')) continue;
      fs.set(lowerK, new Set(fileList.map(f => f.toLowerCase())));
    }
  }
  return fs;
}

const BUILTIN_FS_2K = buildBuiltinFileSet('2k');
const BUILTIN_FS_2K3 = buildBuiltinFileSet('2k3');
/** 完整内置文件集（含音频，对齐仓库 public/rtp），用于解析 RTP 下载 URL */
const FULL_FS_2K = buildBuiltinFileSet('2k', true);
const FULL_FS_2K3 = buildBuiltinFileSet('2k3', true);

function getFullBuiltinFileSet(engine: EngineVersion): RtpFileSet {
  return engine === '2k3' ? FULL_FS_2K3 : FULL_FS_2K;
}

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

/** Stems in the Music directory that are actually .wav files (SE sounds bundled with Music) */
const MUSIC_WAV_STEMS = new Set([
  'clock', 'earthquake', 'rain1', 'rain2', 'sea',
  'seclock', 'seearthquake', 'serain', 'serain2', 'sesea',
  'se-alarm', 'se-bird', 'se-clock', 'se-crowd', 'se-gale',
  'se-jungle', 'se-ocean', 'se-quake', 'se-rain', 'se-torrent',
]);

/** Vite 注入的 base 路径（tsx/node 等非 Vite 环境回退为 '/'） */
const BASE_URL = (import.meta as any).env?.BASE_URL as string | undefined ?? '/';

/** 用完整内置文件集（含音频）解析英文标准名 stem（小写）。不受在线版生产构建剔除音频影响。 */
function lookupFullEnglishStem(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): string | null {
  if (!dbName) return null;
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  if (!rtpTableDir) return null;
  const full = getFullBuiltinFileSet(engine);
  const name = lookupRTPInFileSet(dbName, category, engine, full);
  return name ? name.toLowerCase() : null;
}

/** stem 对应的下载扩展名（Music 目录里实为 wav 的 SE 用 .wav，其余按类别首选扩展名） */
function rtpStemExt(stem: string, category: AssetCategory): string {
  return (category === 'Music' && MUSIC_WAV_STEMS.has(stem)) ? '.wav' : getPrimaryExt(category);
}

/**
 * RTP 内置素材的下载候选 URL。
 * 在线版生产构建不打包音频，本地 bundle 可能拿不到；
 * 但仓库 public/rtp 完整托管了所有 RTP（含 music/sound），可回退到 GitHub raw 下载。
 */
const RTP_REPO_RAW_BASE = 'https://raw.githubusercontent.com/blanhhy/rm200x-material-manager/main/public';

/** RTP 素材在仓库 public/ 下的相对路径（rtp/<engine>/<dir>/<stem>.<ext>），用作本地缓存键，与 BASE_URL / 域名解耦 */
export function getRtpRelPath(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): string | null {
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  if (!rtpTableDir) return null;
  const stem = lookupFullEnglishStem(dbName, category, engine);
  if (!stem) return null;
  return `rtp/${engine}/${rtpTableDir}/${stem}${rtpStemExt(stem, category)}`;
}

/**
 * 注入时的有序候选下载源。
 * 本地 bundle 实际包含该文件时才放 local——生产构建不含音频，音频会直接跳过 local，避免必然 404；
 * 仓库 raw 始终兜底（public/rtp 完整托管，含音频）。
 */
export function getRtpSourceUrls(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): string[] {
  const relPath = getRtpRelPath(dbName, category, engine);
  if (!relPath) return [];
  const urls: string[] = [];
  if (lookupRTPInFileSet(dbName, category, engine, getBuiltinFileSet(engine))) {
    urls.push(`${BASE_URL}${relPath}`);
  }
  urls.push(`${RTP_REPO_RAW_BASE}/${relPath}`);
  return urls;
}

// ── Disk RTP scanning ───────────────────────────────────────────────

// Valid RTP subdirectory names (derived from ASSET_DIRECTORIES, lowercased)
const KNOWN_RTP_DIRS = new Set(ASSET_DIRECTORIES.map(d => d.toLowerCase()));

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

// ── RTP 名称标准化 ─────────────────────────────────────────────────

/** 标准化目标：映射表中"英文标准名"列的索引（2k=en，2k3=enOfficial，恰好都是列 2） */
const EN_NAME_COL = 2;

/**
 * 找出 dbName 对应的 Steam 英文标准 RTP 名（映射表英文列；2k=en，2k3=enOfficial，索引都是 2）。
 * - 输入已命中某行的英文列 → 已是标准名，返回 null（不重命名）
 * - 英文列缺失 → 返回 null（绝不回退到 韩/俄/西/葡/繁中 等其他语言列，避免把英文名改成外文）
 */
export function lookupRtpStandardName(
  dbName: string,
  category: AssetCategory,
  engine: EngineVersion,
): string | null {
  if (!dbName) return null;
  const rtpTableDir = CATEGORY_TO_RTP_DIR[category];
  if (!rtpTableDir) return null;
  const entries = lookupInMapping(dbName, engine, rtpTableDir);
  if (entries.length === 0) return null;
  const inputKey = dbName.trim().toLowerCase();
  for (const e of entries) {
    const name = e.row[EN_NAME_COL];
    if (typeof name !== 'string') continue;
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (/[/\\]/.test(trimmed)) continue; // 不是合法文件名
    if (trimmed.toLowerCase() === inputKey) return null; // 已是 Steam 英文标准名
    return trimmed;
  }
  return null;
}

export interface RtpNormalizeItem {
  category: AssetCategory;
  oldName: string;
  newName: string;
}

/** 从引用集合计算"非英文 RTP 名 → 英文标准名"的唯一重命名清单。 */
export function buildRtpNormalizePlan(
  refs: Iterable<Pick<AssetReference, 'category' | 'assetName'>>,
  engine: EngineVersion,
): RtpNormalizeItem[] {
  const seen = new Map<string, RtpNormalizeItem>();
  for (const r of refs) {
    if (!r.assetName) continue;
    const en = lookupRtpStandardName(r.assetName, r.category, engine);
    if (!en) continue;
    const key = `${r.category}\u0000${r.assetName.trim().toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, { category: r.category, oldName: r.assetName.trim(), newName: en });
  }
  return Array.from(seen.values());
}

/** Initialize builtin RTP as the active source */
export function initBuiltinRtp(engine: EngineVersion): void {
  // 内置 RTP 完整含音频（本地 bundle 缺的音频由仓库 raw 兜底），故用完整文件集判断可用性
  activeSource = {
    fileSet: getFullBuiltinFileSet(engine),
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
