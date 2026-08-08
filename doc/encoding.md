# 编码检测

## 为什么需要检测

RPG Maker 2000/2003 **原生用 Shift_JIS (CP932)** 编码存储 LCF 字符串。但被翻译工具（如 RPGRewriter/WindyTranslator）处理后，字符串可能被改写成 GBK (CP936) 或其他编码。游戏运行时只支持一种编码——要么全文件 Shift_JIS，要么全文件 GBK——我们需要自动判断哪种是正确的。

**之前踩过的坑**：
1. 只看 RPG_RT.ldb —— DB 里 name 字段太少，很多游戏只有几行
2. 用文件名字段（titleName/systemName/characterName）评分 —— 它们是素材文件名不是显示文本
3. 单纯"比例比较"不看"字符质量" —— GBK 字节被 Shift_JIS 错解时会大量落入假名区，触发假阳性

## 核心策略：同时扫 DB + .lmu

**游戏里的大量文本在地图事件命令里**，不在 DB 里。`RPG_RT.ldb` 通常只有几十个 name 字段，而 `Map*.lmu` 的 `ShowMessage` / `ShowChoice` 命令里可能有数千段对话文本。

当前实现：
```
detectEncoding(iniBuf, ldbBuf, engine, lmuBufs[])
    ↓
对每个候选编码（shift_jis, gbk, euc_jp, utf8）:
    scoreEncoding(ldbBuf, engine, enc, lmuBufs)
        ↓
        splitDbRefs(decodeDatabase(ldbBuf, transcoder))
            → displayTexts (DB 内 S_TOTRANSLATE/S_UNTRANSLATED 字段)
        + extractTextsFromRaw(lmuBufs, enc)
            → 用候选编码解 .lmu 原始字节，正则抽含中日韩字符的片段
        → 合并所有 displayTexts，scoreCharStats，打分
    ↓
取最高分的编码
```

## scoreCharStats：字符质量统计

对解码后的文本，逐字符分类：

| 字符范围 | 分类 | 统计项 |
|---|---|---|
| `U+0020-U+007E` | ASCII 可打印 | valid |
| `U+3040-U+30FF` | 平假名+片假名 | valid + `hasKana` + `fullKana`（全角假名数） |
| `U+4E00-U+9FFF` | CJK 统一汉字 | valid + `hasKanji` + `totalHanzi` + `commonHanzi`（常用汉字数）+ `hanziRun`（最长连续汉字串） |
| `U+3000-U+303F` | CJK 标点 | valid + `hasPunct` |
| `U+FF65-U+FF9F` | 半角片假名 | valid + `halfKana` |
| `U+FF00-U+FFEF` | 全角 ASCII+全角片假名 | valid |
| 其他 | 乱码/扩展区 | other |

**常用汉字表**（`isCommonHanzi`）：2500 个最常用汉字 + 常用假名（あ-ん、ア-ン）+ 常用日文汉字（駅、図、伝、転、読、実、業、歴、問、響 等）。**这是区分"真中文"和"GBK 字节被 Shift_JIS 错解"的关键**——后者解出来的汉字几乎全在生僻字区（U+3400-U+4DBF）。

## scoreEncoding：评分规则

### zhPattern（判定为中文）
同时满足：
- `hanziRatio ≥ 0.3`（汉字占比足够高）
- `commonRatio ≥ 0.3`（常用汉字占比不低于 30%）
- `kanaRatio < 0.15`（不能混太多假名）

命中 zhPattern → +40
常用汉字密度 bonus（commonRatio 每超出 0.31 部分）→ +30
连续汉字串 bonus（maxHanziRun ≥ 5）→ +15
中文标点 bonus（hasPunct）→ +10
常用汉字存在 bonus（commonHanzi > 0）→ +10

### jaPattern（判定为日文）
同时满足：
- `kanaRatio > hanziRatio * 0.8`（假名比汉字多或相近）
- `kanaRatio ≥ 0.1`（假名不能太少）
- `halfKanaRatio < 0.6`（半角片假名占比不超过 60%——否则大概率是 GBK 字节被 Shift_JIS 错解出的假半角假名）

命中 jaPattern → +40
全角假名 bonus（fullKana ≥ 3 且假名数 > 汉字数）→ +20

### 互斥惩罚
- **假中文惩罚**：hanziRatio ≥ 0.3 但 commonRatio < 0.2 → `-fakeZh -30`
- **假日文惩罚**：kanaRatio 高但 halfKanaRatio ≥ 0.6 → `-fakeJaHalfKana -30`
- **混合垃圾惩罚**：hanziRatio + kanaRatio 都偏低，且 other 多 → `-mixedGarbage -30`

### 关键互斥条件
`zhPattern` 和 `jaPattern` **互斥**——一个文本不可能同时满足两者。评分表按优先级判定：zhPattern 优先（因为中文文本也可能包含少量日文汉字）。

## 为什么之前会把中文游戏判成 Shift_JIS

Light Tower（no37_LIGHT TOWER）的情况：
- DB 里只有少量 name 字段，很多是 ASCII
- 之前没扫 .lmu，只有 DB 几十行样本
- GBK 字节被 Shift_JIS 错解时，很多双字节序列恰好落入半角片假名区（U+FF65-U+FF9F），触发了 jaPattern
- 之前没有 `halfKanaRatio < 0.6` 的约束，也没有 commonRatio 的概念
- **结果**：假日文特征得分比假中文高 → 错判 shift_jis

修复后：
- 扫了 27 个 .lmu，拿到数千行中文对话
- commonRatio ≈ 0.4（大量常用汉字）→ 命中 zhPattern + 70 分
- Shift_JIS 错解时 halfKanaRatio ≈ 0.8 → 触发 `-fakeJaHalfKana -30` + 不命中任何 pattern
- **结果**：gbk 74.6 vs shift_jis 48.7（gap=25.9，稳稳判 gbk）

## Ground Truth（2026-08-08 全磁盘扫描，23 个游戏）

全部正确识别，gap 均 ≥ 25：

| 类型 | 结果 | gap | 典型样本 |
|---|---|---|---|
| 已翻译中文（16 个） | gbk | 25-61 | `闇市ダンジョン`, `AngelFantasyIF`, `[chs]地獄病棟おぼなす` |
| 未翻译日文（7 个） | shift_jis | 68-100 | `星の魔法少女ヒカリちゃん`, `ダークネスⅠを救うksgアナザー` |

**最小 gap 的危险 case 已被消灭**：
- `[chs]地獄病棟おぼなす`（之前 gap=1.0，只有 DB name 字段）→ 现在扫了 1 个 .lmu，gap=25.2
- `ダークネスⅠを救うksgアナザー`（之前 gap=0.2，DB 几乎空）→ 扫了 3 个 .lmu，gap=100.0

## 候选编码

```typescript
const CANDIDATE_ENCODINGS: EncodingName[] = ['shift_jis', 'gbk', 'euc_jp', 'utf8'];
```

- shift_jis = CP932，iconv-lite 名 `shift_jis`
- gbk = CP936，iconv-lite 名 `gbk`
- euc_jp = EUC-JP，iconv-lite 名 `euc_jp`（目前评分极低，几乎不会被选中）
- utf8 = UTF-8，iconv-lite 名 `utf8`

目前 euc_jp 和 utf8 主要作为兜底选项——实际上 RM2k/2k3 生态里几乎只有 Shift_JIS 和 GBK 两种。

## 工作流

改编码相关代码时：
1. 先跑全磁盘测试（见 _final_test.ts 模板，删掉临时文件前保存）
2. 对每个"看起来可能有问题"的游戏，用 rpgrt 分别用两种编码解码 .lmu 看文本
3. 用 RPGRewriter 的 S_FILENAME / S_TOTRANSLATE 分类来判断某个字段该不该进 displayTexts
