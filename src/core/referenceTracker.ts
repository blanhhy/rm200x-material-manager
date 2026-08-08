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
import { makeTranscoder } from './lcfLoader';

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
  [EventCommandCode.ChangeFaceGraphic]: 'ChangeFaceGraphic',
  [EventCommandCode.ChangeSpriteAssociation]: 'ChangeSpriteAssociation',
  [EventCommandCode.ChangeActorFace]: 'ChangeActorFace',
  [EventCommandCode.ChangeVehicleGraphic]: 'ChangeVehicleGraphic',
  [EventCommandCode.ChangeSystemBGM]: 'ChangeSystemBGM',
  [EventCommandCode.ChangeSystemSFX]: 'ChangeSystemSFX',
  [EventCommandCode.ChangeSystemGraphics]: 'ChangeSystemGraphics',
  [EventCommandCode.ChangeScreenTransitions]: 'ChangeScreenTransitions',
  [EventCommandCode.ShowPicture]: 'ShowPicture',
  [EventCommandCode.ShowBattleAnimation]: 'ShowBattleAnimation',
  [EventCommandCode.MoveEvent]: 'MoveEvent',
  [EventCommandCode.PlayBGM]: 'PlayBGM',
  [EventCommandCode.PlaySound]: 'PlaySound',
  [EventCommandCode.PlayMovie]: 'PlayMovie',
  [EventCommandCode.ChangeMapTileset]: 'ChangeMapTileset',
  [EventCommandCode.ChangePBG]: 'ChangePBG',
  [EventCommandCode.ChangeBattleBG]: 'ChangeBattleBG',
  [EventCommandCode.ShowBattleAnimationB]: 'ShowBattleAnimationB',
};

const MOVE_CMD_NAMES: Record<number, string> = {
  0: 'End',
  [MoveCommandCode.changeGraphic]: 'ChangeGraphic',
  [MoveCommandCode.playSoundEffect]: 'PlaySoundEffect',
  [MoveCommandCode.switchOn]: 'SwitchON',
  [MoveCommandCode.switchOff]: 'SwitchOFF',
};

type EventLoc = Extract<ReferenceLocation, { kind: 'Event' }>;
type MoveRouteLoc = Extract<ReferenceLocation, { kind: 'MoveRoute' }>;
type CommonEventLoc = Extract<ReferenceLocation, { kind: 'CommonEvent' }>;
type TroopPageLoc = Extract<ReferenceLocation, { kind: 'TroopPage' }>;

type CmdTraceCtx =
  | { kind: 'event'; loc: EventLoc; db: Database; decodeStr: (bytes: number[]) => string }
  | { kind: 'common'; loc: CommonEventLoc; db: Database; decodeStr: (bytes: number[]) => string }
  | { kind: 'troop'; loc: TroopPageLoc; db: Database; decodeStr: (bytes: number[]) => string };

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
  const baseLoc = resolveCmdLoc(ctx);
  const arr = cmds ?? [];
  for (let i = 0; i < arr.length; i++) {
    const cmd = arr[i];
    const p = cmd.parameters ?? [];
    const locWithIdx = locWithCommandIdx(baseLoc, i);
    const cmdName = EVENT_CMD_NAMES[cmd.code];
    const loc = cmdName ? locWithCmdName(locWithIdx, cmdName) : locWithIdx;

    switch (cmd.code) {
      case EventCommandCode.ChangeFaceGraphic:
        if (validName(cmd.string)) pushRef(refs, 'FaceSet', cmd.string, locWithField(loc, 'ChangeFaceGraphic'));
        break;
      case EventCommandCode.ChangeSpriteAssociation:
        if (validName(cmd.string)) pushRef(refs, 'CharSet', cmd.string, locWithField(loc, 'ChangeSpriteAssociation'));
        break;
      case EventCommandCode.ChangeActorFace:
        if (validName(cmd.string)) pushRef(refs, 'FaceSet', cmd.string, locWithField(loc, 'ChangeActorFace'));
        break;
      case EventCommandCode.ChangeVehicleGraphic:
        if (validName(cmd.string)) pushRef(refs, 'CharSet', cmd.string, locWithField(loc, 'ChangeVehicleGraphic'));
        break;
      case EventCommandCode.ChangeSystemBGM:
        if (validName(cmd.string)) pushRef(refs, 'Music', cmd.string, locWithField(loc, 'ChangeSystemBGM'));
        break;
      case EventCommandCode.ChangeSystemSFX:
        if (validName(cmd.string)) pushRef(refs, 'Sound', cmd.string, locWithField(loc, 'ChangeSystemSFX'));
        break;
      case EventCommandCode.ChangeSystemGraphics:
        if (validName(cmd.string)) pushRef(refs, 'System', cmd.string, locWithField(loc, 'ChangeSystemGraphics'));
        break;
      case EventCommandCode.ChangeScreenTransitions:
        if (validName(cmd.string)) pushRef(refs, 'System', cmd.string, locWithField(loc, 'ChangeScreenTransitions'));
        break;
      case EventCommandCode.ShowPicture:
        if (validName(cmd.string)) pushRef(refs, 'Picture', cmd.string, locWithField(loc, 'ShowPicture'));
        break;
      case EventCommandCode.ShowBattleAnimation: {
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
      case EventCommandCode.PlayBGM:
        if (validName(cmd.string)) pushRef(refs, 'Music', cmd.string, locWithField(loc, 'PlayBGM'));
        break;
      case EventCommandCode.PlaySound:
        if (validName(cmd.string)) pushRef(refs, 'Sound', cmd.string, locWithField(loc, 'PlaySound'));
        break;
      case EventCommandCode.PlayMovie:
        if (validName(cmd.string)) pushRef(refs, 'Movie', cmd.string, locWithField(loc, 'PlayMovie'));
        break;
      case EventCommandCode.ChangeMapTileset: {
        const csId = p[0];
        if (validIdx(csId, db.chipsets ?? [])) {
          const cs = db.chipsets[csId];
          if (validName(cs.chipsetName)) {
            pushRef(refs, 'ChipSet', cs.chipsetName, locWithField(loc, 'ChangeMapTileset'));
          }
        }
        break;
      }
      case EventCommandCode.ChangePBG:
        if (validName(cmd.string)) pushRef(refs, 'Panorama', cmd.string, locWithField(loc, 'ChangePBG'));
        break;
      case EventCommandCode.ChangeBattleBG:
        if (validName(cmd.string)) pushRef(refs, 'Backdrop', cmd.string, locWithField(loc, 'ChangeBattleBG'));
        break;
      case EventCommandCode.ShowBattleAnimationB: {
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
      case EventCommandCode.MoveEvent: {
        const inlineCmds = parseMoveCommandsFromParams(p, ctx.decodeStr);
        for (let ci = 0; ci < inlineCmds.length; ci++) {
          const mc = inlineCmds[ci];
          const mcName = MOVE_CMD_NAMES[mc.commandId] ?? `MoveCmd[${mc.commandId}]`;
          if (mc.commandId === MoveCommandCode.changeGraphic && validName(mc.parameterString)) {
            pushRef(refs, 'CharSet', mc.parameterString!, locWithField(locWithSubIdx(loc, ci), mcName));
          } else if (mc.commandId === MoveCommandCode.playSoundEffect && validName(mc.parameterString)) {
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
    if (mc.commandId === MoveCommandCode.changeGraphic && validName(mc.parameterString)) {
      pushRef(refs, 'CharSet', mc.parameterString, { ...baseLoc, routeCmdIdx: i, field: 'ChangeGraphic' });
    } else if (mc.commandId === MoveCommandCode.playSoundEffect && validName(mc.parameterString)) {
      pushRef(refs, 'Sound', mc.parameterString, { ...baseLoc, routeCmdIdx: i, field: 'PlaySoundEffect' });
    }
  }
}

interface InlineMoveCommand {
  commandId: number;
  parameterString: string | null;
}

function parseMoveCommandsFromParams(
  params: number[],
  decodeStr: (bytes: number[]) => string,
  startOffset = 4,
): InlineMoveCommand[] {
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
        mc.parameterString = decodeStr(bytes);
        i++;
        break;
      }
      case MoveCommandCode.playSoundEffect: {
        const strLen = params[i++];
        const bytes: number[] = [];
        for (let j = 0; j < strLen; j++) bytes.push(params[i++]);
        mc.parameterString = decodeStr(bytes);
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

  const transcoder = makeTranscoder(data.encoding as 'shift_jis' | 'gbk' | 'euc_jp' | 'utf8' | 'latin1');
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
