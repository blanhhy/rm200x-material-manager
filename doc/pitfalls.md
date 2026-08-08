# 踩过的坑 & 避坑指南

## 1. ArrayBuffer 被 GC detach → 空快照（totalBytes=0）

**现象**：快照创建后 `totalBytes=0`，恢复后得到空文件。

**根因**：扫描时把文件数据读成 `ArrayBuffer` 存进 React/Zustand 状态。React 状态序列化过程中，V8 的 GC 会 detach ArrayBuffer 的底层内存（mark 成 detached，byteLength 变 0）。

**修复**：用 **Blob** 替代。
- Blob 是浏览器原生二进制封装，V8 不会 detach 它的底层内存
- 存模块级 `Map<string, Blob>` 绕过 React 状态
- 位置：`src/scanner/assetScanner.ts` 的 `prefetchedFileData`

**教训**：任何需要跨函数/跨异步调用保持的二进制数据，都用 Blob 或把 Blob 持久化到 IndexedDB，不要信任 ArrayBuffer/Uint8Array 的生命周期。

## 2. Chrome File System Access API 的 race condition

**现象**：快照恢复时，`getDirectoryHandle` 偶尔抛 `NotFoundError`，文件没写回去。

**根因**：FileHandle 和 DirectoryHandle 有时效性。如果多个异步操作同时在同一个目录上调用 `getDirectoryHandle`，或者 handle 在一次写操作后过期，Chrome 会抛异常。

**修复**：`prefetchDirs()` 预热所有需要的目录 handle 并存到 Map，后续直接从 Map 取，不重复创建。

另一个常见问题：`prefetchDirs(src, dst, paths)` 的参数顺序**绝对不能搞反**：
- `src` = 快照目录（读文件）
- `dst` = 游戏根目录（写文件）

之前搞反了，文件被写进了快照目录而不是游戏目录 → "恢复后文件在哪？" 的困惑。

## 3. Chrome FSA API 写文件极慢

**现象**：删除 91 个文件后恢复等了好几秒。

**根因**：Chrome FSA API 写**单个小文件**的启动开销约 30ms（内核层 + 用户态 + V8 调度），不管文件多小。N 个文件就是 N×30ms。

**修复**：`BatchBlobWriter` 把 N 个文件合并写进一个 `deleted.blobs` 文件，附带 `offsets.json` 记录每个文件的偏移和长度。N 个文件变成 **1 次写**。

**实测**：113 个文件从 10s → 235ms（40× 加速）。恢复时同样从 `deleted.blobs` 切片写回原路径。

## 4. 文件名污染编码评分

**现象**：把中文游戏判成 Shift_JIS。

**根因**：把 `titleName`、`systemName`、`characterName`、`faceName` 等**素材文件名**（如 `title1.png`、`charset_masuo.png`）喂给 `scoreEncoding`。文件名可能全是 ASCII（`.png`），不提供任何编码信号。更糟糕的是，之前有人误把这些字段当成 display text。

**修复**：`splitDbRefs` 严格按 RPGRewriter 分类：
- 所有 `*Name` / `*Graphic` / `*File` 中如果是素材引用的 → `fileRefs`
- 只有 `S_TOTRANSLATE`（显示文本）和 `S_UNTRANSLATED`（编辑器名）→ `displayTexts`

详见 `doc/lcf-format.md` 的字段分类表。

## 5. 只看 RPG_RT.ldb → 样本太少

**现象**：DB 只有 2 个 name 字段的游戏，编码判断不准（`ダークネスⅠを救うksgアナザー`）。

**根因**：RPG_RT.ldb 存的是角色/道具/技能/敌人的 name 字段。小 demo 或几乎没有道具的游戏，DB 里可能只有几行。而真正的游戏文本在 `.lmu` 的 EventCommand 里。

**修复**：`detectEncoding(iniBuf, ldbBuf, engine, lmuBufs[])` 额外接受所有 .lmu 的原始字节，用候选编码解码后抽含中日韩字符的片段，合并进 displayTexts 统一评分。

## 6. 中文/日文混杂时简单比例比较会错

**现象**：GBK 字节被 Shift_JIS 错解时恰好落入半角片假名区 → 假阳性。

**根因**：Shift_JIS 的双字节序列范围宽（首字节 0x81-0x9F 0xE0-0xEF，次字节 0x40-0xEF），GBK 字节落入这个范围时会被"合法"解码成假汉字或假假名。反之 GBK 的双字节序列范围也类似。

**修复**：引入**字符质量**维度（`scoreCharStats`）：
- 真中文解出来 → 大量**常用汉字**（commonRatio ≥ 0.3）
- 假中文（GBK 错解 SJIS）→ 汉字多但全是**生僻字**（commonRatio < 0.2）
- 真日文 → **全角假名**为主
- 假日文 → **半角片假名** ≥ 60%

评分时用互斥逻辑：zhPattern 必须 commonRatio ≥ 0.3，jaPattern 必须 halfKanaRatio < 0.6。不满足就触发惩罚分。

## 7. Windows 终端 race condition bug

**现象**：
- `sed -n 'X,Yp' file` 偶尔输出空（但 `cat` 或 `Get-Content` 能正常读）
- 同一个命令第二次跑就好了
- `ls` / `Get-ChildItem` 偶尔只返回部分文件

**根因**：疑似是我们用的终端（IDE 内置 terminal）在高并发或快速连续命令下有 race condition，或者文件句柄释放延迟。**这不是代码 bug**，是终端环境问题。

**应对**：
1. 遇到异常输出空的情况，先用 PowerShell 原生命令或 `cat` / `Select-String` 再试一次
2. 不要花 30 分钟追代码——先排除终端问题
3. 写测试脚本用 tsx 直接跑，不要依赖 shell 工具处理文件内容

## 8. rm200x-material-manager 是浏览器端应用

**重要限制**：
- 所有 IO 都走 **Chrome File System Access API**（`FileSystemDirectoryHandle`, `FileSystemFileHandle`）
- 不能直接用 Node.js `fs` 模块（只在测试脚本里用，浏览器里不行）
- 游戏目录必须在 Chrome 权限范围内（用户通过"选择文件夹"授权）
- 写入是通过 `FileSystemWritableFileStream`，有锁机制——同一文件不能同时写

## 9. 恢复时要不要重载项目数据？

**当前做法**：快照恢复成功后会触发全量 reload（重新 decodeDatabase + 扫引用追踪）。

**为什么**：如果恢复的是 RPG_RT.ldb（改了角色名），必须重新解码才能显示新名字。但如果只恢复了素材文件（没改 DB），理论上可以只更新 assetScanner 结果，跳过 DB 解码和引用追踪。

**待优化**：增量恢复——快照记录了哪些文件被恢复，如果全部在素材目录（非 .ldb/.lmt/.lmu/.ini），就只增量更新 assetScanner 结果。
