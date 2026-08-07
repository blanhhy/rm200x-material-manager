import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
const GAME_DIR = 'D:\\Games\\やみっちのカカオを求めた大商売';
const { decodeDatabase, decodeMapUnit } = await import('rpgrt');

const latin1 = {
  decode(bytes) { return Buffer.from(bytes).toString('latin1'); },
  encode(str) { return new Uint8Array(Buffer.from(str, 'latin1')); },
};

function readBer(bytes, offset) {
  let result = 0, shift = 0;
  let b;
  do {
    b = bytes[offset++];
    result |= (b & 0x7F) << shift;
    shift += 7;
  } while (b & 0x80);
  return { value: result, offset };
}

function parseMoveCommandsFromBytes(bytes) {
  const results = [];
  let offset = 0;
  while (offset < bytes.length) {
    const { value: cmdId, offset: afterId } = readBer(bytes, offset);
    offset = afterId;
    if (cmdId === 0) break;

    if (cmdId === 34) {
      const { value: strLen, offset: afterLen } = readBer(bytes, offset);
      offset = afterLen;
      const graphicBytes = bytes.slice(offset, offset + strLen);
      offset += strLen;
      const { value: idx, offset: afterIdx } = readBer(bytes, offset);
      offset = afterIdx;
      results.push({ type: 'changeGraphic', nameShiftJis: iconv.decode(graphicBytes, 'shift_jis'), nameGbk: iconv.decode(graphicBytes, 'gbk'), index: idx });
    } else if (cmdId === 35) {
      const { value: strLen, offset: afterLen } = readBer(bytes, offset);
      offset = afterLen;
      const seBytes = bytes.slice(offset, offset + strLen);
      offset += strLen;
      const { offset: o2 } = readBer(bytes, offset);
      const { offset: o3 } = readBer(bytes, o2);
      const { offset: o4 } = readBer(bytes, o3);
      offset = o4;
      results.push({ type: 'playSE', name: iconv.decode(seBytes, 'shift_jis') });
    } else if (cmdId <= 41) {
      results.push({ type: 'move', id: cmdId });
    } else {
      results.push({ type: 'UNKNOWN', id: cmdId });
      break;
    }
  }
  return results;
}

const db = decodeDatabase(new Uint8Array(fs.readFileSync(path.join(GAME_DIR, 'RPG_RT.ldb'))), { engine: '2k', transcoder: latin1 });

// 先验证 CE#70 cmd[6]
const ce70 = db.commonevents.find(c => c.id === 70);
const cmd6 = ce70.eventCommands[6];
const cmd6bytes = Buffer.from(cmd6.string, 'latin1');
console.log(`CE#70 cmd[6] (code=${cmd6.code}) raw hex: [${cmd6bytes.toString('hex')}]`);
const parsed = parseMoveCommandsFromBytes(cmd6bytes);
console.log(`解析结果:`, parsed);

// 全局扫描！
console.log('\n\n===== 全局扫描所有 code=10610 的 MoveRoute =====');
const allCharSets = new Set();
const allFaces = new Set();
const allBattleChars = new Set();
const allBGMs = new Set();
const allSEs = new Set();
const allPictures = new Set();
const allMovies = new Set();

function scanCmds(cmds, ctx) {
  for (const cmd of cmds ?? []) {
    // EventCommand 里有 string 的命令
    let cat = null;
    if (cmd.code === 10130) cat = 'FaceSet';
    else if (cmd.code === 10630) cat = 'CharSet';
    else if (cmd.code === 10640) cat = 'FaceSet';
    else if (cmd.code === 10650) cat = 'BattleChar';
    else if (cmd.code === 10660) cat = 'BGM';
    else if (cmd.code === 10670) cat = 'SE';
    else if (cmd.code === 10680 || cmd.code === 10690) cat = 'System';
    else if (cmd.code === 11110 || cmd.code === 11120 || cmd.code === 13210) cat = 'Picture';
    else if (cmd.code === 11510) cat = 'BGM';
    else if (cmd.code === 11550) cat = 'SE';
    else if (cmd.code === 11560) cat = 'Movie';
    else if (cmd.code === 11570) cat = 'BGS';
    else if (cmd.code === 11580) cat = 'ME';
    else if (cmd.code === 11720) cat = 'Panorama';

    if (cat && cmd.string) {
      // cmd.string 是 latin1 伪字符串 -> 转成 bytes -> shift_jis 解码
      const bytes = Buffer.from(cmd.string, 'latin1');
      const realName = iconv.decode(bytes, 'shift_jis').trim();
      if (realName && realName !== '(OFF)') {
        if (cat === 'CharSet') allCharSets.add(realName.toLowerCase());
        else if (cat === 'FaceSet') allFaces.add(realName.toLowerCase());
        else if (cat === 'BattleChar') allBattleChars.add(realName.toLowerCase());
        else if (cat === 'BGM') allBGMs.add(realName.toLowerCase());
        else if (cat === 'SE') allSEs.add(realName.toLowerCase());
        else if (cat === 'Picture') allPictures.add(realName.toLowerCase());
        else if (cat === 'Movie') allMovies.add(realName.toLowerCase());
        console.log(`  [${cat}] "${realName}" @ ${ctx} cmd${cmd.code}`);
      }
    }

    // Set Move Route: code=10610 string 里打包了 MoveCommands
    if ([10610, 10600, 10620].includes(cmd.code)) {
      const bytes = Buffer.from(cmd.string || '', 'latin1');
      // 但等等——先验证一下 code=10610 在 rpgrt 的 EventCommandCode 里到底是什么
      // 根据之前搜索，10610 = ChangeHeroName! 那 Set Move Route 是什么？
      // 让我先把 bytes 打印出来看有没有意义
      const parsed2 = parseMoveCommandsFromBytes(bytes);
      const changeGraphics = parsed2.filter(p => p.type === 'changeGraphic');
      if (changeGraphics.length > 0) {
        console.log(`  ✅ SetMoveRoute-like @ ${ctx} cmd${cmd.code}:`, changeGraphics.map(c => c.nameShiftJis));
        for (const c of changeGraphics) allCharSets.add(c.nameShiftJis.toLowerCase());
      }
    }
  }
}

for (const ce of db.commonevents ?? []) {
  scanCmds(ce.eventCommands ?? [], `CE#${ce.id}`);
}

let mapIdx = 1;
while (true) {
  const fname = `Map${String(mapIdx).padStart(4, '0')}.lmu`;
  const fpath = path.join(GAME_DIR, fname);
  if (!fs.existsSync(fpath)) break;
  const mu = decodeMapUnit(new Uint8Array(fs.readFileSync(fpath)), { engine: '2k', transcoder: latin1 });
  for (const ev of mu.events ?? []) {
    for (const page of ev.pages ?? []) {
      scanCmds(page.eventCommands ?? [], `Map${mapIdx} ev#${ev.id} page#${page.id}`);
      // EventPage.characterName 也用 latin1 存的，转 bytes -> shift_jis
      if (page.characterName) {
        const bytes = Buffer.from(page.characterName, 'latin1');
        const realName = iconv.decode(bytes, 'shift_jis').trim();
        if (realName) allCharSets.add(realName.toLowerCase());
      }
      // EventPage.moveRoute 的 MoveCommands
      for (const mc of page.moveRoute?.moveCommands ?? []) {
        if (mc.commandId === 34 && mc.parameterString) {
          // parameterString 也是 latin1 伪字符串
          const bytes = Buffer.from(mc.parameterString, 'latin1');
          const realName = iconv.decode(bytes, 'shift_jis').trim();
          if (realName) allCharSets.add(realName.toLowerCase());
        }
      }
    }
  }
  // Map parallax
  if (mu.parallaxName) {
    const bytes = Buffer.from(mu.parallaxName, 'latin1');
    const realName = iconv.decode(bytes, 'shift_jis').trim();
    if (realName) allPictures.add(realName.toLowerCase());
  }
  mapIdx++;
}

// DB 直接字段
for (const a of db.actors ?? []) {
  if (a.characterName) allCharSets.add(a.characterName.toLowerCase()); // 已经是 shift_jis 直接解码
  if (a.faceName) allFaces.add(a.faceName.toLowerCase());
}
if (db.system?.boatName) allCharSets.add(db.system.boatName.toLowerCase());
if (db.system?.shipName) allCharSets.add(db.system.shipName.toLowerCase());
if (db.system?.airshipName) allCharSets.add(db.system.airshipName.toLowerCase());
if (db.system?.titleName) allPictures.add(db.system.titleName.toLowerCase());
if (db.system?.systemName) allPictures.add(db.system.systemName.toLowerCase());
if (db.system?.frameName) allPictures.add(db.system.frameName.toLowerCase());
if (db.system?.gameoverName) allPictures.add(db.system.gameoverName.toLowerCase());

console.log(`\n\n===== 最终汇总（用 shift_jis 正确解码后）=====`);
const diskCharSet = fs.readdirSync(path.join(GAME_DIR, 'CharSet')).map(f => {
  const dot = f.lastIndexOf('.');
  return (dot > 0 ? f.slice(0, dot) : f).toLowerCase();
});
const diskFaceSet = fs.readdirSync(path.join(GAME_DIR, 'FaceSet')).map(f => {
  const dot = f.lastIndexOf('.');
  return (dot > 0 ? f.slice(0, dot) : f).toLowerCase();
});

console.log(`\nCharSet: 追踪 ${allCharSets.size} 个, 磁盘 ${diskCharSet.length} 个, 未使用 ${diskCharSet.filter(d => !allCharSets.has(d)).length} 个`);
const unusedCharset = diskCharSet.filter(d => !allCharSets.has(d));
if (unusedCharset.length > 0) {
  console.log(`  未使用列表: ${unusedCharset.map(s => `"${s}"`).join(', ')}`);
}

console.log(`\nFaceSet: 追踪 ${allFaces.size} 个, 磁盘 ${diskFaceSet.length} 个, 未使用 ${diskFaceSet.filter(d => !allFaces.has(d)).length} 个`);
const unusedFace = diskFaceSet.filter(d => !allFaces.has(d));
if (unusedFace.length > 0) {
  console.log(`  未使用列表: ${unusedFace.map(s => `"${s}"`).join(', ')}`);
}
