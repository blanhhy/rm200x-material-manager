import fs from 'fs';
import path from 'path';
const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';
const { decodeDatabase, decodeMapUnit, decodeTreeMap, EventCommandCode } = await import('rpgrt');
const latin1 = { decode(b) { return Buffer.from(b).toString('latin1'); }, encode(s) { return new Uint8Array(Buffer.from(s, 'latin1')); } };
const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: latin1 });

console.log('=== Terrain background ===');
for (const t of db.terrains ?? []) {
  console.log(`  Terrain#${t.id}: bg="${t.backgroundName}" bgA="${t.backgroundAName}" bgB="${t.backgroundBName}"`);
}

console.log('\n=== Map parallaxName ===');
let mapIdx = 1;
while (true) {
  const fn = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fp = path.join(GAME_DIR, fn);
  if (!fs.existsSync(fp)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fp)), { engine: '2k', transcoder: latin1 });
  if (mu.parallaxName) console.log(`  Map${mapIdx}: parallax="${mu.parallaxName}"`);
  mapIdx++;
}

console.log('\n=== MapInfo backgroundName ===');
const tm = decodeTreeMap(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.lmt'))), { engine: '2k', transcoder: latin1 });
for (const mi of tm.maps ?? []) {
  if (mi.backgroundName) console.log(`  MapInfo#${mi.id}: bg="${mi.backgroundName}"`);
}

console.log('\n=== EventCommand ChangePBG (11720) strings ===');
function scanCmds(cmds, ctx) {
  for (const cmd of cmds ?? []) {
    if (cmd.code === 11720) console.log(`  ${ctx}: "${cmd.string}"`);
    if (cmd.code === 11510 || cmd.code === 11570 || cmd.code === 11580) console.log(`  ${ctx} code=${cmd.code}: "${cmd.string}"`);
    if (cmd.code === 11330) console.log(`  ${ctx} MoveEvent params=[${cmd.parameters?.slice(0,8)}...]`);
  }
}
for (const ce of db.commonevents ?? []) scanCmds(ce.eventCommands, `CE#${ce.id}`);
mapIdx = 1;
while (true) {
  const fn = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fp = path.join(GAME_DIR, fn);
  if (!fs.existsSync(fp)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fp)), { engine: '2k', transcoder: latin1 });
  for (const ev of mu.events ?? [])
    for (const page of ev.pages ?? [])
      scanCmds(page.eventCommands, `Map${mapIdx}.ev#${ev.id}.p#${page.id}`);
  mapIdx++;
}
for (const troop of db.troops ?? [])
  for (let pi = 0; pi < (troop.pages ?? []).length; pi++)
    scanCmds(troop.pages[pi].eventCommands, `Troop#${troop.id}.p[${pi}]`);

console.log('\n=== System Music fields ===');
const sys = db.system;
for (const f of ['titleMusic','battleMusic','battleEndMusic','innMusic','boatMusic','shipMusic','airshipMusic','gameoverMusic']) {
  const m = sys[f];
  console.log(`  system.${f}: name="${m?.name}" volume=${m?.volume} tempo=${m?.tempo}`);
}
