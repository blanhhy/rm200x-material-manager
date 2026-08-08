# 技术参考源索引

本项目的核心参考源都在 `.tech_support/` 目录下。遇到不确定的 LCF 格式、字段含义、命令参数类型时，**优先查这些源码，不要自己瞎猜**。

---

## 1. EasyRPG（权威）

**路径**：`.tech_support/EasyRPG/`

**提供**：唯一同时完整实现了 RM2k/2k3 **编辑器**和**运行时**的项目。遇到任何关于"游戏本体怎么处理"的问题都看这个。

关键子目录：
```
EasyRPG/
├── Player/src/
│   ├── game_strings.cpp        ← 编码/文本处理
│   ├── lcf/                    ← 内嵌 liblcf 的运行时读取逻辑
│   └── model/                  ← 运行时数据模型
└── Editor/src/
    └── model/project.cpp       ← 编辑器项目加载（引擎版本判定、编码）
```

**什么时候看**：
- 想知道游戏运行时到底读不读某个字段
- 想知道 RM2k vs 2k3 的具体区别（引擎判定依据）
- 想知道某个 EventCommand 在运行时的完整参数列表

---

## 2. liblcf（LCF 格式权威）

**路径**：`.tech_support/liblcf/src/generated/lcf/rpg/`

**提供**：LCF（RPG Maker L 型 C 格式）的 C++ 序列化库。`src/generated/` 下是所有数据结构的头文件，由 LCF schema 自动生成。

**核心文件**：

| 文件 | 作用 |
|---|---|
| `eventcommand.h` | 所有事件命令的 code 枚举和参数定义（**最重要**） |
| `database.h` | RPG_RT.ldb 的顶层结构（包含 actors/items/skills...） |
| `system.h` | System 结构（titleName/systemName 等到底存什么） |
| `actor.h` | 角色结构（name/title/characterName/faceName 各是什么） |
| `item.h` | 道具结构 |
| `skill.h` | 技能结构 |
| `enemy.h` | 敌人结构 |
| `map.h` / `event.h` / `eventpage.h` | 地图结构（LMU 里有什么） |

**什么时候看**：
- 需要精确知道某个字段的类型、是否有、含义是什么
- 不确定 rpgrt 解码出的字段名是否正确
- EventCommand 参数解析需要对照

---

## 3. RPGRewriter（字符串分类权威）

**路径**：`.tech_support/RPGRewriter/Source/`

**提供**：C# 写的 RPG Maker 翻译器，包含完整的**字符串分类体系**。每个字段被标记为 4 种之一：

| 常量 | 值 | 含义 | 编码 |
|---|---|---|---|
| `S_TOTRANSLATE` | 0 | 游戏内显示文本 | 用户指定（GBK 等） |
| `S_UNTRANSLATED` | 1 | 不翻译的杂项（开关名、变量名、公共事件名） | 跟随 TOTRANSLATE 或独立配置 |
| `S_FILENAME` | 2 | 素材文件名 | 独立的 file 编码（可不同） |
| `S_CONSTANT` | 3 | 固定 Shift_JIS 的头部常量 | 永远 CP932 |

**关键文件**：

| 文件 | 作用 |
|---|---|
| `RPGRewriter.cs` | 主程序，定义 `S_TOTRANSLATE=0` / `S_UNTRANSLATED=1` / `S_FILENAME=2` / `S_CONSTANT=3`，`FOLDERCOUNT=19`，各编码配置 |
| `Command.cs` | **每个 EventCommand 的参数类型判断**：`strType = (mode != -1 && mode < FOLDERCOUNT) ? S_FILENAME : S_TOTRANSLATE` |
| `Database/System.cs` | System 各字段分类（titleName→S_FILENAME, systemName→S_FILENAME...） |
| `Database/Heroes.cs` | Hero：name/title→S_TOTRANSLATE, characterName/faceName→S_FILENAME |
| `Database/Items.cs` | Item：name/description→S_TOTRANSLATE |
| `Database/Skills.cs` | Skill：name/description/useMessage→S_TOTRANSLATE |
| `Database/CommonEvents.cs` | CommonEvent.name→**S_UNTRANSLATED**（注意，编辑器用不翻译） |
| `Database/Switches.cs` | Switch.name→S_UNTRANSLATED |
| `Database/Variables.cs` | Variable.name→S_UNTRANSLATED |
| `Database/Troops.cs` | Troop.name→S_UNTRANSLATED |
| `Database/Audio.cs` | BGM/SE→**S_FILENAME**（独立编码） |

**什么时候看**：
- 想知道某个字段应该进 displayTexts 还是 fileRefs
- 想知道 EventCommand 某个 code 的字符串参数是什么类型
- 不确定翻译工具（WindyTranslator）会怎么改游戏文件

---

## 4. R48（备选参考）

**路径**：`.tech_support/R48/`

**提供**：Java 写的 RPG Maker 48 克隆，包含完整的 LCF schema 和 VM 实现。

关键目录：
```
R48/
├── app/src/main/java/r48/
│   ├── schema/                 ← LCF schema 定义（Java 版 liblcf）
│   │   └── specialized/        ← TextBox / Command 等特殊类型
│   ├── minivm/                 ← 迷你 VM（Command 执行）
│   ├── io/r2k/                 ← 老 R2K 格式读取
│   └── map/events/             ← 地图事件处理
└── ioplus/src/main/java/r48/
    └── tr/pages/               ← 翻译页面对象
```

**什么时候看**：
- EasyRPG/liblcf/RPGRewriter 都没给出答案时的最后手段
- 想知道 RM48 有哪些 R48 扩展字段（与 RM2k/2k3 不同）

---

## npm 包

| 包 | 作用 | API |
|---|---|---|
| `rpgrt` | LCF 解码（Rust/WASM 编译） | `decodeDatabase(buf, opts)` / `decodeTreeMap(buf, opts)` / `decodeMapUnit(buf, opts)` |
| `iconv-lite` | 编码转码 | `iconv.decode(buf, 'gbk')` / `iconv.encode(str, 'shift_jis')` |

**rpgrt opts**：
```typescript
{
  engine: '2k' | '2k3',
  transcoder: { decode: (buf: Uint8Array) => string; encode: (str: string) => Uint8Array }
}
```

---

## 快速决策表

| 问题 | 先看 |
|---|---|
| 这个字段是什么意思？ | liblcf 的对应 `.h` 文件 |
| 这个字段该不该进 displayTexts？ | RPGRewriter 的 `Database/*.cs` 看 strType |
| EventCommand 某个 code 的字符串参数是文件名还是显示文本？ | RPGRewriter `Command.cs` |
| 引擎版本判定依据（2k vs 2k3）？ | EasyRPG `Editor/src/model/project.cpp` |
| 游戏运行时到底怎么处理编码？ | EasyRPG `Player/src/game_strings.cpp` |
| 2k3 有哪些 2k 没有的字段？ | liblcf 对比 `database.h` + RPGRewriter 里 LDB ID 判断 |
