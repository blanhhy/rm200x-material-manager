import iconv from 'iconv-lite';
import { decodeDatabase, decodeMapUnit, decodeTreeMap } from 'rpgrt';
import type { Database, MapUnit, MapInfo, TreeMap, EngineVersion, Transcoder } from 'rpgrt';
import type { ProjectGameData } from '../types/index';

export type EncodingName = 'latin1' | 'gbk' | 'shift_jis' | 'euc_jp' | 'utf8';

const ICONV_TO_ENCODING: Record<string, string> = {
  latin1: 'latin1',
  gbk: 'gbk',
  shift_jis: 'shift_jis',
  euc_jp: 'eucjp',
  utf8: 'utf8',
};

export function makeTranscoder(enc: EncodingName): Transcoder {
  const target = ICONV_TO_ENCODING[enc] ?? enc;
  return {
    decode(bytes: Uint8Array): string {
      return iconv.decode(bytes, target);
    },
    encode(str: string): Uint8Array {
      return new Uint8Array(iconv.encode(str, target));
    },
  };
}

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

export function unescapeWindy(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

// 500个最常见汉字，由 scripts/scan-game-hanzi.ts 扫描51个RM游戏实际文本统计得出
// 基于《现代汉语常用字表》3500字过滤，按游戏内出现频率排序
const COMMON_HANZI = new Set([
  '的','了','是','法','魔','我','不','人','啊','体','黑','这','一','有','个','全','暗','那','单','成',
  '对','敌','性','么','在','属','就','你','事','来','特','放','好','光','害','地','能','大','也','施',
  '伤','说','吧','所','要','造','为','到','动','星','会','市','力','荔','枝','使','状','没','呢','吗',
  '之','风','克','可','什','看','用','过','样','斯','态','子','神','击','该','以','复','出','方','无',
  '水','下','移','然','件','去','得','锁','想','起','里','真','效','示','还','莉','点','上','显','制',
  '入','作','着','中','发','封','时','种','都','话','火','小','酱','和','但','生','们','明','提','心',
  '很','焰','天','家','气','雷','攻','她','现','如','面','打','自','手','圣','哈','而','回','温','长',
  '感','瓦','龙','行','毒','后','头','觉','电','亚','开','被','因','意','恢','剑','女','加','果','身',
  '进','只','情','蒂','历','活','精','升','前','多','给','治','道','做','睡','寒','最','才','怎','本',
  '死','实','者','甲','麻','与','暴','眠','像','吸','经','唱','于','让','战','花','爆','其','尔','从',
  '当','外','姐','正','把','定','变','太','走','收','金','常','间','盾','结','已','知','王','沉','他',
  '吐','防','次','查','工','原','达','此','混','别','陷','等','完','孩','算','物','冰','并','展','疗',
  '己','由','拉','息','波','斗','解','虽','西','相','超','少','乱','默','色','粉','关','声','理','海',
  '直','石','重','降','布','些','量','雪','通','友','先','痹','受','比','东','边','强','见','具','今',
  '御','谢','倒','位','再','武','题','枪','主','同','秘','化','尊','读','分','护','干','妖','灵','世',
  '何','接','连','合','便','喜','银','萨','总','铁','度','部','吃','低','场','啦','白','障','流','安',
  '品','器','更','玩','处','请','卷','影','弓','片','屏','难','欢','阅','莱','名','怪','问','非','口',
  '敏','伙','装','听','失','饰','血','消','鳞','捷','简','命','歌','约','妹','奇','高','将','呀','向',
  '味','候','士','反','娜','哥','带','爱','卡','板','店','类','快','福','始','皮','男','年','森','呜',
  '底','木','美','商','应','存','内','目','故','平','盔','竟','音','传','除','牌','格','系','又','近',
  '三','掉','思','臭','日','视','炎','烈','取','致','散','斧','雾','概','姆','角','第','空','恶','住',
  '乎','医','冷','城','数','错','型','画','狂','界','表','雨','哪','似','机','鞭','许','普','或','找',
  '米','塔','青','服','蛋','老','眼','刚','疾','两','抱','药','萝','且','逃','异','利','指','嘿','袭',
  '草','交','确','笑','魂','术','门','料','院','突','绝','认','浪','曲','杀','随','愈','顺','速','露',
  '震','宝','试','破','记','否','办','钱','爪','棒','终','鬼','沙','释','持','必','咒','祝','望','沃',
]);

function isCommonHanzi(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if (cp < 0x4E00 || cp > 0x9FFF) return false;
  return COMMON_HANZI.has(ch);
}

interface CharStats {
  valid: number; other: number; charTotal: number;
  hasKana: boolean; hasKanji: boolean; hasPunct: boolean;
  commonHanzi: number; totalHanzi: number; maxHanziRun: number;
  fullKana: number; halfKana: number;
}

function scoreCharStats(text: string): CharStats {
  let valid = 0, other = 0, charTotal = 0;
  let hasKana = false, hasKanji = false, hasPunct = false;
  let commonHanzi = 0, totalHanzi = 0;
  let maxHanziRun = 0, curRun = 0;
  let fullKana = 0, halfKana = 0;

  for (const ch of text) {
    charTotal++;
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      if (cp >= 0x20 && cp <= 0x7E) valid++;
      else if (cp === 0x09 || cp === 0x0A || cp === 0x0D) valid++;
      else { other++; curRun = 0; }
    }
    else if (cp >= 0x3040 && cp <= 0x30FF) {
      valid++; hasKana = true; fullKana++; curRun = 0;
    }
    else if (cp >= 0x4E00 && cp <= 0x9FFF) {
      valid++; hasKanji = true; totalHanzi++;
      if (isCommonHanzi(ch)) commonHanzi++;
      curRun++;
      if (curRun > maxHanziRun) maxHanziRun = curRun;
    }
    else if (cp >= 0x3400 && cp <= 0x4DBF) {
      other++; curRun = 0;
    }
    else if (cp >= 0x3000 && cp <= 0x303F) {
      valid++; hasPunct = true; curRun = 0;
    }
    else if (cp >= 0xFF00 && cp <= 0xFFEF) {
      valid++;
      if (cp >= 0xFF65 && cp <= 0xFF9F) halfKana++;
      curRun = 0;
    }
    else if (cp >= 0x2000 && cp <= 0x206F) { valid++; curRun = 0; }
    else { other++; curRun = 0; }
  }

  return { valid, other, charTotal, hasKana, hasKanji, hasPunct, commonHanzi, totalHanzi, maxHanziRun, fullKana, halfKana };
}

const CANDIDATE_ENCODINGS: EncodingName[] = ['shift_jis', 'gbk', 'euc_jp', 'utf8'];

/**
 * 从 DB 里提取两类字符串：
 * - fileRefs：应该匹配磁盘文件名的字段（characterName, faceName, chipsetName, BGM/SE 名...）
 * - displayTexts：纯显示文本（角色名、道具名、技能名...），用于文本质量评分
 */
export function splitDbRefs(db: Database): { fileRefs: string[]; displayTexts: string[] } {
  const fileRefs: string[] = [];
  const displayTexts: string[] = [];
  const pushFile = (s: string | undefined | null) => {
    if (typeof s === 'string' && s.trim()) fileRefs.push(unescapeWindy(s.trim()));
  };
  const pushText = (s: string | undefined | null) => {
    if (typeof s === 'string' && s.trim()) displayTexts.push(unescapeWindy(s.trim()));
  };

  for (const a of db.actors ?? []) {
    pushText((a as any).name);
    pushText((a as any).title);
    pushFile(a.characterName);
    pushFile(a.faceName);
    pushFile((a as any).battlerName);
  }
  for (const c of (db as any).classes ?? []) pushText(c.name);
  for (const cs of db.chipsets ?? []) pushFile(cs.chipsetName);
  for (const sk of db.skills ?? []) pushText((sk as any).name);
  for (const it of db.items ?? []) pushText((it as any).name);
  for (const en of db.enemies ?? []) {
    pushText((en as any).name);
    pushFile((en as any).battlerName);
  }
  for (const st of db.states ?? []) pushText((st as any).name);
  for (const tr of db.terrains ?? []) pushText((tr as any).name);
  for (const at of db.attributes ?? []) pushText((at as any).name);
  for (const an of db.animations ?? []) {
    pushText((an as any).name);
    pushFile((an as any).animationName);
  }
  for (const br of (db as any).battleranimations ?? []) pushText(br.name);
  for (const tp of db.troops ?? []) pushText((tp as any).name);
  for (const ce of db.commonevents ?? []) pushText((ce as any).name);

  const sys = db.system as unknown as Record<string, string> | undefined;
  if (sys) {
    for (const k of ['titleName', 'gameoverName', 'systemName', 'system2Name']) {
      pushFile(sys[k]);
    }
    pushFile(sys.frameName);
    pushFile((sys as any).battletestBackground);
    const bgmSeKeys = ['titleMusic','battleMusic','battleEndMusic','innMusic','boatMusic','shipMusic','airshipMusic','gameoverMusic','cursorSe','decisionSe','cancelSe','buzzerSe','battleSe','escapeSe','enemyAttackSe','enemyDamagedSe','actorDamagedSe'];
    for (const k of bgmSeKeys) {
      const v = (sys as any)[k];
      if (v && typeof v === 'object') pushFile(v.name);
      else pushFile(v);
    }
  }
  return { fileRefs, displayTexts };
}

/**
 * 从 LMU 文件结构化解码并提取事件命令中的显示文本（对话、选项等）。
 * 替代 extractTextsFromRaw 的二进制正则扫描，避免把 LMU 二进制结构误读为文本。
 */
function extractMapTexts(bufs: Uint8Array[], enc: EncodingName, engine: EngineVersion): string[] {
  const t = makeTranscoder(enc);
  const texts: string[] = [];
  const textCodes = new Set([10110, 20110, 10140, 20140, 10150, 10610, 10740, 12410, 22410]);
  for (const buf of bufs) {
    try {
      const map = decodeMapUnit(buf, { engine, transcoder: t });
      for (const ev of map.events || []) {
        // 不取 ev.name —— 那是编辑器标签(EV0001)，不是显示文本
        for (const page of ev.pages || []) {
          for (const cmd of page.eventCommands || []) {
            collectCmdTexts(cmd, textCodes, texts);
          }
        }
      }
    } catch {}
  }
  return texts;
}

function collectCmdTexts(cmd: any, textCodes: Set<number>, texts: string[]) {
  if (!cmd) return;
  if (cmd.string && textCodes.has(cmd.code)) texts.push(cmd.string);
  if (cmd.eventCommands) {
    for (const sub of cmd.eventCommands) collectCmdTexts(sub, textCodes, texts);
  }
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

  let { displayTexts } = splitDbRefs(db);
  if (extraBufs.length > 0) {
    const extraTexts = extractMapTexts(extraBufs, enc, engine);
    if (extraTexts.length > 0) {
      displayTexts = [...displayTexts, ...extraTexts];
    }
  }
  const reasons: string[] = [];
  let total = 0;

  if (displayTexts.length > 0) {
    const allText = displayTexts.join(' ');
    const s = scoreCharStats(allText);

    if (s.charTotal === 0) {
      reasons.push('empty');
    } else {
      const n = s.charTotal;
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
        // 真正日文：全角假名多；GBK错解会产生大量半角假名乱码
        const halfRatio = s.fullKana + s.halfKana > 0 ? s.halfKana / (s.fullKana + s.halfKana) : 0;
        if (halfRatio > 0.6) {
          total -= 25;
          reasons.push(`-fakeJaHalfKana halfKanaRatio:${halfRatio.toFixed(2)}`);
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
      const text = iconv.decode(iniBuf, ICONV_TO_ENCODING[enc]);
      const s = scoreCharStats(text);
      const bad = s.other + (s.charTotal === 0 ? 0 : (1 - s.valid / s.charTotal) * 5);
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

  let mapIdx = 1;
  while (true) {
    const name = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
    try {
      const muHandle = await safeGetFileHandle(root, name);
      const muBuf = await readAll(muHandle);
      const mu = decodeMapUnit(muBuf, { engine: result.engine, transcoder });
      result.maps.set(mapIdx, mu);
      mapIdx++;
    } catch { break; }
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

    // LMU 一直是从磁盘读的
    newData.maps = new Map();
    let mapIdx = 1;
    while (true) {
      const name = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
      try {
        const muHandle = await safeGetFileHandle(data.rootHandle, name);
        const muBuf = await readAll(muHandle);
        const mu = decodeMapUnit(muBuf, { engine: data.engine, transcoder });
        newData.maps.set(mapIdx, mu);
        mapIdx++;
      } catch { break; }
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