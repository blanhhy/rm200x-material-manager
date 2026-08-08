import iconv from 'iconv-lite';
import {
  encodeDatabase,
  encodeMapUnit,
  encodeTreeMap,
} from 'rpgrt';
import type { Database, MapUnit, TreeMap, Transcoder, MapInfo } from 'rpgrt';
import type { AssetCategory, AssetFile, ProjectGameData } from '../types/index';
import { createSnapshot } from './snapshot';
import { useStore } from '../store/useStore';
import { prefetchedFileData } from '../scanner/assetScanner';

export interface DeleteResult {
  success: boolean;
  message: string;
  filesWritten: string[];
  filesDeleted: string[];
  deletedBlobs?: Map<string, Blob>;
}

function refCatForEventCode(code: number): AssetCategory | null {
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

function groupNamesByCategory(assets: AssetFile[]): Map<AssetCategory, Set<string>> {
  const map = new Map<AssetCategory, Set<string>>();
  for (const a of assets) {
    let set = map.get(a.category);
    if (!set) { set = new Set(); map.set(a.category, set); }
    set.add(a.stem.trim().toLowerCase());
  }
  return map;
}

function matchesAny(val: string | undefined | null, names: Set<string>): boolean {
  if (val == null) return false;
  return names.has(val.trim().toLowerCase());
}

function dbReferencesCategory(db: Database, namesByCat: Map<AssetCategory, Set<string>>): boolean {
  const categories = new Set<AssetCategory>(namesByCat.keys());

  const sys = db.system as unknown as Record<string, unknown> | undefined;
  if (sys) {
    if (categories.has('System')) {
      const picFields = ['titleName', 'gameoverName', 'systemName', 'system2Name', 'frameName'];
      for (const f of picFields) if (matchesAny(sys[f] as string | undefined, namesByCat.get('System')!)) return true;
    }
    if (categories.has('Backdrop')) {
      const v = sys['battletestBackground'] as string | undefined;
      if (matchesAny(v, namesByCat.get('Backdrop')!)) return true;
    }
    if (categories.has('Music')) {
      const musicFields = ['titleMusic','battleMusic','battleEndMusic','innMusic','boatMusic','shipMusic','airshipMusic','gameoverMusic'];
      for (const f of musicFields) {
        const m = sys[f] as { name?: string } | undefined;
        if (matchesAny(m?.name, namesByCat.get('Music')!)) return true;
      }
    }
    if (categories.has('Sound')) {
      const seFields = ['cursorSe','decisionSe','cancelSe','buzzerSe','battleSe','escapeSe','enemyAttackSe','enemyDamagedSe','actorDamagedSe','dodgeSe','enemyDeathSe','itemSe'];
      for (const f of seFields) {
        const s = sys[f] as { name?: string } | undefined;
        if (matchesAny(s?.name, namesByCat.get('Sound')!)) return true;
      }
    }
    if (categories.has('CharSet')) {
      const vehicleFields = ['boatName', 'shipName', 'airshipName'];
      for (const f of vehicleFields) if (matchesAny(sys[f] as string | undefined, namesByCat.get('CharSet')!)) return true;
    }
  }

  if (categories.has('CharSet') || categories.has('FaceSet')) {
    const chars = namesByCat.get('CharSet');
    const faces = namesByCat.get('FaceSet');
    for (const actor of db.actors ?? []) {
      if (chars && matchesAny(actor.characterName, chars)) return true;
      if (faces && matchesAny(actor.faceName, faces)) return true;
    }
  }
  if (categories.has('ChipSet')) {
    const names = namesByCat.get('ChipSet')!;
    for (const cs of db.chipsets ?? []) if (matchesAny(cs.chipsetName, names)) return true;
  }
  if (categories.has('Panorama') || categories.has('Backdrop') || categories.has('Sound')) {
    const pans = namesByCat.get('Panorama');
    const backs = namesByCat.get('Backdrop');
    const sounds = namesByCat.get('Sound');
    for (const t of db.terrains ?? []) {
      if (backs && matchesAny(t.backgroundName, backs)) return true;
      if (pans && matchesAny(t.backgroundAName, pans)) return true;
      if (pans && matchesAny(t.backgroundBName, pans)) return true;
      if (sounds) {
        const fs = t.footstep as { name?: string } | undefined;
        if (matchesAny(fs?.name, sounds)) return true;
      }
    }
  }
  if (categories.has('BattleCharSet') || categories.has('BattleWeapon')) {
    const poses = namesByCat.get('BattleCharSet');
    const weps = namesByCat.get('BattleWeapon');
    for (const ba of db.battleranimations ?? []) {
      if (poses) for (const p of ba.poses ?? []) if (matchesAny(p.battlerName, poses)) return true;
      if (weps) for (const w of ba.weapons ?? []) if (matchesAny(w.weaponName, weps)) return true;
    }
  }
  if (categories.has('Monster')) {
    const names = namesByCat.get('Monster')!;
    for (const e of db.enemies ?? []) if (matchesAny(e.battlerName, names)) return true;
  }
  if (categories.has('Battle') || categories.has('Battle2') || categories.has('Sound')) {
    const battles = new Set<string>();
    const b = namesByCat.get('Battle');
    const b2 = namesByCat.get('Battle2');
    if (b) for (const n of b) battles.add(n);
    if (b2) for (const n of b2) battles.add(n);
    const sounds = namesByCat.get('Sound');
    for (const anim of db.animations ?? []) {
      if (battles.size > 0 && matchesAny(anim.animationName, battles)) return true;
      if (sounds) for (const t of anim.timings ?? []) {
        const se = t.se as { name?: string } | undefined;
        if (matchesAny(se?.name, sounds)) return true;
      }
    }
  }

  const eventCats = new Set<AssetCategory>();
  for (const cat of categories) {
    if (['CharSet','FaceSet','Music','Sound','System','Picture','Movie','Panorama','Backdrop'].includes(cat)) {
      eventCats.add(cat);
    }
  }
  if (eventCats.size > 0) {
    const eventNamesByRefCat = new Map<AssetCategory, Set<string>>();
    for (const cat of eventCats) {
      eventNamesByRefCat.set(cat, namesByCat.get(cat)!);
    }
    const searchCmds = (cmds: any[]) => {
      for (const cmd of cmds ?? []) {
        const refCat = refCatForEventCode(cmd.code);
        if (refCat && eventCats.has(refCat)) {
          if (matchesAny(cmd.string, eventNamesByRefCat.get(refCat)!)) return true;
        }
      }
      return false;
    };
    if (db.commonevents) for (const ce of db.commonevents) if (searchCmds(ce.eventCommands as any[])) return true;
    if (db.troops) for (const troop of db.troops) for (const page of troop.pages ?? []) if (searchCmds(page.eventCommands as any[])) return true;
  }

  return false;
}

export function applyClearToDatabase(
  db: Database,
  namesByCat: Map<AssetCategory, Set<string>>,
): boolean {
  let changed = false;
  const check = (val: string | undefined | null, refCat: AssetCategory, set: (v: string) => void) => {
    if (val == null) return;
    const names = namesByCat.get(refCat);
    if (!names) return;
    const lc = val.trim().toLowerCase();
    if (names.has(lc)) { set(''); changed = true; }
  };

  const allNamesBattle = namesByCat.get('Battle');
  const allNamesBattle2 = namesByCat.get('Battle2');
  const allNamesBattleOr2 = new Set<string>();
  if (allNamesBattle) for (const n of allNamesBattle) allNamesBattleOr2.add(n);
  if (allNamesBattle2) for (const n of allNamesBattle2) allNamesBattleOr2.add(n);

  const sys = db.system as unknown as Record<string, unknown> | undefined;
  if (sys) {
    const pictureFields = ['titleName', 'gameoverName', 'systemName', 'system2Name', 'frameName', 'battletestBackground'];
    for (const f of pictureFields) check(sys[f] as string | undefined, f === 'battletestBackground' ? 'Backdrop' : 'System', v => { sys[f] = v; });
    const musicFields = ['titleMusic','battleMusic','battleEndMusic','innMusic','boatMusic','shipMusic','airshipMusic','gameoverMusic'];
    for (const f of musicFields) {
      const m = sys[f] as { name?: string } | undefined;
      if (m?.name) check(m.name, 'Music', v => { m.name = v; });
    }
    const seFields = ['cursorSe','decisionSe','cancelSe','buzzerSe','battleSe','escapeSe','enemyAttackSe','enemyDamagedSe','actorDamagedSe','dodgeSe','enemyDeathSe','itemSe'];
    for (const f of seFields) {
      const s = sys[f] as { name?: string } | undefined;
      if (s?.name) check(s.name, 'Sound', v => { s.name = v; });
    }
    const vehicleFields = ['boatName', 'shipName', 'airshipName'];
    for (const f of vehicleFields) check(sys[f] as string | undefined, 'CharSet', v => { sys[f] = v; });
  }

  for (const actor of db.actors ?? []) {
    check(actor.characterName, 'CharSet', v => { actor.characterName = v; });
    check(actor.faceName, 'FaceSet', v => { actor.faceName = v; });
  }

  for (const cs of db.chipsets ?? []) {
    check(cs.chipsetName, 'ChipSet', v => { cs.chipsetName = v; });
  }

  for (const t of db.terrains ?? []) {
    check(t.backgroundName, 'Backdrop', v => { t.backgroundName = v; });
    check(t.backgroundAName, 'Panorama', v => { t.backgroundAName = v; });
    check(t.backgroundBName, 'Panorama', v => { t.backgroundBName = v; });
    const fs = t.footstep as { name?: string } | undefined;
    if (fs?.name) check(fs.name, 'Sound', v => { fs.name = v; });
  }

  for (const ba of db.battleranimations ?? []) {
    for (const pose of ba.poses ?? []) check(pose.battlerName, 'BattleCharSet', v => { pose.battlerName = v; });
    for (const wep of ba.weapons ?? []) check(wep.weaponName, 'BattleWeapon', v => { wep.weaponName = v; });
  }

  for (const enemy of db.enemies ?? []) {
    check(enemy.battlerName, 'Monster', v => { enemy.battlerName = v; });
  }

  for (const anim of db.animations ?? []) {
    if (allNamesBattleOr2.size > 0) {
      const names = anim.animationName?.trim().toLowerCase();
      if (names && allNamesBattleOr2.has(names)) { anim.animationName = ''; changed = true; }
    }
    for (const timing of anim.timings ?? []) {
      const se = timing.se as { name?: string } | undefined;
      if (se?.name) check(se.name, 'Sound', v => { se.name = v; });
    }
  }

  for (const ce of db.commonevents ?? []) {
    for (const cmd of ce.eventCommands ?? []) {
      const refCat = refCatForEventCode(cmd.code);
      if (refCat && cmd.string !== undefined) check(cmd.string, refCat, v => { cmd.string = v; });
    }
  }

  for (const troop of db.troops ?? []) {
    for (const page of troop.pages ?? []) {
      for (const cmd of page.eventCommands ?? []) {
        const refCat = refCatForEventCode(cmd.code);
        if (refCat && cmd.string !== undefined) check(cmd.string, refCat, v => { cmd.string = v; });
      }
    }
  }

  return changed;
}

export function applyClearToMapUnit(
  mu: MapUnit,
  namesByCat: Map<AssetCategory, Set<string>>,
): boolean {
  let changed = false;
  const check = (val: string | undefined | null, refCat: AssetCategory, set: (v: string) => void) => {
    if (val == null) return;
    const names = namesByCat.get(refCat);
    if (!names) return;
    if (names.has(val.trim().toLowerCase())) { set(''); changed = true; }
  };

  check(mu.parallaxName, 'Panorama', v => { mu.parallaxName = v; });

  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      check(page.characterName, 'CharSet', v => { page.characterName = v; });

      for (const cmd of page.eventCommands ?? []) {
        const refCat = refCatForEventCode(cmd.code);
        if (refCat && cmd.string !== undefined) check(cmd.string, refCat, v => { cmd.string = v; });
      }

      const charsetNames = namesByCat.get('CharSet');
      const soundNames = namesByCat.get('Sound');
      if (charsetNames || soundNames) {
        for (const mc of page.moveRoute?.moveCommands ?? []) {
          if (mc.commandId === 34 && charsetNames && mc.parameterString && charsetNames.has(mc.parameterString.trim().toLowerCase())) {
            mc.parameterString = ''; changed = true;
          } else if (mc.commandId === 35 && soundNames && mc.parameterString && soundNames.has(mc.parameterString.trim().toLowerCase())) {
            mc.parameterString = ''; changed = true;
          }
        }
      }
    }
  }

  return changed;
}

export function applyClearToMapInfo(
  mi: MapInfo,
  namesByCat: Map<AssetCategory, Set<string>>,
): boolean {
  let changed = false;

  if (mi.musicType === 2) {
    const m = mi.music as { name?: string } | undefined;
    if (m?.name) {
      const musicNames = namesByCat.get('Music');
      if (musicNames && musicNames.has(m.name.trim().toLowerCase())) {
        m.name = '';
        changed = true;
      }
    }
  }
  if (mi.backgroundName) {
    const picNames = namesByCat.get('Picture');
    if (picNames && picNames.has(mi.backgroundName.trim().toLowerCase())) {
      mi.backgroundName = '';
      changed = true;
    }
  }

  return changed;
}

function mapReferencesCategory(mu: MapUnit, namesByCat: Map<AssetCategory, Set<string>>): boolean {
  const cats = new Set<AssetCategory>(namesByCat.keys());
  const checkMap = (val: string | undefined | null, refCat: AssetCategory): boolean => {
    if (!cats.has(refCat)) return false;
    return matchesAny(val, namesByCat.get(refCat)!);
  };

  if (checkMap(mu.parallaxName, 'Panorama')) return true;

  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      if (checkMap(page.characterName, 'CharSet')) return true;

      for (const cmd of page.eventCommands ?? []) {
        const refCat = refCatForEventCode(cmd.code);
        if (refCat && checkMap(cmd.string, refCat)) return true;
      }

      const charsetNames = namesByCat.get('CharSet');
      const soundNames = namesByCat.get('Sound');
      if (charsetNames || soundNames) {
        for (const mc of page.moveRoute?.moveCommands ?? []) {
          if (mc.commandId === 34 && charsetNames && matchesAny(mc.parameterString, charsetNames)) return true;
          if (mc.commandId === 35 && soundNames && matchesAny(mc.parameterString, soundNames)) return true;
        }
      }
    }
  }
  return false;
}

function mapInfoReferencesCategory(mi: MapInfo, namesByCat: Map<AssetCategory, Set<string>>): boolean {
  if (mi.musicType === 2 && namesByCat.has('Music')) {
    const m = mi.music as { name?: string } | undefined;
    if (matchesAny(m?.name, namesByCat.get('Music')!)) return true;
  }
  if (mi.backgroundName && namesByCat.has('Picture')) {
    if (matchesAny(mi.backgroundName, namesByCat.get('Picture')!)) return true;
  }
  return false;
}

function makeTranscoder(enc: string): Transcoder {
  const map: Record<string, string> = {
    latin1: 'latin1', gbk: 'gbk', shift_jis: 'shift_jis', euc_jp: 'eucjp', utf8: 'utf8',
  };
  const target = map[enc] ?? enc;
  return {
    decode(bytes: Uint8Array): string { return iconv.decode(bytes, target); },
    encode(str: string): Uint8Array { return new Uint8Array(iconv.encode(str, target)); },
  };
}

async function writeFile(root: FileSystemDirectoryHandle, fileName: string, data: Uint8Array) {
  const handle = await root.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data as unknown as ArrayBuffer);
  await writable.close();
}

export async function deleteAssets(
  data: ProjectGameData,
  assets: AssetFile[],
  clearReferences: boolean = false,
): Promise<DeleteResult> {
  if (!data.encoding) {
    return { success: false, message: '项目编码未知', filesWritten: [], filesDeleted: [] };
  }
  if (assets.length === 0) {
    return { success: false, message: '没有选中素材', filesWritten: [], filesDeleted: [] };
  }

  const transcoder = makeTranscoder(data.encoding);
  console.time('[DELETE] total');
  console.log(`[DELETE] ${assets.length} 个素材, clearRefs=${clearReferences}`);

  const namesByCat = groupNamesByCategory(assets);

  let needDbClone = false;
  let needTreeMapClone = false;
  const mapsNeedingClone: number[] = [];

  if (clearReferences && namesByCat.size > 0) {
    console.time('[DELETE] pre-scan');
    needDbClone = data.database ? dbReferencesCategory(data.database, namesByCat) : false;

    if (data.treeMap) {
      for (const mi of data.treeMap.maps ?? []) {
        if (mapInfoReferencesCategory(mi, namesByCat)) {
          needTreeMapClone = true;
          break;
        }
      }
    }

    for (const [mapId, mu] of data.maps) {
      if (mapReferencesCategory(mu, namesByCat)) {
        mapsNeedingClone.push(mapId);
      }
    }
    console.timeEnd('[DELETE] pre-scan');
  }

  const root = data.rootHandle!;
  const diskAssets = assets.filter(a => a.handle !== undefined);
  const filesToDelete = diskAssets.map(a => a.path);

  let dbClone: Database | null = null;
  let treeMapClone: TreeMap | null = null;
  const mapClones = new Map<number, MapUnit>();
  let dbChanged = false;
  let changedMapInfoIds = new Set<number>();
  let changedMapIds = new Set<number>();

  if (needDbClone || needTreeMapClone || mapsNeedingClone.length > 0) {
    console.time('[DELETE] clone+apply');
    if (needDbClone && data.database) {
      const dc: Database = JSON.parse(JSON.stringify(data.database));
      dbClone = dc;
      dbChanged = applyClearToDatabase(dc, namesByCat);
    }
    if (needTreeMapClone && data.treeMap) {
      const tmc: TreeMap = JSON.parse(JSON.stringify(data.treeMap));
      treeMapClone = tmc;
      for (const mi of tmc.maps ?? []) {
        if (applyClearToMapInfo(mi, namesByCat)) changedMapInfoIds.add(mi.id);
      }
    }
    for (const mapId of mapsNeedingClone) {
      const mu = data.maps.get(mapId);
      if (!mu) continue;
      const muClone = JSON.parse(JSON.stringify(mu));
      if (applyClearToMapUnit(muClone, namesByCat)) {
        changedMapIds.add(mapId);
        mapClones.set(mapId, muClone);
      }
    }
    console.timeEnd('[DELETE] clone+apply');
  }

  const willWrite: string[] = [];
  if (dbChanged || changedMapInfoIds.size > 0 || changedMapIds.size > 0) {
    willWrite.push('RPG_RT.ldb');
    if (changedMapInfoIds.size > 0) willWrite.push('RPG_RT.lmt');
  }
  for (const mapId of changedMapIds) willWrite.push(`Map${String(mapId).padStart(4, '0')}.lmu`);

  // 从内存 ArrayBuffer 读文件内容，用于快照备份
  // 优先用 scanner 预读存入模块级 Map 的数据（绕过 React/Zustand 的序列化截断）
  console.time('[DELETE] read-blobs');

  const blobResults = await Promise.allSettled(
    diskAssets.map(async (a) => {
      const pre = prefetchedFileData.get(a.path);
      if (pre instanceof Blob && pre.size > 0) {
        return { path: a.path, blob: pre };
      }
      const fh = a.handle!;
      const f = await fh.getFile();
      return { path: a.path, blob: f };
    })
  );
  const deletedBlobs = new Map<string, Blob>();
  for (const r of blobResults) {
    if (r.status === 'fulfilled') deletedBlobs.set(r.value.path, r.value.blob);
    else console.warn('[DELETE] read blob failed:', (r as PromiseRejectedResult).reason);
  }
  console.timeEnd('[DELETE] read-blobs');

  // 同步快照只针对"要被覆盖写的文件"（通常 0-2 个），小文件很快
  console.time('[DELETE] snapshot-db');
  if (willWrite.length > 0) {
    await createSnapshot(root, willWrite);
  }
  console.timeEnd('[DELETE] snapshot-db');

  const filesWritten: string[] = [];

  console.time('[DELETE] encode-write');
  if (dbChanged || changedMapInfoIds.size > 0 || changedMapIds.size > 0) {
    if (treeMapClone && changedMapInfoIds.size > 0) {
      const lmtEncoded = encodeTreeMap(treeMapClone, { engine: data.engine, transcoder });
      await writeFile(root, 'RPG_RT.lmt', lmtEncoded);
      filesWritten.push('RPG_RT.lmt');
    }
    if (dbClone) {
      const ldbEncoded = encodeDatabase(dbClone, { engine: data.engine, transcoder });
      await writeFile(root, 'RPG_RT.ldb', ldbEncoded);
      filesWritten.push('RPG_RT.ldb');
    }

    for (const [mapId, muClone] of mapClones) {
      const encoded = encodeMapUnit(muClone, { engine: data.engine, transcoder });
      const lmuName = `Map${String(mapId).padStart(4, '0')}.lmu`;
      await writeFile(root, lmuName, encoded);
      filesWritten.push(lmuName);
    }
  }
  console.timeEnd('[DELETE] encode-write');

  console.time('[DELETE] disk-delete');
  const dirCache = new Map<string, FileSystemDirectoryHandle>();
  const getDir = async (dirName: string) => {
    let h = dirCache.get(dirName);
    if (!h) { h = await root.getDirectoryHandle(dirName); dirCache.set(dirName, h); }
    return h;
  };
  const deleteResults = await Promise.allSettled(
    diskAssets.map(async (a) => {
      const dirName = a.path.split('/')[0];
      const dirHandle = await getDir(dirName);
      await dirHandle.removeEntry(a.name);
      return a.path;
    })
  );
  const filesDeleted: string[] = [];
  const failedToDelete: string[] = [];
  for (let i = 0; i < deleteResults.length; i++) {
    const r = deleteResults[i];
    if (r.status === 'fulfilled') {
      filesDeleted.push(r.value);
    } else {
      failedToDelete.push(`${diskAssets[i].name}: ${(r.reason as Error).message}`);
    }
  }
  console.timeEnd('[DELETE] disk-delete');

  // filesToDelete 的快照放到后台异步做——用内存 Blob 直接写备份目录，不阻塞
  if (filesToDelete.length > 0 && failedToDelete.length === 0) {
    const taskId = useStore.getState().addTask({
      label: `备份 ${filesToDelete.length} 个已删除素材`,
    });
    const rootForRefresh = root;
    createSnapshot(root, [], undefined, filesToDelete, deletedBlobs).then(
      () => {
        const store = useStore.getState();
        store.updateTask(taskId, { status: 'success', progress: 100 });
        store.refreshSnapshots(rootForRefresh);
        setTimeout(() => store.removeTask(taskId), 3000);
      },
      (e) => {
        const store = useStore.getState();
        store.updateTask(taskId, { status: 'error', message: String(e) });
        setTimeout(() => store.removeTask(taskId), 5000);
      }
    );
  }

  if (dbClone) {
    data.database = dbClone;
    if (data.rawLdb) {
      data.rawLdb = encodeDatabase(dbClone, { engine: data.engine, transcoder });
    }
  }
  if (treeMapClone) {
    data.treeMap = treeMapClone;
    if (data.rawLmt && changedMapInfoIds.size > 0) {
      data.rawLmt = encodeTreeMap(treeMapClone, { engine: data.engine, transcoder });
    }
  }
  for (const [mapId, muClone] of mapClones) {
    data.maps.set(mapId, muClone);
  }

  let msg = `已删除 ${filesDeleted.length}/${assets.length} 个素材`;
  if (dbChanged || changedMapIds.size > 0 || changedMapInfoIds.size > 0) {
    msg += `，清除了 ${dbChanged ? 'DB ' : ''}${changedMapIds.size > 0 ? changedMapIds.size + ' 张地图 ' : ''}${changedMapInfoIds.size > 0 ? 'TreeMap ' : ''}中的引用`;
  }
  if (failedToDelete.length > 0) {
    msg += `（${failedToDelete.length} 个文件删除失败）`;
  }

  console.timeEnd('[DELETE] total');
  return { success: failedToDelete.length === 0, message: msg, filesWritten, filesDeleted, deletedBlobs };
}
