# AGENTS.md — 项目工作流快速索引

**项目名**：rm200x-material-manager（RM2k/2k3 素材管理器）
**技术栈**：React + Vite + TypeScript，浏览器端跑，用 Chrome File System Access API 直接操作磁盘游戏目录

---

## 🚨 先读这个

每次开始新任务前，先做 3 件事：

1. **扫一眼 `.tech_support/` 里有什么**——这里存了 EasyRPG / liblcf / R48 / RPGRewriter 四个权威参考，**不要自己瞎猜 LCF 格式或字段含义**
2. **快速过一遍 `doc/` 下对应的技术文档**——特别是改编码相关时读 `doc/encoding.md`，改文件操作时读 `doc/pitfalls.md`
3. **记住核心原则**：编码推断看游戏内显示文本（DB.name + .lmu 对话），不看文件名

---

## 📁 技术参考源（.tech_support/）

| 参考源 | 提供什么 | 什么时候去看 |
|---|---|---|
| **EasyRPG/** | 权威 RM2k/2k3 运行时实现（Player + Editor） | 想知道游戏**本体**怎么处理某个机制（比如编码、命令参数解析） |
| **liblcf/** | EasyRPG 用的 LCF 序列化库（Rust/C++ 端口） | 需要知道 **LCF 文件格式定义**、字段布局、数据类型时去看 `src/generated/lcf/rpg/*.h` |
| **RPGRewriter/** | C# 写的翻译器，包含完整的字符串分类体系 | 想知道**哪些字段是要翻译的显示文本**、哪些是文件名常量时去看 |
| **R48/** | Java 写的 RPG Maker 48 克隆，包含 LCF schema | 备选参考，当其他三个搞不定时看 |

**优先顺序**：EasyRPG Player → liblcf → RPGRewriter → R48

---

## 📖 项目文档（doc/）

| 文档 | 内容 |
|---|---|
| `architecture.md` | 整体架构、模块职责、核心数据流 |
| `lcf-format.md` | LCF 文件类型、rpgrt API 字段映射、RPGRewriter 字符串分类、我们 splitDbRefs 的做法 |
| `encoding.md` | 编码检测完整技术原理、ground truth（23 个游戏全正确）、评分算法 |
| `pitfalls.md` | Chrome FSA API 坑、Blob vs ArrayBuffer、终端 bug、其他反复踩过的坑 |
| `references.md` | 各参考源的详细路径索引 |

---

## 🏗️ 项目结构

```
src/
├── App.tsx                    # 主组件，项目加载入口
├── core/
│   ├── lcfLoader.ts           # DB/Map 解码 + 编码检测（detectEncoding, scoreEncoding, splitDbRefs）
│   ├── referenceTracker.ts    # 引用追踪（扫 DB+LMU 里的文件名引用）
│   ├── snapshot.ts            # 快照创建/恢复（BatchBlobWriter, prefetchDirs）
│   ├── deleteEngine.ts        # 删除引擎（读 Blob 缓存 → 写 deleted.blobs → 删原文件）
│   └── renameEngine.ts        # 重命名引擎
├── scanner/
│   ├── assetScanner.ts        # 扫素材目录 + 预读 Blob 缓存（prefetchedFileData = Map<string, Blob>）
│   └── assetTypes.ts          # 素材分类（DIR_TO_CATEGORY）
├── store/                     # Zustand 状态
├── components/                # UI 组件
└── preview/                   # 预览组件
```

---

## 🔑 反复踩过的坑（必读 pitfalls.md）

1. **不要用 ArrayBuffer 做持久缓存**——V8 GC 会 detach 内存，必须用 Blob（见 doc/pitfalls.md）
2. **编码推断必须同时看 DB 和 .lmu**——DB 只有 name 字段太稀疏，地图对话才是大头
3. **文件名（characterName/faceName/titleName 等）绝对不能进 displayTexts**——它们是素材文件名不是显示文本，进去会污染编码评分
4. **恢复快照时 prefetchDirs 参数不能搞反**——src 是快照目录，dst 是游戏根
5. **Windows 终端有 race condition bug**——`sed`/`ls` 等命令偶尔输出空，遇到时换 PowerShell 原生命令重试，不要花 30 分钟怀疑代码
6. **不要假设游戏是"全文件一个编码"**——原版是，但翻译工具（RPGRewriter）可以分字段类型用不同编码写回（虽然游戏运行时只按一个编码读，所以实际上还是一个）

---

## 📦 核心依赖

- **rpgrt** — LCF 解码库（npm 包），`decodeDatabase` / `decodeTreeMap` / `decodeMapUnit`
- **iconv-lite** — 编码转码
- **zustand** — 状态管理
- **Chrome File System Access API** — 唯一 IO 通道（`FileSystemDirectoryHandle`, `FileSystemFileHandle`）

---

## ✅ Ground truth（已验证，不要再推翻）

| 事实 | 来源 |
|---|---|
| RM2k/2k3 原生编码是 Shift_JIS（CP932） | EasyRPG Player + 所有原版日文游戏 |
| 翻译后的游戏用 GBK（CP936）或其他编码 | RPGRewriter WindyTranslator |
| 一个游戏一个编码（不是字段级） | 游戏运行时只调一次解码 |
| System.titleName / systemName 等是**素材文件名**不是显示文本 | RPGRewriter S_FILENAME 分类 |
| Hero.characterName / faceName 是素材文件名 | RPGRewriter S_FILENAME |
| Hero.name / title / Item.description 是显示文本 | RPGRewriter S_TOTRANSLATE |
| CommonEvent.name / Switch.name / Variable.name 是 S_UNTRANSLATED | RPGRewriter（不翻译但仍是文本） |
| 23 个真实游戏全可正确识别编码（gap ≥ 25） | 2026-08-08 全磁盘扫描 |
