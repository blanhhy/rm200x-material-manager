import type {
  Database,
  EventCommand,
  MoveCommand,
  MapUnit,
  MapInfo,
  System,
  Sound,
  Music,
} from 'rpgrt';
import { EventCommandCode, MoveCommandCode } from 'rpgrt';
import type { AssetCategory, AssetReference, ReferenceLocation, ProjectGameData } from '../types/index';

const UNKNOWN_NAMES = new Set(['', '(OFF)']);

function validName(name: string | undefined | null): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  for (const bad of UNKNOWN_NAMES) {
    if (trimmed.toLowerCase() === bad.toLowerCase()) return false;
  }
  return true;
}

function pushRef(
  refs: AssetReference[],
  category: AssetCategory,
  assetName: string,
  location: ReferenceLocation,
) {
  refs.push({ category, assetName: assetName.trim(), location });
}

function fromSound(s: Sound | undefined | null): string | null {
  if (!s) return null;
  return validName(s.name) ? s.name.trim() : null;
}

function fromMusic(m: Music | undefined | null): string | null {
  if (!m) return null;
  return validName(m.name) ? m.name.trim() : null;
}

function validIdx(idx: number, arr: { length: number }): boolean {
  return idx >= 0 && idx < arr.length;
}

// DB animations[].animationName 是动画帧图片名
// EasyRPG Player: 先找 Battle2/，fallback Battle/
// 我们记录两次引用——但引用只能指向一个 category
// 简化：记录为 'Battle'，删除/重命名时也处理 Battle2
function traceAnimFrames(db: Database, refs: AssetReference[], idx: number, loc: ReferenceLocation) {
  if (validIdx(idx, db.animations ?? [])) {
    const anim = db.animations[idx];
    if (validName(anim.animationName)) {
      const name = anim.animationName.trim();
      // Battle2 优先
      pushRef(refs, 'Battle2', name, loc);
      pushRef(refs, 'Battle', name, loc);
    }
  }
}

function traceBattlerAnimationIdx(
  db: Database,
  refs: AssetReference[],
  baIdx: number,
  label: string,
) {
  if (!validIdx(baIdx, db.battleranimations ?? [])) return;
  const ba = db.battleranimations[baIdx];
  for (const pose of ba.poses ?? []) {
    if (validIdx(pose.battleAnimationId, db.animations ?? [])) {
      const anim = db.animations[pose.battleAnimationId];
      if (validName(anim.animationName)) {
        const name = anim.animationName.trim();
        pushRef(refs, 'Battle2', name, {
          kind: 'Unknown', note: `${label}.pose[${pose.id}].battleAnimationId`,
        });
        pushRef(refs, 'Battle', name, {
          kind: 'Unknown', note: `${label}.pose[${pose.id}].battleAnimationId`,
        });
      }
    }
  }
}

function traceBAItemSkillAnims(
  db: Database,
  refs: AssetReference[],
  items: Array<{
    weaponAnimationId?: number;
    rangedAnimationId?: number;
    battleAnimationId?: number;
  }> | undefined,
  label: string,
) {
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const idxs: Array<[number | undefined, string]> = [
      [it.weaponAnimationId, 'weaponAnimationId'],
      [it.rangedAnimationId, 'rangedAnimationId'],
      [it.battleAnimationId, 'battleAnimationId'],
    ];
    for (const [idx, field] of idxs) {
      if (idx != null && validIdx(idx, db.animations ?? [])) {
        const anim = db.animations[idx];
        if (validName(anim.animationName)) {
          const name = anim.animationName.trim();
          pushRef(refs, 'Battle2', name, {
            kind: 'Unknown', note: `${label}[${i}].${field}`,
          });
          pushRef(refs, 'Battle', name, {
            kind: 'Unknown', note: `${label}[${i}].${field}`,
          });
        }
      }
    }
  }
}

function locWithField(loc: ReferenceLocation, field: string): ReferenceLocation {
  switch (loc.kind) {
    case 'System': return { kind: 'System', field };
    case 'Actor': return { kind: 'Actor', actorId: loc.actorId, field };
    case 'Terrain': return { kind: 'Terrain', terrainId: loc.terrainId, field };
    case 'MapInfo': return { kind: 'MapInfo', mapId: loc.mapId, field };
    case 'MapUnit': return { kind: 'MapUnit', mapId: loc.mapId, field };
    case 'Event': return { kind: 'Event', mapId: loc.mapId, eventId: loc.eventId, pageId: loc.pageId, field };
    case 'MoveRoute': return { kind: 'MoveRoute', mapId: loc.mapId, eventId: loc.eventId, pageId: loc.pageId, commandIdx: loc.commandIdx, field };
    case 'CommonEvent': return { kind: 'CommonEvent', ceId: loc.ceId, field };
    case 'ChipsetRef': return { kind: 'ChipsetRef', chipsetId: loc.chipsetId, field };
    case 'TroopPage': return { kind: 'TroopPage', troopId: loc.troopId, pageIdx: loc.pageIdx, field };
    case 'Unknown': return loc;
  }
}

type EventLoc = Extract<ReferenceLocation, { kind: 'Event' }>;
type MoveRouteLoc = Extract<ReferenceLocation, { kind: 'MoveRoute' }>;
type CommonEventLoc = Extract<ReferenceLocation, { kind: 'CommonEvent' }>;
type TroopPageLoc = Extract<ReferenceLocation, { kind: 'TroopPage' }>;

type CmdTraceCtx =
  | { kind: 'event'; loc: EventLoc; db: Database }
  | { kind: 'common'; loc: CommonEventLoc; db: Database }
  | { kind: 'troop'; loc: TroopPageLoc; db: Database };

function resolveCmdLoc(ctx: CmdTraceCtx): ReferenceLocation {
  return ctx.loc;
}

function traceSystem(sys: System, refs: AssetReference[]) {
  // 载具用 CharSet
  for (const field of ['boatName', 'shipName', 'airshipName'] as const) {
    const val = (sys as unknown as Record<string, string>)[field];
    if (validName(val)) pushRef(refs, 'CharSet', val, { kind: 'System', field });
  }

  // system 各图片字段 → 对应独立目录
  const pictureFields: Array<[string, AssetCategory]> = [
    ['titleName', 'Title'],
    ['gameoverName', 'GameOver'],
    ['systemName', 'System'],
    ['system2Name', 'System2'],
    ['frameName', 'Frame'],
    ['battletestBackground', 'Backdrop'],
  ];
  for (const [field, cat] of pictureFields) {
    const val = (sys as unknown as Record<string, string>)[field];
    if (validName(val)) pushRef(refs, cat, val, { kind: 'System', field });
  }

  const musicFields = [
    'titleMusic', 'battleMusic', 'battleEndMusic', 'innMusic',
    'boatMusic', 'shipMusic', 'airshipMusic', 'gameoverMusic',
  ] as const;
  for (const field of musicFields) {
    const m = (sys as unknown as Record<string, Music>)[field];
    const name = fromMusic(m);
    if (name) pushRef(refs, 'Music', name, { kind: 'System', field });
  }

  const soundFields = [
    'cursorSe', 'decisionSe', 'cancelSe', 'buzzerSe',
    'battleSe', 'escapeSe', 'enemyAttackSe', 'enemyDamagedSe',
    'actorDamagedSe', 'dodgeSe', 'enemyDeathSe', 'itemSe',
  ] as const;
  for (const field of soundFields) {
    const s = (sys as unknown as Record<string, Sound>)[field];
    const name = fromSound(s);
    if (name) pushRef(refs, 'Sound', name, { kind: 'System', field });
  }
}

function traceActors(db: Database, refs: AssetReference[]) {
  for (const actor of db.actors ?? []) {
    if (validName(actor.characterName)) {
      pushRef(refs, 'CharSet', actor.characterName, { kind: 'Actor', actorId: actor.id, field: 'characterName' });
    }
    if (validName(actor.faceName)) {
      pushRef(refs, 'FaceSet', actor.faceName, { kind: 'Actor', actorId: actor.id, field: 'faceName' });
    }
    // actor 的 battlerName → BattleCharSet（战斗角色精灵）
    if (validName((actor as any).battlerName)) {
      pushRef(refs, 'BattleCharSet', (actor as any).battlerName, { kind: 'Actor', actorId: actor.id, field: 'battlerName' });
    }
    // actor.pose 的 battlerName → BattleCharSet（走 battlerAnimation）
    traceAnimFrames(db, refs, actor.unarmedAnimation, { kind: 'Actor', actorId: actor.id, field: 'unarmedAnimation' });
    traceBattlerAnimationIdx(db, refs, actor.battlerAnimation, `Actor[${actor.id}].battlerAnimation`);
  }
}

function traceClasses(db: Database, refs: AssetReference[]) {
  for (const cls of db.classes ?? []) {
    traceBattlerAnimationIdx(db, refs, cls.battlerAnimation, `Class[${cls.id}].battlerAnimation`);
  }
}

function traceSkills(db: Database, refs: AssetReference[]) {
  for (const skill of db.skills ?? []) {
    const se = fromSound(skill.soundEffect);
    if (se) pushRef(refs, 'Sound', se, { kind: 'Unknown', note: `Skill[${skill.id}].soundEffect` });
    traceAnimFrames(db, refs, skill.animationId, { kind: 'Unknown', note: `Skill[${skill.id}].animationId` });
    traceBattlerAnimationIdx(db, refs, skill.battlerAnimation, `Skill[${skill.id}].battlerAnimation`);
    traceBAItemSkillAnims(db, refs, skill.battlerAnimationData, `Skill[${skill.id}].battlerAnimationData`);
  }
}

function traceItems(db: Database, refs: AssetReference[]) {
  for (const item of db.items ?? []) {
    traceAnimFrames(db, refs, item.animationId, { kind: 'Unknown', note: `Item[${item.id}].animationId` });
    traceBattlerAnimationIdx(db, refs, item.weaponAnimation, `Item[${item.id}].weaponAnimation`);
    traceBAItemSkillAnims(db, refs, item.animationData, `Item[${item.id}].animationData`);
  }
}

function traceStates(db: Database, refs: AssetReference[]) {
  for (const st of db.states ?? []) {
    traceAnimFrames(db, refs, st.battlerAnimationId, { kind: 'Unknown', note: `State[${st.id}].battlerAnimationId` });
  }
}

function traceChipsets(db: Database, refs: AssetReference[]) {
  for (const cs of db.chipsets ?? []) {
    if (validName(cs.chipsetName)) {
      pushRef(refs, 'ChipSet', cs.chipsetName, { kind: 'ChipsetRef', chipsetId: cs.id, field: 'chipsetName' });
    }
  }
}

function traceTerrains(db: Database, refs: AssetReference[]) {
  for (const t of db.terrains ?? []) {
    if (validName(t.backgroundName)) {
      pushRef(refs, 'Panorama', t.backgroundName, { kind: 'Terrain', terrainId: t.id, field: 'backgroundName' });
    }
    if (validName(t.backgroundAName)) {
      pushRef(refs, 'Backdrop', t.backgroundAName, { kind: 'Terrain', terrainId: t.id, field: 'backgroundAName' });
    }
    if (validName(t.backgroundBName)) {
      pushRef(refs, 'Backdrop', t.backgroundBName, { kind: 'Terrain', terrainId: t.id, field: 'backgroundBName' });
    }
    const footstep = fromSound(t.footstep);
    if (footstep) pushRef(refs, 'Sound', footstep, { kind: 'Terrain', terrainId: t.id, field: 'footstep' });
  }
}

// DB animations[].animationName 的自引用（animation 表自己列出来的名字）
// 每个 animation 的 animationName 引用两张图：先 Battle2，fallback Battle
function traceAnimations(db: Database, refs: AssetReference[]) {
  for (const anim of db.animations ?? []) {
    if (validName(anim.animationName)) {
      pushRef(refs, 'Battle2', anim.animationName, { kind: 'Unknown', note: `Animation[${anim.id}].animationName` });
      pushRef(refs, 'Battle', anim.animationName, { kind: 'Unknown', note: `Animation[${anim.id}].animationName` });
    }
    for (const timing of anim.timings ?? []) {
      const se = fromSound(timing.se);
      if (se) pushRef(refs, 'Sound', se, { kind: 'Unknown', note: `Animation[${anim.id}].timing[${timing.id}].se` });
    }
  }
}

// BattlerAnimation 表: pose 的 battlerName → BattleCharSet, weapon 的 weaponName → BattleWeapon
function traceBattlerAnimations(db: Database, refs: AssetReference[]) {
  for (const ba of db.battleranimations ?? []) {
    for (const pose of ba.poses ?? []) {
      if (validName(pose.battlerName)) {
        pushRef(refs, 'BattleCharSet', pose.battlerName, { kind: 'Unknown', note: `BattlerAnimation[${ba.id}].pose[${pose.id}].battlerName` });
      }
    }
    for (const wep of ba.weapons ?? []) {
      if (validName(wep.weaponName)) {
        pushRef(refs, 'BattleWeapon', wep.weaponName, { kind: 'Unknown', note: `BattlerAnimation[${ba.id}].weapon[${wep.id}].weaponName` });
      }
    }
  }
}

function traceEnemies(db: Database, refs: AssetReference[]) {
  for (const enemy of db.enemies ?? []) {
    // enemy.battlerName → Monster（不是 BattleCharSet！）
    if (validName(enemy.battlerName)) {
      pushRef(refs, 'Monster', enemy.battlerName, { kind: 'Unknown', note: `Enemy[${enemy.id}].battlerName` });
    }
    traceAnimFrames(db, refs, enemy.maniacUnarmedAnimation, { kind: 'Unknown', note: `Enemy[${enemy.id}].maniacUnarmedAnimation` });
  }
}

function traceEventCommands(
  cmds: EventCommand[],
  refs: AssetReference[],
  ctx: CmdTraceCtx,
) {
  const db = ctx.db;
  const baseLoc = resolveCmdLoc(ctx);
  for (const cmd of cmds ?? []) {
    const p = cmd.parameters ?? [];

    switch (cmd.code) {
      case 10130:
        if (validName(cmd.string)) pushRef(refs, 'FaceSet', cmd.string, locWithField(baseLoc, 'ChangeFaceGraphic'));
        break;
      case 10630:
        if (validName(cmd.string)) pushRef(refs, 'CharSet', cmd.string, locWithField(baseLoc, 'ChangeSpriteAssociation'));
        break;
      case 10640:
        if (validName(cmd.string)) pushRef(refs, 'FaceSet', cmd.string, locWithField(baseLoc, 'ChangeActorFace'));
        break;
      case 10650:
        if (validName(cmd.string)) pushRef(refs, 'CharSet', cmd.string, locWithField(baseLoc, 'ChangeVehicleGraphic'));
        break;
      case 10660:
        if (validName(cmd.string)) pushRef(refs, 'Music', cmd.string, locWithField(baseLoc, 'ChangeSystemBGM'));
        break;
      case 10670:
        if (validName(cmd.string)) pushRef(refs, 'Sound', cmd.string, locWithField(baseLoc, 'ChangeSystemSFX'));
        break;
      case 10680:
        if (validName(cmd.string)) pushRef(refs, 'System', cmd.string, locWithField(baseLoc, 'ChangeSystemGraphics'));
        break;
      case 10690:
        if (validName(cmd.string)) pushRef(refs, 'System', cmd.string, locWithField(baseLoc, 'ChangeScreenTransitions'));
        break;
      case 11110:
        if (validName(cmd.string)) pushRef(refs, 'Picture', cmd.string, locWithField(baseLoc, 'ShowPicture'));
        break;
      case 11210: {
        const animId = p[0];
        if (validIdx(animId, db.animations ?? [])) {
          const anim = db.animations[animId];
          if (validName(anim.animationName)) {
            pushRef(refs, 'Battle2', anim.animationName, locWithField(baseLoc, 'ShowBattleAnimation'));
            pushRef(refs, 'Battle', anim.animationName, locWithField(baseLoc, 'ShowBattleAnimation'));
          }
        }
        break;
      }
      case 11510:
        if (validName(cmd.string)) pushRef(refs, 'Music', cmd.string, locWithField(baseLoc, 'PlayBGM'));
        break;
      case 11550:
        if (validName(cmd.string)) pushRef(refs, 'Sound', cmd.string, locWithField(baseLoc, 'PlaySound'));
        break;
      case 11560:
        if (validName(cmd.string)) pushRef(refs, 'Movie', cmd.string, locWithField(baseLoc, 'PlayMovie'));
        break;
      case 11710: {
        const csId = p[0];
        if (validIdx(csId, db.chipsets ?? [])) {
          const cs = db.chipsets[csId];
          if (validName(cs.chipsetName)) {
            pushRef(refs, 'ChipSet', cs.chipsetName, locWithField(baseLoc, 'ChangeMapTileset'));
          }
        }
        break;
      }
      case 11720:
        if (validName(cmd.string)) pushRef(refs, 'Panorama', cmd.string, locWithField(baseLoc, 'ChangePBG'));
        break;
      case 13210:
        // ChangeBattleBG → Backdrop 目录
        if (validName(cmd.string)) pushRef(refs, 'Backdrop', cmd.string, locWithField(baseLoc, 'ChangeBattleBG'));
        break;
      case 13260: {
        const animId = p[0];
        if (validIdx(animId, db.animations ?? [])) {
          const anim = db.animations[animId];
          if (validName(anim.animationName)) {
            pushRef(refs, 'Battle2', anim.animationName, locWithField(baseLoc, 'ShowBattleAnimationB'));
            pushRef(refs, 'Battle', anim.animationName, locWithField(baseLoc, 'ShowBattleAnimationB'));
          }
        }
        break;
      }
      case EventCommandCode.MoveEvent: {
        const inlineCmds = parseMoveCommandsFromParams(p);
        for (let ci = 0; ci < inlineCmds.length; ci++) {
          const mc = inlineCmds[ci];
          if (mc.commandId === MoveCommandCode.changeGraphic && validName(mc.parameterString)) {
            pushRef(refs, 'CharSet', mc.parameterString!, locWithField(baseLoc, `MoveEvent.changeGraphic[${ci}]`));
          } else if (mc.commandId === MoveCommandCode.playSoundEffect && validName(mc.parameterString)) {
            pushRef(refs, 'Sound', mc.parameterString!, locWithField(baseLoc, `MoveEvent.playSoundEffect[${ci}]`));
          }
        }
        break;
      }
    }
  }
}

function traceMoveRoute(
  cmds: MoveCommand[],
  refs: AssetReference[],
  baseLoc: MoveRouteLoc,
) {
  for (let i = 0; i < (cmds ?? []).length; i++) {
    const mc = cmds[i];
    if (mc.commandId === MoveCommandCode.changeGraphic && validName(mc.parameterString)) {
      pushRef(refs, 'CharSet', mc.parameterString, { ...baseLoc, commandIdx: i, field: 'changeGraphic' });
    } else if (mc.commandId === MoveCommandCode.playSoundEffect && validName(mc.parameterString)) {
      pushRef(refs, 'Sound', mc.parameterString, { ...baseLoc, commandIdx: i, field: 'playSoundEffect' });
    }
  }
}

interface InlineMoveCommand {
  commandId: number;
  parameterString: string | null;
}

function parseMoveCommandsFromParams(params: number[], startOffset = 4): InlineMoveCommand[] {
  const cmds: InlineMoveCommand[] = [];
  let i = startOffset;
  while (i < params.length) {
    const cmdId = params[i++];
    if (cmdId === 0) break;
    const mc: InlineMoveCommand = { commandId: cmdId, parameterString: null };
    switch (cmdId) {
      case MoveCommandCode.changeGraphic: {
        const strLen = params[i++];
        const bytes: number[] = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = String.fromCharCode(...bytes);
        i++;
        break;
      }
      case MoveCommandCode.playSoundEffect: {
        const strLen = params[i++];
        const bytes: number[] = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = String.fromCharCode(...bytes);
        i += 3;
        break;
      }
      case MoveCommandCode.switchOn:
      case MoveCommandCode.switchOff:
        i++;
        break;
    }
    cmds.push(mc);
  }
  return cmds;
}

function traceMapUnit(mu: MapUnit, mapId: number, db: Database, refs: AssetReference[]) {
  if (validName(mu.parallaxName)) {
    pushRef(refs, 'Panorama', mu.parallaxName, { kind: 'MapUnit', mapId, field: 'parallaxName' });
  }
  if (validIdx(mu.chipsetId, db.chipsets ?? [])) {
    const cs = db.chipsets[mu.chipsetId];
    if (validName(cs.chipsetName)) {
      pushRef(refs, 'ChipSet', cs.chipsetName, { kind: 'MapUnit', mapId, field: 'chipsetId' });
    }
  }

  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      if (validName(page.characterName)) {
        pushRef(refs, 'CharSet', page.characterName, {
          kind: 'Event', mapId, eventId: ev.id, pageId: page.id, field: 'characterName',
        });
      }
      const eventLoc: EventLoc = { kind: 'Event', mapId, eventId: ev.id, pageId: page.id, field: '' };
      traceEventCommands(page.eventCommands ?? [], refs, { kind: 'event', loc: eventLoc, db });
      const moveRouteLoc: MoveRouteLoc = { kind: 'MoveRoute', mapId, eventId: ev.id, pageId: page.id, commandIdx: -1, field: '' };
      traceMoveRoute(page.moveRoute?.moveCommands ?? [], refs, moveRouteLoc);
    }
  }
}

function traceMapInfo(mi: MapInfo, mapId: number, refs: AssetReference[]) {
  if (mi.musicType === 2) {
    const name = fromMusic(mi.music);
    if (name) {
      pushRef(refs, 'Music', name, { kind: 'MapInfo', mapId, field: 'music' });
    }
  }
  if (validName(mi.backgroundName)) {
    // MapInfo.backgroundName → Picture（地图的背景图）
    pushRef(refs, 'Picture', mi.backgroundName, { kind: 'MapInfo', mapId, field: 'backgroundName' });
  }
}

function traceCommonEvents(db: Database, refs: AssetReference[]) {
  for (const ce of db.commonevents ?? []) {
    const loc: CommonEventLoc = { kind: 'CommonEvent', ceId: ce.id, field: '' };
    traceEventCommands(ce.eventCommands ?? [], refs, { kind: 'common', loc, db });
  }
}

function traceTroops(db: Database, refs: AssetReference[]) {
  for (const troop of db.troops ?? []) {
    for (let pi = 0; pi < (troop.pages ?? []).length; pi++) {
      const page = troop.pages[pi];
      const loc: TroopPageLoc = { kind: 'TroopPage', troopId: troop.id, pageIdx: pi, field: '' };
      traceEventCommands(page.eventCommands ?? [], refs, { kind: 'troop', loc, db });
    }
  }
}

export function traceAllReferences(data: ProjectGameData): AssetReference[] {
  const refs: AssetReference[] = [];
  const db = data.database;
  if (!db) return refs;

  if (db.system) traceSystem(db.system, refs);
  traceActors(db, refs);
  traceClasses(db, refs);
  traceSkills(db, refs);
  traceItems(db, refs);
  traceStates(db, refs);
  traceChipsets(db, refs);
  traceTerrains(db, refs);
  traceAnimations(db, refs);
  traceBattlerAnimations(db, refs);
  traceEnemies(db, refs);

  if (data.treeMap?.maps) {
    for (const mi of data.treeMap.maps) {
      traceMapInfo(mi, mi.id, refs);
    }
  }

  for (const [mapId, mu] of data.maps) {
    traceMapUnit(mu, mapId, db, refs);
  }

  traceCommonEvents(db, refs);
  traceTroops(db, refs);

  return refs;
}
