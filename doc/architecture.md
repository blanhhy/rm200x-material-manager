# 架构

## 一句话总结

这是一个**浏览器端的 RPG Maker 2000/2003 素材管理器**。用户授权 Chrome 访问游戏目录后，我们用 File System Access API 直接操作磁盘，扫描素材、追踪哪些被游戏引用、删除未引用的素材，并在操作前创建完整快照支持撤销。

## 核心数据流

```
用户选游戏根目录 (FileSystemDirectoryHandle)
    │
    ├─► loadProjectGameData (lcfLoader.ts)
    │       ├─ decodeDatabase(rpg_rt.ldb)       → db 对象（编码待检测）
    │       ├─ detectEncoding(iniBuf, ldbBuf, engine, lmuBufs)  ← 扫 DB+所有 .lmu
    │       ├─ decodeTreeMap(rpg_rt.lmt)        → mapInfos（地图列表）
    │       ├─ decodeMapUnit(MapXXXX.lmu) × N   → 所有地图事件命令
    │       └─ 返回 GameData { db, maps, mapInfos, encoding, engine, raw* }
    │
    ├─► scanProjectAssets (scanner/assetScanner.ts)
    │       ├─ 遍历 Charset/, Chipset/, Music/, Sound/, Picture/, ...
    │       ├─ 预读每个文件到 prefetchedFileData (Map<string, Blob>)  ← Blob 防 GC
    │       └─ 返回 AssetFile[]（带 size, handle, path）
    │
    ├─► traceAllReferences (core/referenceTracker.ts)
    │       ├─ 从 db.system / db.actors / db.items / ... 抽所有 fileRefs 字符串
    │       ├─ 从所有 map 的 EventCommand 参数里抽文件名
    │       └─ 返回引用集合 Set<string>（归一化 stem，匹配磁盘文件名）
    │
    └─► 用户操作（删除/重命名）
            ├─ createSnapshot (snapshot.ts)
            │       ├─ 预读所有要删文件的 Blob（从 prefetchedFileData 取）
            │       ├─ BatchBlobWriter 把所有文件合并写进 deleted.blobs + offsets.json
            │       ├─ 更新 snapshots.jsonl 记录
            │       └─ 删原文件
            │
            └─ restoreSnapshot (snapshot.ts)
                    ├─ 读 deleted.blobs + offsets.json
                    ├─ prefetchDirs(snapDir, gameRoot, paths)
                    ├─ 按 offsets 切片写回原路径
                    └─ 从 snapshots.jsonl 移除该记录
```

## 模块职责

| 模块 | 做什么 | 依赖 |
|---|---|---|
| `lcfLoader.ts` | DB/LMT/LMU 解码 + 编码检测 | rpgrt, iconv-lite |
| `referenceTracker.ts` | 追踪哪些素材被游戏引用 | rpgrt（遍历 map events） |
| `snapshot.ts` | 快照创建/恢复/管理 | 无外部依赖，纯 FSA API |
| `deleteEngine.ts` | 组合 snapshot + 引用过滤 + 删文件 | snapshot, assetScanner.prefetchedFileData |
| `renameEngine.ts` | 重命名素材 + 更新所有引用 | rpgrt（改 DB/LMU 里的文件名参数） |
| `assetScanner.ts` | 扫素材目录 + Blob 缓存 | FSA API |

## 关键设计决策

### Blob 缓存（assetScanner.ts）
- 扫描时预读每个文件到 `prefetchedFileData: Map<string, Blob>`
- 必须用 **Blob** 而不是 ArrayBuffer/Uint8Array——Blob 是浏览器原生二进制封装，V8 GC 不会 detach 它的底层内存
- 存模块级 Map 绕过 React/Zustand 的状态序列化截断

### BatchBlobWriter（snapshot.ts）
- 把 N 个要删文件合并写进一个 `deleted.blobs` + `offsets.json`
- 为什么：Chrome FSA API 写单个小文件也很慢（~30ms 启动开销），合并后 N 个文件只做 1 次 write
- 实测：113 个文件从 10s → 235ms（**40× 加速**）

### prefetchDirs（snapshot.ts）
- 预热所有需要操作的目录 handle，缓存到 Map
- 避免每次 `getDirectoryHandle` 的 race condition（Chrome 偶尔因 handle 过期抛 NotFoundError）

### 编码推断策略
- **不要看文件名**（characterName/titleName 等）
- 同时扫 `RPG_RT.ldb` 的 name 字段 + 所有 `Map*.lmu` 的对话文本
- 详见 `encoding.md`
