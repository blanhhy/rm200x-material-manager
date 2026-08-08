# LCF 文件格式 & 字段分类

## RM2k/2k3 游戏目录里有什么

| 文件 | 作用 | 用 rpgrt 读 | 用 RPGRewriter 时的字符串分类 |
|---|---|---|---|
| `RPG_RT.ldb` | 主数据库（角色/道具/技能/敌人/系统...） | `decodeDatabase(buf, {engine, transcoder})` | 各字段分 S_TOTRANSLATE / S_FILENAME / S_UNTRANSLATED |
| `RPG_RT.lmt` | 地图树（地图列表 + 每个地图的位置/背景） | `decodeTreeMap(buf, {engine, transcoder})` | 地图文件名 → S_FILENAME |
| `MapXXXX.lmu` | 单个地图（图层 + 事件 + 事件命令） | `decodeMapUnit(buf, {engine, transcoder})` | 事件命令里的字符串 → 命令级别判断 |
| `RPG_RT.ini` | 启动配置 | 我们自己 `parseIni` | 无 |
| `*.ldb / *.lmt / *.lmu` 之外的 | 素材（Charset/, Chipset/, Music/...） | 不读内容，只追踪文件名引用 | — |

## 引擎版本判定（detectEngine）

参考 EasyRPG `lcf::GetEngineVersion`：
1. `system.ldb_id === 2003` → 2k3
2. `classes` 数组非空 → 2k3（2000 没有这个数组）
3. 否则 → 2k

## rpgrt API 字段名 ↔ RPGRewriter 分类 ↔ 我们的处理

### 核心原则
- **S_TOTRANSLATE（0）** = 游戏内显示文本，**进 displayTexts 用于编码评分**
- **S_FILENAME（2）** = 素材文件名，**进 fileRefs 用于引用追踪**，**绝不进 displayTexts**
- **S_UNTRANSLATED（1）** = 不翻译但仍是文本，**我们的 splitDbRefs 里归入 displayTexts**
- **S_CONSTANT（3）** = 固定 Shift_JIS 的头部常量，我们不碰

### System 对象（最容易搞混的！）

| rpgrt 字段 | RPGRewriter 分类 | 含义 | 我们的处理 |
|---|---|---|---|
| `titleName` | **S_FILENAME** | 标题画面背景图文件名 | **fileRefs**（⚠️ 不是显示文本！） |
| `gameoverName` | **S_FILENAME** | GameOver 画面文件名 | **fileRefs** |
| `systemName` | **S_FILENAME** | 系统界面图（消息框等） | **fileRefs** |
| `system2Name` | **S_FILENAME** | 备用系统图 | **fileRefs** |
| `frameName` | **S_FILENAME** | 外框图 | **fileRefs** |
| `battletestBackground` | **S_FILENAME** | 战斗测试背景 | **fileRefs** |
| `boatName / shipName / airshipName` | **S_FILENAME** | 交通道具图 | **fileRefs** |
| `titleMusic / battleMusic / cursorSe / ...` | **S_FILENAME** | BGM/SE 文件名 | **fileRefs**（取 `.name` 子字段） |

### Actor（角色）

| rpgrt 字段 | RPGRewriter 分类 | 含义 | 我们的处理 |
|---|---|---|---|
| `name` | **S_TOTRANSLATE** | 角色显示名 | **displayTexts** |
| `title` | **S_TOTRANSLATE** | 称号 | **displayTexts** |
| `characterName` | **S_FILENAME** | 角色图文件名（*.png） | **fileRefs** |
| `faceName` | **S_FILENAME** | 脸图文件名 | **fileRefs** |

### Item / Skill

| rpgrt 字段 | RPGRewriter 分类 | 含义 | 我们的处理 |
|---|---|---|---|
| `name` | **S_TOTRANSLATE** | 道具/技能名 | **displayTexts** |
| `description` | **S_TOTRANSLATE** | 道具描述 | **displayTexts** |
| `usingMessage` | **S_TOTRANSLATE** | 使用消息 | **displayTexts**（但 Skill 没有这个字段，Skill 有 useMessage/useMessage2） |

### Enemy

| rpgrt 字段 | RPGRewriter 分类 | 含义 | 我们的处理 |
|---|---|---|---|
| `name` | **S_TOTRANSLATE** | 敌人显示名 | **displayTexts** |
| `battlerName` | **S_FILENAME** | 战斗图文件名 | **fileRefs** |

### Animation / BattlerAnimation

| rpgrt 字段 | RPGRewriter 分类 | 含义 | 我们的处理 |
|---|---|---|---|
| `name` | **S_TOTRANSLATE** | 动画名（编辑器里显示） | **displayTexts** |
| `animationName` | **S_FILENAME** | 动画帧图文件名 | **fileRefs** |
| `battleCharSet`（在 BattlerAnimationItemSkill 里） | **S_FILENAME** | 战斗 charset 文件名 | **fileRefs** |

### CommonEvent / Switch / Variable / Troop

| rpgrt 字段 | RPGRewriter 分类 | 含义 | 我们的处理 |
|---|---|---|---|
| `commonEvent.name` | **S_UNTRANSLATED** | 公共事件名（编辑器显示） | displayTexts（虽不翻译但仍是文本） |
| `switch.name` | **S_UNTRANSLATED** | 开关名 | 未读（我们不追踪） |
| `variable.name` | **S_UNTRANSLATED** | 变量名 | 未读 |
| `troop.name` | **S_UNTRANSLATED** | 战斗组合名 | displayTexts |

## EventCommand（.lmu 里的事件命令）

RPGRewriter 的规则：**命令参数的字符串类型由命令 code + 参数模式决定**

核心判断：
```csharp
int strType = mode != -1 && mode < M.FOLDERCOUNT ? M.S_FILENAME : M.S_TOTRANSLATE;
// FOLDERCOUNT = 19，对应 19 个素材文件夹
```

也就是说：
- **如果命令参数是素材引用**（文件名模式，mode < 19）→ S_FILENAME
- **否则**（对话、选项、消息...）→ S_TOTRANSLATE

典型 S_TOTRANSLATE 的命令（含大量显示文本，**编码推断主要来源**）：
- `ShowMessage`（code 10110）— 对话文本
- `ShowChoice`（code 10140）— 选项文本
- `ChangeHeroName`（code 10610）— 允许玩家输入名字
- `EnterHeroName`（code 10740）— 同上
- `Comment`（code 12410）— 注释
- `ConditionalBranch` 的 when-分支消息

典型 S_FILENAME 的命令：
- `PlayBGM / PlaySound`（code 11510/11550）
- `ShowPicture / MovePicture`（code 11110/11120）
- `ChangeFaceGraphic`（code 10130）
- `ChangeSpriteAssociation`（code 10630）
- `ChangeVehicleGraphic`（code 10650）
- `PlayMovie`（code 11560）

## 引擎字段（仅 2k3）

RPG_RT.ini 里 `RPG_RT.Engine=RPG Maker 2003` → 2k3 项目会有：
- `db.classes[]`（职业数组，2k 没有）
- `db.system.ldbId === 2003`
- `commonEvent` 比 2k 多一个 `trigger` 字段
- Map 格式里多了一些 EasyRPG 扩展字段

## 我们的 splitDbRefs（lcfLoader.ts）

当前做法已经和 RPGRewriter 对齐：

**fileRefs（素材文件名，追踪用）**：
- `hero.characterName`, `hero.faceName`, `hero.battlerName`
- `chipset.chipsetName`
- `enemy.battlerName`
- `animation.animationName`
- `system.titleName`, `system.gameoverName`, `system.systemName`, `system.system2Name`, `system.frameName`, `system.battletestBackground`, `system.boatName`, `system.shipName`, `system.airshipName`
- 所有 BGM/SE 的 `.name` 子字段

**displayTexts（显示文本，编码评分用）**：
- `actor.name`, `actor.title`, `actor.skillName`
- `class.name`
- `skill.name`
- `item.name`, `item.description`
- `enemy.name`
- `state.name`
- `terrain.name`
- `attribute.name`
- `troop.name`
- `commonEvent.name`
- `animations[].name`
- `battlerAnimations[].name`
- Vocab 里的所有战斗词典字符串（如存在）

## 资源

| 参考 | 路径 | 提供 |
|---|---|---|
| liblcf EventCommand | `.tech_support/liblcf/src/generated/lcf/rpg/eventcommand.h` | 所有命令的枚举定义 |
| RPGRewriter Command.cs | `.tech_support/RPGRewriter/Source/Command.cs` | 每个命令参数的详细分类逻辑 |
| RPGRewriter Database/ | `.tech_support/RPGRewriter/Source/Database/*.cs` | 每个 DB 对象的字段分类 |
