import iconv from 'iconv-lite';
import { decodeDatabase, decodeMapUnit, decodeTreeMap, EventCommandCode } from 'rpgrt';
import type { Database, MapUnit, MapInfo, TreeMap, EngineVersion } from 'rpgrt';
import type { ProjectGameData, EncodingName } from '../types/index';
import { makeTranscoder } from './internal/lcfIo';
import { isCommonHanzi } from './internal/hanziData';

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


interface CharStats {
  // languageTotal = totalHanzi + fullKana + halfKana + other —— 语言判别的唯一分母。
  // ASCII、标点、符号等"语言无关"字符不进入该分母，避免任何语言的通用符号稀释占比。
  neutral: number;
  other: number;        // 真正的乱码字节（无法归入任何语言的有效字符）
  languageTotal: number;
  hasKana: boolean; hasKanji: boolean; hasPunct: boolean;
  commonHanzi: number; totalHanzi: number; maxHanziRun: number;
  fullKana: number; halfKana: number;
}

/**
 * 统计文本中"有语言判别能力"的字符构成。
 *
 * 关键设计：语言判别只关心三类字符 —— 汉字、假名、乱码字节。
 * 其余（ASCII 字母数字标点、全角标点、罗马数字、箭头、几何/杂项符号等）是
 * 所有东亚语言共享的"中性"字符，对区分中/日无任何信息量，必须排除在分母之外，
 * 否则任何语言里常见的全角符号都会把汉字/假名占比稀释到阈值以下。
 */
function scoreCharStats(text: string): CharStats {
  let neutral = 0, other = 0;
  let hasKana = false, hasKanji = false, hasPunct = false;
  let commonHanzi = 0, totalHanzi = 0;
  let maxHanziRun = 0, curRun = 0;
  let fullKana = 0, halfKana = 0;

  for (const ch of text) {
    const cp = ch.codePointAt(0)!;

    // ASCII（字母/数字/标点/空白）：语言无关
    if (cp < 0x80) { neutral++; curRun = 0; continue; }

    // 全角假名
    if (cp >= 0x3040 && cp <= 0x30FF) { hasKana = true; fullKana++; curRun = 0; continue; }

    // 汉字
    if (cp >= 0x4E00 && cp <= 0x9FFF) {
      hasKanji = true; totalHanzi++;
      if (isCommonHanzi(ch)) commonHanzi++;
      curRun++;
      if (curRun > maxHanziRun) maxHanziRun = curRun;
      continue;
    }

    // 全角区：半角假名(FF65-FF9F)计入语言，其余全角标点/全角ASCII为中性
    if (cp >= 0xFF00 && cp <= 0xFFEF) {
      if (cp >= 0xFF65 && cp <= 0xFF9F) { halfKana++; hasKana = true; }
      else neutral++;
      curRun = 0; continue;
    }

    // 全角标点 / 通用标点：语言无关（所有东亚语言共用），但标记 hasPunct
    if (cp >= 0x3000 && cp <= 0x303F) { hasPunct = true; neutral++; curRun = 0; continue; }
    if (cp >= 0x2000 && cp <= 0x206F) { hasPunct = true; neutral++; curRun = 0; continue; }

    // 常用符号区（罗马数字/箭头/数学/制表/几何/方块/杂项等）：语言无关
    if ((cp >= 0x2150 && cp <= 0x22FF) ||
        (cp >= 0x2500 && cp <= 0x25FF) ||
        (cp >= 0x2600 && cp <= 0x26FF) ||
        (cp >= 0x2B00 && cp <= 0x2BFF)) { neutral++; curRun = 0; continue; }

    // 其余高位字节：真正的乱码，计入语言分母并触发惩罚
    other++; curRun = 0;
  }

  const languageTotal = totalHanzi + fullKana + halfKana + other;
  return { neutral, other, languageTotal, hasKana, hasKanji, hasPunct, commonHanzi, totalHanzi, maxHanziRun, fullKana, halfKana };
}

const CANDIDATE_ENCODINGS: EncodingName[] = ['shift_jis', 'gbk', 'eucjp', 'utf8'];

/**
 * 从 DB 里提取纯显示文本字符串（角色名、道具名、技能名…），用于编码文本质量评分。
 * 注意：不包含素材文件名（characterName/faceName 等），文件名对编码推断无意义。
 */
function collectDisplayTexts(db: Database): string[] {
  const texts: string[] = [];
  const push = (s: string | undefined | null) => {
    if (typeof s === 'string' && s.trim()) texts.push(s.trim());
  };

  for (const a of db.actors ?? []) {
    push((a as any).name);
    push((a as any).title);
  }
  for (const c of (db as any).classes ?? []) push(c.name);
  for (const sk of db.skills ?? []) push((sk as any).name);
  for (const it of db.items ?? []) push((it as any).name);
  for (const en of db.enemies ?? []) push((en as any).name);
  for (const st of db.states ?? []) push((st as any).name);
  for (const tr of db.terrains ?? []) push((tr as any).name);
  for (const at of db.attributes ?? []) push((at as any).name);
  for (const an of db.animations ?? []) push((an as any).name);
  for (const br of (db as any).battleranimations ?? []) push(br.name);
  // 敌群名(troops[].name)与公共事件名(commonevents[].name)是编辑器内部标签，
  // 对玩家不可见，翻译器按 S_UNTRANSLATED 处理不翻译（RPGRewriter 的 Troops.cs / CommonEvents.cs）。
  // 中文翻译游戏往往只翻译玩家可见正文、保留日文原名，这些标签常是未翻译的 Shift_JIS 残留，
  // 若按 GBK 解会以乱码形式污染编码检测文本池，故排除。
  // 但 troop / commonEvent 内部的"命令文本"（战斗对话、公共事件里的 Message/提示等）仍是
  // 玩家可见的显示文本，需要纳入：公共事件常承载演出/事件手搓玩法/战斗台词，敌群页也可能有战斗旁白。
  for (const ce of db.commonevents ?? []) {
    collectCmdTexts((ce as any).eventCommands, texts);
  }
  for (const tp of db.troops ?? []) {
    for (const page of (tp as any).pages ?? []) {
      collectCmdTexts(page.eventCommands, texts);
    }
  }
  return texts;
}

/**
 * 事件命令中"游戏内显示文本"的命令码集合。
 * 注意 2xxxx 段不是"2k3 变体"——RM2k/2k3 共用同一套命令码，
 * 2xxxx 是续行/子项标记（ShowMessage2 = 对话第 2 行起，ShowChoiceOption = 单个选项文本）。
 * 不含注释（Comment/Comment2）：那是开发者备注，不是显示文本，且常含 "-----" 分隔线污染评分。
 */
const TEXT_CODES = new Set<number>([
  EventCommandCode.ShowMessage,      // 10110  显示文章（首行）
  EventCommandCode.ShowMessage2,     // 20110  显示文章（续行）
  EventCommandCode.ShowChoice,       // 10140  显示选项
  EventCommandCode.ShowChoiceOption, // 20140  单个选项文本
  EventCommandCode.InputNumber,      // 10150  数值输入
  EventCommandCode.ChangeHeroName,   // 10610  更改英雄名称
  EventCommandCode.EnterHeroName,    // 10740  输入英雄名称
]);

/** 从扁平事件命令列表提取显示文本（eventCommands 是扁平列表，嵌套用 indent 表达，无需递归）。 */
function collectCmdTexts(cmds: Array<{ code: number; string?: string }> | undefined, texts: string[]): void {
  for (const cmd of cmds ?? []) {
    if (cmd?.string && TEXT_CODES.has(cmd.code)) texts.push(cmd.string);
  }
}

/**
 * 从 LMU 文件结构化解码并提取事件命令中的显示文本（对话、选项等）。
 * 替代 extractTextsFromRaw 的二进制正则扫描，避免把 LMU 二进制结构误读为文本。
 */
function extractMapTexts(bufs: Uint8Array[], enc: EncodingName, engine: EngineVersion): string[] {
  const t = makeTranscoder(enc);
  const texts: string[] = [];
  for (const buf of bufs) {
    try {
      const map = decodeMapUnit(buf, { engine, transcoder: t });
      for (const ev of map.events || []) {
        // 不取 ev.name —— 那是编辑器标签(EV0001)，不是显示文本
        for (const page of ev.pages || []) {
          collectCmdTexts(page.eventCommands, texts);
        }
      }
    } catch {}
  }
  return texts;
}

/**
 * 剥离 RM2k/2k3 消息控制码，只留真正显示给玩家的字。
 * 控制码本身是 ASCII，留着会稀释汉字/假名占比、干扰编码评分。
 *
 * 依据 EasyRPG Player 的 window_message.cpp / game_message.cpp：
 *   带参数：\c[n] 颜色  \s[n] 速度  \n[n] 角色名  \v[n] 变量  \t[n] 字符串
 *   单字符：\\ \$ \_ \! \. \| \^ \> \<
 *   ExFont：$A-$Z / $a-$z → 图标（非文字，不参与语言判别）
 */
function stripMessageCodes(s: string): string {
  return s
    .replace(/\\\\/g, '')                    // \\ 反斜杠字面量
    .replace(/\\[cCsSnNvVtT]\[[^\]]*\]/g, '') // \c[n] \s[n] \n[n] \v[n] \t[n]
    .replace(/\\[cC](?!\[)/g, '')            // 不带 [] 的 \c 退化为颜色 0
    .replace(/\$[A-Za-z]/g, '')              // ExFont 图标
    .replace(/\\[$!.|^><]/g, '')             // \$ \! \. \| \^ \> \<
    .replace(/\\_/g, ' ');                   // \_ 是半角空格，保留为空格
}

/**
 * 纯 ASCII 文本对编码判别零信息量（无高位字节，各候选编码解出的结果完全相同），
 * 但会严重稀释汉字/假名占比 —— 典型元凶是注释里的 "------" 分隔线。
 * 必须在评分前剔除，否则中文游戏的 hanziRatio 会被压到阈值以下。
 */
function hasNonAscii(s: string): boolean {
  for (const ch of s) if (ch.codePointAt(0)! > 0x7F) return true;
  return false;
}

function scoreEncoding(
  ldbBuf: Uint8Array,
  engine: EngineVersion,
  enc: EncodingName,
  extraBufs: Uint8Array[] = [],
): { total: number; reasons: string[] } {
  let db: Database;
  try {
    db = decodeDatabase(ldbBuf, { engine, transcoder: makeTranscoder(enc) });
  } catch { return { total: -1, reasons: ['decode failed'] }; }

  let displayTexts = collectDisplayTexts(db);
  if (extraBufs.length > 0) {
    const extraTexts = extractMapTexts(extraBufs, enc, engine);
    if (extraTexts.length > 0) {
      displayTexts = [...displayTexts, ...extraTexts];
    }
  }
  // 剥控制码后丢掉纯 ASCII 串：它们对编码判别零信息量，只会稀释汉字/假名占比
  displayTexts = displayTexts
    .map(stripMessageCodes)
    .filter(hasNonAscii);
  const reasons: string[] = [];
  let total = 0;

  if (displayTexts.length > 0) {
    const allText = displayTexts.join(' ');
    const s = scoreCharStats(allText);

    if (s.languageTotal === 0) {
      reasons.push('no language chars');
    } else {
      const n = s.languageTotal;
      const hanziRatio = s.totalHanzi / n;
      const kanaRatio = (s.fullKana + s.halfKana) / n;
      const otherRatio = s.other / n;
      const commonRatio = s.totalHanzi > 0 ? s.commonHanzi / s.totalHanzi : 0;

      total -= otherRatio * 100;
      if (otherRatio > 0.1) reasons.push(`-badOther:${otherRatio.toFixed(2)}`);

      // === 中文模式 ===
      // 必须：汉字多 + 常用汉字比例高
      if (hanziRatio > 0.35 && commonRatio >= 0.3 && kanaRatio < 0.2) {
        total += 50;
        reasons.push(`+zhPattern hanzi:${hanziRatio.toFixed(2)} common:${commonRatio.toFixed(2)}`);
        if (s.maxHanziRun >= 5) {
          total += 15;
          reasons.push(`+zhLongRun:${s.maxHanziRun}`);
        }
        if (s.hasPunct) { total += 10; reasons.push('+zhPunct'); }
      }
      // 假中文：汉字多但常用汉字极少 —— 典型 GBK 错解 Shift_JIS
      else if (hanziRatio > 0.35 && commonRatio < 0.2 && kanaRatio < 0.05) {
        total -= 20;
        reasons.push(`-fakeZh hanziManyButRareCommon:${commonRatio.toFixed(2)}`);
      }

      // === 日文模式 ===
      // 必须：假名占显著比例，且假名 > 汉字*0.8
      if (kanaRatio > 0.2 && kanaRatio > hanziRatio * 0.8) {
        total += 50;
        reasons.push(`+jaPattern kana:${kanaRatio.toFixed(2)} hanzi:${hanziRatio.toFixed(2)}`);
        if (hanziRatio > 0.05 && hanziRatio < 0.5) {
          total += 15;
          reasons.push('+jaMixedKanji');
        }
        if (s.hasPunct) { total += 10; reasons.push('+jaPunct'); }
        // 半角假名(U+FF65-FF9F)在真实日文里也可能出现（作为点缀），但占比极低——
        // 日文书写以全角假名(U+3040-30FF)为主体。实测真实日文 halfRatio≈0~0.07。
        // 而 Shift_JIS 错解中文（每个汉字被拆成两个半角假名字节）时，全角假名几乎为 0、
        // halfRatio≈1.0。因此区分二者的关键不是"有没有半角假名"，而是半角在假名总数中的占比。
        // 半角占比越高越不可能是真日文，惩罚随占比加大，把中文错解压成负分，
        // 从而抵消"shift_jis 解中文仍能拿 +50 日文模式"造成的中文方向余量不足。
        const halfRatio = s.fullKana + s.halfKana > 0 ? s.halfKana / (s.fullKana + s.halfKana) : 0;
        if (halfRatio > 0.6) {
          let penalty = 25;
          if (halfRatio > 0.9) penalty += 45;   // 几乎全半角：必为错解，直接压负
          else if (halfRatio > 0.8) penalty += 20;
          total -= penalty;
          reasons.push(`-fakeJaHalfKana halfKanaRatio:${halfRatio.toFixed(2)} penalty:${penalty}`);
        } else if (s.fullKana > 0 && s.halfKana > 0 && halfRatio < 0.3) {
          total += 5;
          reasons.push('+jaFullKanaDominant');
        }
      }

      // === 乱码特征 ===
      // 汉字和假名"都不少"——两种语言特征重叠
      if (hanziRatio > 0.2 && kanaRatio > 0.2) {
        total -= 30;
        reasons.push(`-mixedGarbage hanzi+kana both high`);
      }
    }
  } else {
    reasons.push('no displayTexts');
  }

  const sample = displayTexts.slice(0, 3).map(t => `"${t.slice(0, 20)}"`).join(' ');
  console.log(`[ENCODE SCORE] ${enc}: ${total.toFixed(1)}  ${reasons.join(' | ')}  sample=[${sample}]`);
  return { total, reasons };
}

export function detectEncoding(
  iniBuf: Uint8Array | null,
  ldbBuf: Uint8Array | null,
  engine: EngineVersion = '2k',
  extraBufs: Uint8Array[] = [],
): EncodingName {
  if (!ldbBuf && !iniBuf) return 'latin1';

  if (!ldbBuf && iniBuf) {
    let highBytes = 0;
    for (let i = 0; i < iniBuf.length; i++) if (iniBuf[i] > 0x7F) highBytes++;
    if (highBytes === 0) return 'latin1';
    let best: EncodingName = 'latin1';
    let bestBad = Infinity;
    for (const enc of CANDIDATE_ENCODINGS) {
      const text = iconv.decode(iniBuf, enc);
      const s = scoreCharStats(text);
      // 无 LDB 时仅凭 ini 探测：优先选"乱码字节最少"的编码
      const bad = s.other;
      if (bad < bestBad) { bestBad = bad; best = enc; }
    }
    return best;
  }

  if (!ldbBuf) return 'latin1';

  let bestEnc: EncodingName = 'latin1';
  let bestScore = -Infinity;
  for (const enc of CANDIDATE_ENCODINGS) {
    const r = scoreEncoding(ldbBuf, engine, enc, extraBufs);
    if (r.total > bestScore) { bestScore = r.total; bestEnc = enc; }
  }

  console.log(`[ENCODE BEST] ${bestEnc} score=${bestScore.toFixed(1)}`);
  return bestEnc;
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

  // 读所有 .lmu 文件用于编码推断（DB 名字段太少，地图对话才是大头）
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

  const encoding = detectEncoding(iniBuf, ldbBuf, engine, lmuBufs);
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