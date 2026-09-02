import { decodeDatabase, decodeMapUnit, decodeTreeMap } from 'rpgrt';
import type { Database, MapUnit, MapInfo, TreeMap, EngineVersion } from 'rpgrt';
import type { ProjectGameData, EncodingName } from '../types/index';
import { makeTranscoder } from './internal/lcfIo';
import { detectEncoding, readEncodingFromIni } from './encodingDetect';

function readAll(handle: FileSystemFileHandle): Promise<Uint8Array> {
  return handle.getFile().then(f => f.arrayBuffer()).then(b => new Uint8Array(b));
}

export async function safeGetFileHandle(root: FileSystemDirectoryHandle, name: string): Promise<FileSystemFileHandle> {
  try {
    return await root.getFileHandle(name);
  } catch (e) {
    const err = e as DOMException;
    if (err?.name === 'TypeError' && /name is not allowed/i.test(err?.message ?? '')) {
      for await (const [entryName, entry] of root.entries()) {
        if (entryName === name && entry.kind === 'file') return entry as FileSystemFileHandle;
      }
      throw e;
    }
    throw e;
  }
}

export function detectEngine(ldbBuf: Uint8Array): EngineVersion {
  try {
    const probe = decodeDatabase(ldbBuf, { engine: '2k' });
    const sys = probe.system as { ldbId?: number } | undefined;
    if (sys?.ldbId === 2003) return '2k3';
    if (probe.classes?.length > 0) return '2k3';
    return '2k';
  } catch {
    return '2k3';
  }
}

function parseIni(iniText: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let cur = '';
  for (let line of iniText.split(/\r?\n/)) {
    line = line.replace(/^\uFEFF/, '').trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) { cur = m[1].trim(); sections[cur] = {}; continue; }
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (cur) sections[cur][key] = val;
    }
  }
  console.log('[INI PARSE] sections:', Object.keys(sections), 'RPG_RT keys:', sections['RPG_RT'] ? Object.keys(sections['RPG_RT']) : '(none)');
  if (sections['RPG_RT']?.GameTitle) console.log('[INI PARSE] GameTitle =', JSON.stringify(sections['RPG_RT'].GameTitle));
  return sections;
}

export async function loadGameProject(root: FileSystemDirectoryHandle): Promise<ProjectGameData> {
  const result: ProjectGameData = {
    rootHandle: root,
    database: null,
    treeMap: null,
    maps: new Map(),
    mapInfos: new Map(),
    encoding: 'latin1',
    engine: '2k',
    rpgIni: null,
    rawIni: null,
  };

  let iniBuf: Uint8Array | null = null;
  try {
    const iniHandle = await safeGetFileHandle(root, 'RPG_RT.ini');
    iniBuf = await readAll(iniHandle);
    console.log('[INI] found, size=', iniBuf.length, 'first10 hex=', Array.from(iniBuf.slice(0,10)).map(b => b.toString(16).padStart(2,'0')).join(' '));
  } catch (e) {
    const err = e as DOMException;
    if (err?.name === 'NotFoundError') {
      console.log('[INI] not found (no RPG_RT.ini in project root)');
    } else {
      console.error('[INI] read FAILED:', err?.name, err?.message, err);
    }
  }
  result.rawIni = iniBuf;

  let ldbBuf: Uint8Array;
  try {
    const ldbHandle = await safeGetFileHandle(root, 'RPG_RT.ldb');
    ldbBuf = await readAll(ldbHandle);
  } catch (e) {
    throw new Error(`无法加载 RPG_RT.ldb: ${(e as Error).message}`);
  }
  result.rawLdb = ldbBuf;

  // 详细诊断：试两种 engine 看 version
  let engine: EngineVersion = '2k';
  try {
    const db2k = decodeDatabase(ldbBuf, { engine: '2k' });
    const sys = db2k.system as { ldbId?: number } | undefined;
    // 可靠的引擎判断依据（参考 EasyRPG lcf::GetEngineVersion）：
    // 1. system.ldb_id == 2003 → RPG Maker 2003
    // 2. classes 数组非空 → 2003（2000 没有这个数组）
    if (sys?.ldbId === 2003) {
      engine = '2k3';
    } else if (db2k.classes?.length > 0) {
      engine = '2k3';
    }
    console.log('[ENGINE DECIDE] ldbId=', sys?.ldbId, 'classes=', db2k.classes?.length, '→', engine);
  } catch (e) {
    console.log('[ENGINE PROBE] 2k threw:', e);
    engine = '2k3';
  }
  result.engine = engine;

  // 编码判定：EasyRPG 项目可在 RPG_RT.ini 的 [EasyRPG] 段显式声明 Encoding，
  // 无显式声明时采用自动检测。
  const iniEnc = readEncodingFromIni(iniBuf);
  let encoding: EncodingName;
  if (iniEnc) {
    encoding = iniEnc;
    console.log(`[ENCODE INI-DECLARED] ${encoding}`);
  } else {
    // 读所有 .lmu 文件用于编码推断
    const lmuBufs: Uint8Array[] = [];
    try {
      for await (const [entryName, entry] of root.entries()) {
        if (entry.kind === 'file' && /^Map\d{4}\.lmu$/i.test(entryName)) {
          lmuBufs.push(await readAll(entry as FileSystemFileHandle));
        }
      }
      if (lmuBufs.length > 0) {
        console.log(`[ENCODE EXTRA] loaded ${lmuBufs.length} .lmu files for scoring`);
      }
    } catch (e) {
      console.warn('[ENCODE EXTRA] failed to scan .lmu:', (e as Error).message);
    }
    encoding = detectEncoding(ldbBuf, engine, lmuBufs);
  }
  result.encoding = encoding;
  const transcoder = makeTranscoder(encoding);

  if (iniBuf) {
    const iniText = transcoder.decode(iniBuf);
    result.rpgIni = parseIni(iniText);
  }

  result.database = decodeDatabase(ldbBuf, { engine: result.engine, transcoder });

  try {
    const lmtHandle = await safeGetFileHandle(root, 'RPG_RT.lmt');
    const lmtBuf = await readAll(lmtHandle);
    result.rawLmt = lmtBuf;
    result.treeMap = decodeTreeMap(lmtBuf, { engine: result.engine, transcoder });
    if (result.treeMap?.maps) {
      for (const mi of result.treeMap.maps) {
        result.mapInfos.set(mi.id, mi);
      }
    }
  } catch { /* no lmt */ }

  // 遍历目录加载所有 .lmu 地图。
  // 不要假设编号连续
  try {
    for await (const [entryName, entry] of root.entries()) {
      if (entry.kind !== 'file') continue;
      const m = /^Map(\d{4})\.lmu$/i.exec(entryName);
      if (!m) continue;
      const mapId = Number(m[1]);
      try {
        const muBuf = await readAll(entry as FileSystemFileHandle);
        const mu = decodeMapUnit(muBuf, { engine: result.engine, transcoder });
        result.maps.set(mapId, mu);
      } catch (e) {
        console.warn(`[MAP LOAD] decode failed ${entryName}:`, (e as Error).message);
      }
    }
  } catch (e) {
    console.warn('[MAP LOAD] failed to scan .lmu:', (e as Error).message);
  }

  return result;
}

export type { Database, MapUnit, MapInfo, TreeMap };

/**
 * 用指定编码重新 decode 已加载项目的 LDB/LMT/LMU。
 * 从磁盘重新读取 bytes（因为磁盘可能被 rename 或 snapshot 改了）。
 */
export async function reDecodeWithEncoding(
  data: ProjectGameData,
  encoding: string,
): Promise<ProjectGameData> {
  const enc = encoding as EncodingName;
  const transcoder = makeTranscoder(enc);
  const newData: ProjectGameData = { ...data, encoding: enc };

  if (data.rootHandle) {
    try {
      const ldbHandle = await safeGetFileHandle(data.rootHandle, 'RPG_RT.ldb');
      const ldbBuf = await readAll(ldbHandle);
      newData.rawLdb = ldbBuf;
      newData.database = decodeDatabase(ldbBuf, { engine: data.engine, transcoder });
    } catch {
      // fallback: 用缓存
      if (data.rawLdb) {
        newData.database = decodeDatabase(data.rawLdb, { engine: data.engine, transcoder });
      }
    }

    try {
      const lmtHandle = await safeGetFileHandle(data.rootHandle, 'RPG_RT.lmt');
      const lmtBuf = await readAll(lmtHandle);
      newData.rawLmt = lmtBuf;
      newData.treeMap = decodeTreeMap(lmtBuf, { engine: data.engine, transcoder });
      newData.mapInfos = new Map();
      if (newData.treeMap?.maps) {
        for (const mi of newData.treeMap.maps) {
          newData.mapInfos.set(mi.id, mi);
        }
      }
    } catch {
      if (data.rawLmt) {
        newData.treeMap = decodeTreeMap(data.rawLmt, { engine: data.engine, transcoder });
      }
    }

    try {
      const iniHandle = await safeGetFileHandle(data.rootHandle, 'RPG_RT.ini');
      const iniBuf = await readAll(iniHandle);
      newData.rawIni = iniBuf;
      newData.rpgIni = parseIni(transcoder.decode(iniBuf));
      console.log('[RE-DECODE INI] OK, size=', iniBuf.length);
    } catch (e) {
      const err = e as DOMException;
      console.warn('[RE-DECODE INI] failed:', err?.name, err?.message);
      if (data.rawIni) {
        newData.rpgIni = parseIni(transcoder.decode(data.rawIni));
        console.log('[RE-DECODE INI] fallback used cached rawIni');
      }
    }

    // 遍历目录加载所有 .lmu。
    newData.maps = new Map();
    try {
      for await (const [entryName, entry] of data.rootHandle.entries()) {
        if (entry.kind !== 'file') continue;
        const m = /^Map(\d{4})\.lmu$/i.exec(entryName);
        if (!m) continue;
        const mapId = Number(m[1]);
        try {
          const muBuf = await readAll(entry as FileSystemFileHandle);
          newData.maps.set(mapId, decodeMapUnit(muBuf, { engine: data.engine, transcoder }));
        } catch (e) {
          console.warn(`[RE-DECODE MAP] decode failed ${entryName}:`, (e as Error).message);
        }
      }
    } catch (e) {
      console.warn('[RE-DECODE MAP] failed to scan .lmu:', (e as Error).message);
    }
  } else {
    // 没有 rootHandle，只能用缓存
    if (data.rawLdb) {
      newData.database = decodeDatabase(data.rawLdb, { engine: data.engine, transcoder });
    }
    if (data.rawLmt) {
      newData.treeMap = decodeTreeMap(data.rawLmt, { engine: data.engine, transcoder });
    }
  }

  return newData;
}