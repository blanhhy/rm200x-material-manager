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
import { EventCommandCode as EventCmdCode, MoveCommandCode as MoveCmdCode } from 'rpgrt';
import type { AssetCategory, AssetReference, ReferenceLocation, ProjectGameData } from '../types/index';
import { makeTranscoder } from './internal/lcfIo';
import { SYSTEM_STRING_FIELDS, SYSTEM_AUDIO_FIELDS } from './internal/assetFieldMap';

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

// anim.animationName 指向 Battle/ 或 Battle2/，由 anim.large 决定
function traceAnimFrames(db: Database, refs: AssetReference[], idx: number, loc: ReferenceLocation) {
  if (validIdx(idx, db.animations ?? [])) {
    const anim = db.animations[idx];
    if (validName(anim.animationName)) {
      const cat = anim.large ? 'Battle2' : 'Battle';
      pushRef(refs, cat, anim.animationName.trim(), loc);
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
        const cat = anim.large ? 'Battle2' : 'Battle';
        pushRef(refs, cat, anim.animationName.trim(), {
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
          const cat = anim.large ? 'Battle2' : 'Battle';
          pushRef(refs, cat, anim.animationName.trim(), {
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
    case 'Event': return { kind: 'Event', mapId: loc.mapId, eventId: loc.eventId, pageId: loc.pageId, commandIdx: loc.commandIdx, cmdName: loc.cmdName, subIdx: loc.subIdx, field };
    case 'MoveRoute': return { kind: 'MoveRoute', mapId: loc.mapId, eventId: loc.eventId, pageId: loc.pageId, commandIdx: loc.commandIdx, routeCmdIdx: loc.routeCmdIdx, field };
    case 'CommonEvent': return { kind: 'CommonEvent', ceId: loc.ceId, commandIdx: loc.commandIdx, cmdName: loc.cmdName, subIdx: loc.subIdx, field };
    case 'ChipsetRef': return { kind: 'ChipsetRef', chipsetId: loc.chipsetId, field };
    case 'TroopPage': return { kind: 'TroopPage', troopId: loc.troopId, pageIdx: loc.pageIdx, field };
    case 'Unknown': return loc;
  }
}

function locWithCommandIdx(loc: ReferenceLocation, idx: number): ReferenceLocation {
  if (loc.kind === 'Event') return { ...loc, commandIdx: idx };
  if (loc.kind === 'CommonEvent') return { ...loc, commandIdx: idx };
  if (loc.kind === 'TroopPage') return { ...loc };
  return loc;
}

function locWithCmdName(loc: ReferenceLocation, name: string): ReferenceLocation {
  if (loc.kind === 'Event') return { ...loc, cmdName: name };
  if (loc.kind === 'CommonEvent') return { ...loc, cmdName: name };
  return loc;
}

function locWithSubIdx(loc: ReferenceLocation, subIdx: number): ReferenceLocation {
  if (loc.kind === 'Event') return { ...loc, subIdx };
  if (loc.kind === 'CommonEvent') return { ...loc, subIdx };
  return loc;
}

const EVENT_CMD_NAMES: Partial<Record<number, string>> = {
  [EventCmdCode.ChangeFaceGraphic]:         'ChangeFaceGraphic',
  [EventCmdCode.ChangeSpriteAssociation]:   'ChangeSpriteAssociation',
  [EventCmdCode.ChangeActorFace]:           'ChangeActorFace',
  [EventCmdCode.ChangeVehicleGraphic]:      'ChangeVehicleGraphic',
  [EventCmdCode.ChangeSystemBGM]:           'ChangeSystemBGM',
  [EventCmdCode.ChangeSystemSFX]:           'ChangeSystemSFX',
  [EventCmdCode.ChangeSystemGraphics]:      'ChangeSystemGraphics',
  [EventCmdCode.ChangeScreenTransitions]:   'ChangeScreenTransitions',
  [EventCmdCode.ShowPicture]:               'ShowPicture',
  [EventCmdCode.ShowBattleAnimation]:       'ShowBattleAnimation',
  [EventCmdCode.MoveEvent]:                 'MoveEvent',
  [EventCmdCode.PlayBGM]:                   'PlayBGM',
  [EventCmdCode.PlaySound]:                 'PlaySound',
  [EventCmdCode.PlayMovie]:                 'PlayMovie',
  [EventCmdCode.ChangeMapTileset]:          'ChangeMapTileset',
  [EventCmdCode.ChangePBG]:                 'ChangePBG',
  [EventCmdCode.ChangeBattleBG]:            'ChangeBattleBG',
  [EventCmdCode.ShowBattleAnimationB]:      'ShowBattleAnimationB', 
};

const MOVE_CMD_NAMES: Record<number, string> = {
  0: 'End',
  [MoveCmdCode.changeGraphic]:           'ChangeGraphic',
  [MoveCmdCode.playSoundEffect]:         'PlaySoundEffect',
  [MoveCmdCode.switchOn]:                'SwitchON',
  [MoveCmdCode.switchOff]:               'SwitchOFF',
};

type EventLoc = Extract<ReferenceLocation, { kind: 'Event' }>;
type MoveRouteLoc = Extract<ReferenceLocation, { kind: 'MoveRoute' }>;
type CommonEventLoc = Extract<ReferenceLocation, { kind: 'CommonEvent' }>;
type TroopPageLoc = Extract<ReferenceLocation, { kind: 'TroopPage' }>;

type CmdTraceCtx =
  | { kind: 'event'; loc: EventLoc; db: Database; decodeStr: (bytes: number[]) => string }
  | { kind: 'common'; loc: CommonEventLoc; db: Database; decodeStr: (bytes: number[]) => string }
  | { kind: 'troop'; loc: TroopPageLoc; db: Database; decodeStr: (bytes: number[]) => string };


function traceSystem(sys: System, refs: AssetReference[]) {
  const rec = sys as unknown as Record<string, unknown>;

  for (const [field, cat] of SYSTEM_STRING_FIELDS) {
    const val = rec[field] as string | undefined;
    if (validName(val)) pushRef(refs, cat, val!, { kind: 'System', field });
  }

  for (const [field, cat] of SYSTEM_AUDIO_FIELDS) {
    const name = fromSound(rec[field] as Sound | undefined);
    if (name) pushRef(refs, cat, name, { kind: 'System', field });
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
    // backgroundName 固定 Backdrop（只在 backgroundType=0 时被 Player 使用）
    if (validName(t.backgroundName)) {
      pushRef(refs, 'Backdrop', t.backgroundName, { kind: 'Terrain', terrainId: t.id, field: 'backgroundName' });
    }
    // backgroundAName / backgroundBName 是远景图层（type=1 时使用），固定 Panorama
    if (validName(t.backgroundAName)) {
      pushRef(refs, 'Panorama', t.backgroundAName, { kind: 'Terrain', terrainId: t.id, field: 'backgroundAName' });
    }
    if (validName(t.backgroundBName)) {
      pushRef(refs, 'Panorama', t.backgroundBName, { kind: 'Terrain', terrainId: t.id, field: 'backgroundBName' });
    }
    const footstep = fromSound(t.footstep);
    if (footstep) pushRef(refs, 'Sound', footstep, { kind: 'Terrain', terrainId: t.id, field: 'footstep' });
  }
}

// DB animations[].animationName: 按 large 字段决定 Battle / Battle2
function traceAnimations(db: Database, refs: AssetReference[]) {
  for (const anim of db.animations ?? []) {
    if (validName(anim.animationName)) {
      const cat = anim.large ? 'Battle2' : 'Battle';
      pushRef(refs, cat, anim.animationName, { kind: 'Unknown', note: `Animation[${anim.id}].animationName` });
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
  const baseLoc = ctx.loc;
  const arr = cmds ?? [];
  for (let i = 0; i < arr.length; i++) {
    const cmd = arr[i];
    const p = cmd.parameters ?? [];
    const locWithIdx = locWithCommandIdx(baseLoc, i);
    const cmdName = EVENT_CMD_NAMES[cmd.code];
    const loc = cmdName ? locWithCmdName(locWithIdx, cmdName) : locWithIdx;

    switch (cmd.code) {
      case EventCmdCode.ChangeFaceGraphic:
        if (validName(cmd.string)) pushRef(refs, 'FaceSet', cmd.string, locWithField(loc, 'ChangeFaceGraphic'));
        break;
      case EventCmdCode.ChangeSpriteAssociation:
        if (validName(cmd.string)) pushRef(refs, 'CharSet', cmd.string, locWithField(loc, 'ChangeSpriteAssociation'));
        break;
      case EventCmdCode.ChangeActorFace:
        if (validName(cmd.string)) pushRef(refs, 'FaceSet', cmd.string, locWithField(loc, 'ChangeActorFace'));
        break;
      case EventCmdCode.ChangeVehicleGraphic:
        if (validName(cmd.string)) pushRef(refs, 'CharSet', cmd.string, locWithField(loc, 'ChangeVehicleGraphic'));
        break;
      case EventCmdCode.ChangeSystemBGM:
        if (validName(cmd.string)) pushRef(refs, 'Music', cmd.string, locWithField(loc, 'ChangeSystemBGM'));
        break;
      case EventCmdCode.ChangeSystemSFX:
        if (validName(cmd.string)) pushRef(refs, 'Sound', cmd.string, locWithField(loc, 'ChangeSystemSFX'));
        break;
      case EventCmdCode.ChangeSystemGraphics: 
        if (validName(cmd.string)) pushRef(refs, 'System', cmd.string, locWithField(loc, 'ChangeSystemGraphics'));
        break;
      case EventCmdCode.ChangeScreenTransitions:
        if (validName(cmd.string)) pushRef(refs, 'System', cmd.string, locWithField(loc, 'ChangeScreenTransitions'));
        break;
      case EventCmdCode.ShowPicture:
        if (validName(cmd.string)) pushRef(refs, 'Picture', cmd.string, locWithField(loc, 'ShowPicture'));
        break;
      case EventCmdCode.ShowBattleAnimation: {
        const animId = p[0];
        if (validIdx(animId, db.animations ?? [])) {
          const anim = db.animations[animId];
          if (validName(anim.animationName)) {
            const cat = anim.large ? 'Battle2' : 'Battle';
            pushRef(refs, cat, anim.animationName, locWithField(loc, 'ShowBattleAnimation'));
          }
        }
        break;
      }
      case EventCmdCode.PlayBGM:
        if (validName(cmd.string)) pushRef(refs, 'Music', cmd.string, locWithField(loc, 'PlayBGM'));
        break;
      case EventCmdCode.PlaySound:
        if (validName(cmd.string)) pushRef(refs, 'Sound', cmd.string, locWithField(loc, 'PlaySound'));
        break;
      case EventCmdCode.PlayMovie:
        if (validName(cmd.string)) pushRef(refs, 'Movie', cmd.string, locWithField(loc, 'PlayMovie'));
        break;
      case EventCmdCode.ChangeMapTileset: { 
        const csId = p[0];
        if (validIdx(csId, db.chipsets ?? [])) {
          const cs = db.chipsets[csId];
          if (validName(cs.chipsetName)) {
            pushRef(refs, 'ChipSet', cs.chipsetName, locWithField(loc, 'ChangeMapTileset'));
          }
        }
        break;
      }
      case EventCmdCode.ChangePBG:
        if (validName(cmd.string)) pushRef(refs, 'Panorama', cmd.string, locWithField(loc, 'ChangePBG'));
        break;
      case EventCmdCode.ChangeBattleBG:
        if (validName(cmd.string)) pushRef(refs, 'Backdrop', cmd.string, locWithField(loc, 'ChangeBattleBG'));
        break;
      case EventCmdCode.ShowBattleAnimationB: {
        const animId = p[0];
        if (validIdx(animId, db.animations ?? [])) {
          const anim = db.animations[animId];
          if (validName(anim.animationName)) {
            const cat = anim.large ? 'Battle2' : 'Battle';
            pushRef(refs, cat, anim.animationName, locWithField(loc, 'ShowBattleAnimationB'));
          }
        }
        break;
      }
      case EventCmdCode.MoveEvent: {
        const inlineCmds = parseMoveCommandsFromParams(p, ctx.decodeStr);
        for (let ci = 0; ci < inlineCmds.length; ci++) {
          const mc = inlineCmds[ci];
          const mcName = MOVE_CMD_NAMES[mc.commandId] ?? `MoveCmd[${mc.commandId}]`;
          if (mc.commandId === MoveCmdCode.changeGraphic && validName(mc.parameterString)) {
            pushRef(refs, 'CharSet', mc.parameterString!, locWithField(locWithSubIdx(loc, ci), mcName));
          } else if (mc.commandId === MoveCmdCode.playSoundEffect && validName(mc.parameterString)) {
            pushRef(refs, 'Sound', mc.parameterString!, locWithField(locWithSubIdx(loc, ci), mcName));
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
    if (mc.commandId === MoveCmdCode.changeGraphic && validName(mc.parameterString)) {
      pushRef(refs, 'CharSet', mc.parameterString, { ...baseLoc, routeCmdIdx: i, field: 'ChangeGraphic' });
    } else if (mc.commandId === MoveCmdCode.playSoundEffect && validName(mc.parameterString)) {
      pushRef(refs, 'Sound', mc.parameterString, { ...baseLoc, routeCmdIdx: i, field: 'PlaySoundEffect' });
    }
  }
}

interface InlineMoveCommand {
  commandId: number;
  parameterString: string | null;
}

/** MoveEvent 参数中内联 MoveCommand 数据的起始偏移（前面 4 个参数是事件目标描述符） */
const MOVE_EVENT_PARAMS_HEADER = 4;

function parseMoveCommandsFromParams(
  params: number[],
  decodeStr: (bytes: number[]) => string,
  startOffset = MOVE_EVENT_PARAMS_HEADER,
): InlineMoveCommand[] {
  const cmds: InlineMoveCommand[] = [];
  let i = startOffset;
  while (i < params.length) {
    const cmdId = params[i++];
    if (cmdId === 0) break;
    const mc: InlineMoveCommand = { commandId: cmdId, parameterString: null };
    switch (cmdId) {
      case MoveCmdCode.changeGraphic: {
        const strLen = params[i++];
        const bytes: number[] = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = decodeStr(bytes);
        i++;
        break;
      }
      case MoveCmdCode.playSoundEffect: {
        const strLen = params[i++];
        const bytes: number[] = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = decodeStr(bytes);
        i += 3;
        break;
      }
      case MoveCmdCode.switchOn:
      case MoveCmdCode.switchOff:
        i++;
        break;
    }
    cmds.push(mc);
  }
  return cmds;
}

function traceMapUnit(
  mu: MapUnit,
  mapId: number,
  db: Database,
  refs: AssetReference[],
  decodeStr: (bytes: number[]) => string,
) {
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
      traceEventCommands(page.eventCommands ?? [], refs, { kind: 'event', loc: eventLoc, db, decodeStr });
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

function traceCommonEvents(
  db: Database,
  refs: AssetReference[],
  decodeStr: (bytes: number[]) => string,
) {
  for (const ce of db.commonevents ?? []) {
    const loc: CommonEventLoc = { kind: 'CommonEvent', ceId: ce.id, field: '' };
    traceEventCommands(ce.eventCommands ?? [], refs, { kind: 'common', loc, db, decodeStr });
  }
}

function traceTroops(
  db: Database,
  refs: AssetReference[],
  decodeStr: (bytes: number[]) => string,
) {
  for (const troop of db.troops ?? []) {
    for (let pi = 0; pi < (troop.pages ?? []).length; pi++) {
      const page = troop.pages[pi];
      const loc: TroopPageLoc = { kind: 'TroopPage', troopId: troop.id, pageIdx: pi, field: '' };
      traceEventCommands(page.eventCommands ?? [], refs, { kind: 'troop', loc, db, decodeStr });
    }
  }
}

export function traceAllReferences(data: ProjectGameData): AssetReference[] {
  const refs: AssetReference[] = [];
  const db = data.database;
  if (!db) return refs;

  const transcoder = makeTranscoder(data.encoding as 'shift_jis' | 'gbk' | 'eucjp' | 'utf8' | 'latin1');
  const decodeStr = (bytes: number[]) => transcoder.decode(Uint8Array.from(bytes));

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
    traceMapUnit(mu, mapId, db, refs, decodeStr);
  }

  traceCommonEvents(db, refs, decodeStr);
  traceTroops(db, refs, decodeStr);

  return refs;
}
