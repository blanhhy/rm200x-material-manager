import { EventCommandCode as EventCmdCode, MoveCommandCode } from 'rpgrt';
import type { Database, MapUnit, MapInfo, EventCommand, Transcoder } from 'rpgrt';
import type { AssetCategory } from '../../types/index';
import { refCatForEventCode, SYSTEM_STRING_FIELDS, SYSTEM_AUDIO_FIELDS } from './assetFieldMap';

/**
 * DB 字段遍历回调。
 * 返回 true 表示中止遍历（用于引用检测），返回 false/void 表示继续。
 */
export type FieldChecker = (
  val: string | undefined | null,
  category: AssetCategory,
  setter: (v: string) => void,
) => boolean | void;

/** MoveEvent 参数中内联 MoveCommand 数据的起始偏移（前面 4 个参数是事件目标描述符） */
const MOVE_EVENT_PARAMS_HEADER = 4;

/**
 * 遍历并改写 MoveEvent 事件命令 parameters 中内联的移动指令字符串参数
 * 返回 true 表示 checker 请求中止。
 */
function visitMoveEventInline(
  cmd: EventCommand,
  checker: FieldChecker,
  transcoder: Transcoder,
): boolean {
  const params = cmd.parameters;
  if (!params || params.length <= MOVE_EVENT_PARAMS_HEADER) return false;

  // 先解析每个内联命令在 params 中的布局（strLen 下标、字节区间的起始/长度）
  const items: Array<{
    commandId: number;
    strLenIdx: number;
    bytesStart: number;
    byteLen: number;
  }> = [];
  let i = MOVE_EVENT_PARAMS_HEADER;
  while (i < params.length) {
    const commandId = params[i++];
    if (commandId === 0) break;
    switch (commandId) {
      case MoveCommandCode.changeGraphic: {
        const strLen = params[i];
        items.push({ commandId, strLenIdx: i, bytesStart: i + 1, byteLen: strLen });
        i += 1 + strLen + 1;
        break;
      }
      case MoveCommandCode.playSoundEffect: {
        const strLen = params[i];
        items.push({ commandId, strLenIdx: i, bytesStart: i + 1, byteLen: strLen });
        i += 1 + strLen + 3;
        break;
      }
      case MoveCommandCode.switchOn:
      case MoveCommandCode.switchOff:
        i += 1;
        break;
      default:
        // 其余移动命令均为无参数命令（见 EasyRPG DecodeMove），commandId 已消费，继续解析
        break;
    }
  }

  // 从后往前改写，splice 不会影响前面（更小下标）项的索引
  for (const it of items.reverse()) {
    const bytes = params.slice(it.bytesStart, it.bytesStart + it.byteLen);
    const val = transcoder.decode(Uint8Array.from(bytes));
    if (val == null) continue;
    const cat: AssetCategory | null =
      it.commandId === MoveCommandCode.changeGraphic ? 'CharSet'
      : it.commandId === MoveCommandCode.playSoundEffect ? 'Sound'
      : null;
    if (!cat) continue;

    const set = (newStr: string) => {
      const newBytes = [...transcoder.encode(newStr)];
      params.splice(it.bytesStart, it.byteLen, ...newBytes);
      params[it.strLenIdx] = newBytes.length;
    };

    if (checker(val, cat, set)) return true;
  }
  return false;
}

/** 遍历 Database 中所有引用素材的字符串字段 */
export function traverseDatabase(
  db: Database,
  checker: FieldChecker,
  transcoder?: Transcoder,
): boolean {
  let abort = false;
  const visit = (val: string | undefined | null, cat: AssetCategory, set: (v: string) => void) => {
    if (abort || val == null) return;
    if (checker(val, cat, set)) abort = true;
  };

  // ── System ──
  const sys = db.system as unknown as Record<string, unknown> | undefined;
  if (sys) {
    for (const [f, cat] of SYSTEM_STRING_FIELDS)
      visit(sys[f] as string | undefined, cat, v => { sys[f] = v; });
    for (const [f, cat] of SYSTEM_AUDIO_FIELDS) {
      const a = sys[f] as { name?: string } | undefined;
      if (a?.name) visit(a.name, cat, v => { a.name = v; });
    }
  }

  // ── Actors ──
  for (const actor of db.actors ?? []) {
    visit(actor.characterName, 'CharSet', v => { actor.characterName = v; });
    visit(actor.faceName, 'FaceSet', v => { actor.faceName = v; });
  }

  // ── Chipsets ──
  for (const cs of db.chipsets ?? [])
    visit(cs.chipsetName, 'ChipSet', v => { cs.chipsetName = v; });

  // ── Terrains ──
  for (const t of db.terrains ?? []) {
    visit(t.backgroundName, 'Backdrop', v => { t.backgroundName = v; });
    visit(t.backgroundAName, 'Panorama', v => { t.backgroundAName = v; });
    visit(t.backgroundBName, 'Panorama', v => { t.backgroundBName = v; });
    const fs = t.footstep as { name?: string } | undefined;
    if (fs?.name) visit(fs.name, 'Sound', v => { fs.name = v; });
  }

  // ── Battle animations ──
  for (const ba of db.battleranimations ?? []) {
    for (const pose of ba.poses ?? [])
      visit(pose.battlerName, 'BattleCharSet', v => { pose.battlerName = v; });
    for (const wep of ba.weapons ?? [])
      visit(wep.weaponName, 'BattleWeapon', v => { wep.weaponName = v; });
  }

  // ── Enemies ──
  for (const enemy of db.enemies ?? [])
    visit(enemy.battlerName, 'Monster', v => { enemy.battlerName = v; });

  // ── Animations ──
  for (const anim of db.animations ?? []) {
    visit(anim.animationName, anim.large ? 'Battle2' : 'Battle', v => { anim.animationName = v; });
    for (const timing of anim.timings ?? []) {
      const se = timing.se as { name?: string } | undefined;
      if (se?.name) visit(se.name, 'Sound', v => { se.name = v; });
    }
  }

  // ── Common events / Troops ──
  for (const ce of db.commonevents ?? []) {
    if (abort) break;
    for (const cmd of ce.eventCommands ?? []) {
      if (abort) break;
      const cat = refCatForEventCode(cmd.code);
      if (cat && cmd.string !== undefined) visit(cmd.string, cat, v => { cmd.string = v; });
      if (cmd.code === EventCmdCode.MoveEvent && transcoder && visitMoveEventInline(cmd, checker, transcoder)) abort = true;
    }
  }
  for (const troop of db.troops ?? []) {
    if (abort) break;
    for (const page of troop.pages ?? []) {
      if (abort) break;
      for (const cmd of page.eventCommands ?? []) {
        if (abort) break;
        const cat = refCatForEventCode(cmd.code);
        if (cat && cmd.string !== undefined) visit(cmd.string, cat, v => { cmd.string = v; });
        if (cmd.code === EventCmdCode.MoveEvent && transcoder && visitMoveEventInline(cmd, checker, transcoder)) abort = true;
      }
    }
  }

  return abort;
}

/** 遍历 MapUnit 中所有引用素材的字符串字段 */
export function traverseMapUnit(
  mu: MapUnit,
  checker: FieldChecker,
  transcoder?: Transcoder,
): boolean {
  let abort = false;
  const visit = (val: string | undefined | null, cat: AssetCategory, set: (v: string) => void) => {
    if (abort || val == null) return;
    if (checker(val, cat, set)) abort = true;
  };

  visit(mu.parallaxName, 'Panorama', v => { mu.parallaxName = v; });

  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      visit(page.characterName, 'CharSet', v => { page.characterName = v; });

      for (const cmd of page.eventCommands ?? []) {
        if (abort) break;
        const cat = refCatForEventCode(cmd.code);
        if (cat && cmd.string !== undefined) visit(cmd.string, cat, v => { cmd.string = v; });
        if (cmd.code === EventCmdCode.MoveEvent && transcoder && visitMoveEventInline(cmd, checker, transcoder)) abort = true;
      }

      for (const mc of page.moveRoute?.moveCommands ?? []) {
        if (mc.commandId === MoveCommandCode.changeGraphic && mc.parameterString)
          visit(mc.parameterString, 'CharSet', v => { mc.parameterString = v; });
        else if (mc.commandId === MoveCommandCode.playSoundEffect && mc.parameterString)
          visit(mc.parameterString, 'Sound', v => { mc.parameterString = v; });
      }
    }
  }
  return abort;
}

/** 遍历 MapInfo 中引用素材的字段 */
export function traverseMapInfo(mi: MapInfo, checker: FieldChecker): boolean {
  let abort = false;
  const visit = (val: string | undefined | null, cat: AssetCategory, set: (v: string) => void) => {
    if (abort || val == null) return;
    if (checker(val, cat, set)) abort = true;
  };

  if (mi.musicType === 2) {
    const m = mi.music as { name?: string } | undefined;
    if (m?.name) visit(m.name, 'Music', v => { m.name = v; });
  }
  if (mi.backgroundName) visit(mi.backgroundName, 'Picture', v => { mi.backgroundName = v; });

  return abort;
}
