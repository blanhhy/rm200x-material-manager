import { MoveCommandCode } from 'rpgrt';
import type { Database, MapUnit, MapInfo } from 'rpgrt';
import type { AssetCategory } from '../types/index';
import { refCatForEventCode, SYSTEM_MUSIC_FIELDS, SYSTEM_SOUND_FIELDS, SYSTEM_VEHICLE_FIELDS } from './sharedEngine';

/**
 * DB 字段遍历回调。
 * 返回 true 表示中止遍历（用于引用检测），返回 false/void 表示继续。
 */
export type FieldChecker = (
  val: string | undefined | null,
  category: AssetCategory,
  setter: (v: string) => void,
) => boolean | void;

/** 遍历 Database 中所有引用素材的字符串字段 */
export function traverseDatabase(db: Database, checker: FieldChecker): boolean {
  let abort = false;
  const visit = (val: string | undefined | null, cat: AssetCategory, set: (v: string) => void) => {
    if (abort || val == null) return;
    if (checker(val, cat, set)) abort = true;
  };

  // ── System ──
  const sys = db.system as unknown as Record<string, unknown> | undefined;
  if (sys) {
    // Picture fields — each has its own category (matching referenceTracker.ts)
    visit(sys['titleName'] as string | undefined, 'Title', v => { sys['titleName'] = v; });
    visit(sys['gameoverName'] as string | undefined, 'GameOver', v => { sys['gameoverName'] = v; });
    visit(sys['systemName'] as string | undefined, 'System', v => { sys['systemName'] = v; });
    visit(sys['system2Name'] as string | undefined, 'System2', v => { sys['system2Name'] = v; });
    visit(sys['frameName'] as string | undefined, 'Frame', v => { sys['frameName'] = v; });
    visit(sys['battletestBackground'] as string | undefined, 'Backdrop', v => { sys['battletestBackground'] = v; });
    for (const f of SYSTEM_MUSIC_FIELDS) {
      const m = sys[f] as { name?: string } | undefined;
      if (m?.name) visit(m.name, 'Music', v => { m.name = v; });
    }
    for (const f of SYSTEM_SOUND_FIELDS) {
      const s = sys[f] as { name?: string } | undefined;
      if (s?.name) visit(s.name, 'Sound', v => { s.name = v; });
    }
    for (const f of SYSTEM_VEHICLE_FIELDS)
      visit(sys[f] as string | undefined, 'CharSet', v => { sys[f] = v; });
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
  for (const ce of db.commonevents ?? [])
    for (const cmd of ce.eventCommands ?? []) {
      const cat = refCatForEventCode(cmd.code);
      if (cat && cmd.string !== undefined) visit(cmd.string, cat, v => { cmd.string = v; });
    }
  for (const troop of db.troops ?? [])
    for (const page of troop.pages ?? [])
      for (const cmd of page.eventCommands ?? []) {
        const cat = refCatForEventCode(cmd.code);
        if (cat && cmd.string !== undefined) visit(cmd.string, cat, v => { cmd.string = v; });
      }

  return abort;
}

/** 遍历 MapUnit 中所有引用素材的字符串字段 */
export function traverseMapUnit(mu: MapUnit, checker: FieldChecker): boolean {
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
        const cat = refCatForEventCode(cmd.code);
        if (cat && cmd.string !== undefined) visit(cmd.string, cat, v => { cmd.string = v; });
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
