# Reelfs 代码审计报告

- 审计日期：2026-09-29
- 对应基线提交：`a7a3a90 feat: support ratings for video groups`
- 实施日期：2026-09-29（同一天完成 P1 与部分 P2，见第三、四节状态标记）
- 实施后验证：`cargo fmt --check` 通过、`cargo clippy --all-targets -- -D warnings` 通过、`cargo test` 7 passed、`npm run typecheck` 通过、`npm run build` 通过
- 范围：运行时正确性、性能、并发、内存、工程化、依赖与文档

> 本报告区分三类结论：
>
> - **已确认**：能从代码直接证明。
> - **风险/待实测**：代码结构存在风险，但尚未用性能数据或复现步骤证实。
> - **升级决策**：不是缺陷，是否实施取决于维护计划。

---

## 一、结论速览

当前没有证据支持“必然数据丢失、必然崩溃”的 P0 结论。优先处理 5 个 P1 项目：

| 优先级 | 问题 | 性质 | 状态 |
|---|---|---|---|
| P1-1 | 修改 NAS 路径后 watcher 不会更新 | 已确认的功能问题 | ✅ 已修复 |
| P1-2 | 全量扫描可长时间持有主数据库 Mutex | 已确认的响应性问题 | ✅ 已修复 |
| P1-3 | Blob 缩略图缓存无上限且从未清理 | 已确认的内存风险 | ✅ 已修复 |
| P1-4 | 部分 async 命令直接执行同步数据库/文件操作 | 已确认的设计问题 | ✅ 已修复（热点命令） |
| P1-5 | 无 CI、无 lint、仅 1 个 Rust 测试 | 已确认的维护风险 | ✅ 已修复（lint 未加） |
| P1-6 | 启用外键后旧数据孤儿行变成硬错误 | 已确认机制，自动化测试已覆盖 | ✅ 代码路径已验证，真实库待查 |

推荐顺序：**P1-1 → P1-5（CI 与测试）→ P1-2 → P1-3 → P1-4（先测量）→ P1-6**。

> 修订（2026-09-29 复盘）：CI 从第 7 位提到第 2 位。项目只有 1 个测试，而 P1-2 要改事务与锁模型，属于高风险重构；P1-4 的埋点需要在改 P1-2 之前完成，才能拿到锁等待的前后对比数据。
>
> 关于 P1-4：实施时没有先做埋点，而是直接修了代码上可证明阻塞的命令（见 2.5）。待实测的部分改为“用 CI 守住行为 + 后续用真实库测耗时”。

---

## 二、本轮已完成

### ✅ 1. 补充项目名称含义

`package.json` 的 description 已从：

```text
NAS Local Movie Browser
```

改为：

```text
Reel + fs - a filesystem-aware movie browser for NAS libraries
```

### ✅ 2. 为每个 SQLite 连接配置并发与外键选项

位置：`src-tauri/src/database.rs` 的 `Database::new`。

已加入：

```rust
conn.busy_timeout(std::time::Duration::from_secs(10))?;
conn.pragma_update(None, "journal_mode", "WAL")?;
conn.pragma_update(None, "synchronous", "NORMAL")?;
conn.pragma_update(None, "foreign_keys", "ON")?;
```

#### 为什么合理

静态代码中能确认两个主要 SQLite 连接：

1. 主应用连接：`src-tauri/src/main.rs:1132` 附近创建，随后放入 `Arc<Mutex<Database>>`。
2. watcher 连接：`src-tauri/src/watcher.rs:58` 独立创建。

`ImportManager` 不是第三个连接；它通过 `Arc::clone(&self.db)` 共享主应用连接。

配置收益：

- `WAL`：允许读请求与写事务更好地并行；SQLite 仍然只允许一个 writer。
- `busy_timeout`：发生锁竞争时最多等待 10 秒，而不是立即返回 `SQLITE_BUSY`。
- `foreign_keys=ON`：使 schema 中的 `ON DELETE CASCADE` 真正生效。
- `synchronous=NORMAL`：在 WAL 模式下平衡性能与持久性。

#### 运行时验证结果（已完成）

原来的“待验证”已落地为自动化测试 `database::tests::pragmas_are_applied_at_open`，并单独用一个临时工程做了跨连接验证。实测值：

| 项 | 实测 |
|---|---|
| `journal_mode` | `wal` |
| `busy_timeout` | `10000` |
| `foreign_keys` | `1` |
| `synchronous` | `1` (NORMAL) |
| 第二个连接 | 同样读到 `journal_mode=wal`（WAL 是持久属性） |
| 级联删除 | 删 `movies` 行后 `play_history` 行归 0 |

仍不能证明的部分：真实 NAS 环境下“扫描 + watcher 写入 + UI 查询”并发时无 `database is locked`，这需要实际片库运行。

### ✅ 3. watcher 变成可停止、可重启，并跟配置同步（P1-1）

- `watcher.rs`：`start_watcher` 改为返回 `WatcherHandle`（持有 notify watcher、关闭标志与线程 handle），新增 `stop()` 与 `Drop`。
- `main.rs`：`AppState` 新增 `watcher` 字段；新增 `sync_watcher_with_config()`，比较新旧 `nas_paths`，变化时停旧建新。
- `update_config` 保存后调用该函数；启动时也把初始 handle 存入 `AppState`。
- 效果：运行时增删 NAS 路径立即生效，不再需要重启应用。

### ✅ 4. 全量扫描的元数据更新改为分批 + 可中断（P1-2）

- `database.rs`：新增 `batch_update_movie_metadata()`（单事务写一批）与 `MovieUpdateRow` 类型。
- `import_manager.rs`：原来的“持锁遍历全部已有记录”改为每 200 条一批，每批结束后释放 Mutex，并在批次间检查 `stop_requested()`、调用 `emit_progress_throttled()` 上报进度。
- 效果：最长锁持有时间从“整个片库”降到一个批次；该阶段的“停止扫描”生效；进度条不再冻结。

### ✅ 5. 重命令移出 async worker（P1-4）

- `main.rs`：新增 `db_blocking()`（`spawn_blocking` + 锁错误/rusqlite 错误统一转 `String`，修掉了上一版审计里那段无法编译的示例）。
- 已改写：`get_movies`、`get_movie_detail`、`search_movies`、`get_movies_filtered`、`get_unique_genres`、`get_unique_actors`、`get_actors_with_counts`、`get_video_groups`、`get_video_group_detail`、`set_watched_status`、`update_play_progress`、`delete_invalid_records`、`clear_cache`、`get_stats`、`play_movie`。
- 文件系统部分（`get_stats` 的目录统计、`clear_cache` 的删除、播放器进程创建）也进了 `spawn_blocking`。
- 未改动的命令保持原样，因为都是短操作：`get_config`、`stop_scan`、`get_scan_status` 等。

### ✅ 6. 缩略图缓存加上限、引用计数与失效（P1-3）

- `thumbnailCache.ts`：改为有上限 LRU（`MAX_ENTRIES = 400`），新增 `acquireThumbnail` / `releaseThumbnail` 引用计数，淘汰时跳过在用条目并 `URL.revokeObjectURL`。
- 新增 `invalidateThumbnail` / `invalidateAllThumbnails` / `getThumbnailCacheStats`。
- 接入组件：`MovieCard`、`MovieList`、`ActorCard`、`MovieDetail`、`VideoGroupDetail` 在挂载时 pin、卸载时 release。
- `thumbnailGenQueue.ts`：生成后改为 `acquireThumbnail`，回调多传一个 `thumbnailPath`，调用方可 pin。
- `Settings.tsx`：重新生成缩略图后调用 `invalidateAllThumbnails()`。
  - 原因：重新生成是原地覆盖 `{cache}/thumbnails/{id}.jpg`，路径不变，不清理缓存会继续显示旧图。

### ✅ 7. 修好了唯一一个历史测试（P1-5）

历史测试 `test_detect_groups` 在基线代码上就是红的（用 `git stash` 验证过）。原因不是测试写错，而是真功能缺口：检测器匹配不了 `电影名称 [上集]` 这种最常见命名（`[上中下]` 后只允许分隔符，不允许 `集/部`）。

- 正则扩展：`[上中下]` 后允许可选的 `集/部`（限模式 0 与 5）。
- 新增模式：末尾形式的 `... 第N集/部`（原来要求 `第N集` 后必须还有分隔符）。

### ✅ 8. 日志降噪（P2-1）

- 请求级日志从 `info!` 降为 `debug!`：`get_movies`、`search_movies`、`get_movies_filtered`、`get_unique_*`、`get_actors_with_counts`、`get_video_groups`、`get_video_group_detail`、`get_and_update_video_info`、`update_thumbnail_path`。
- 删除了 `get_movies` 里记录“第一部电影全部字段”的日志。
- 每个电影一条的元数据更新日志也降为 `debug!`（批量路径下原来会刷满日志）。

### ✅ 9. genres/actors 去重改为集合（P2-2）

`get_unique_genres` / `get_unique_actors` 由 `Vec::contains` 改为 `HashSet` 去重后再排序（`database.rs`）。

### ✅ 10. CI、npm scripts、测试（P1-5）

- 新增 `.github/workflows/ci.yml`：前端 `npm ci` + `typecheck` + `build`；Rust `fmt --check` + `clippy --all-targets -- -D warnings` + `test`，并安装 Tauri 所需系统依赖（v2 起为 `libwebkit2gtk-4.1-dev`）。
- `package.json` 新增 `typecheck`、`test:rust`、`lint:rust`。
- 测试从 1 个增到 7 个，全部为临时数据库上的集成测试，覆盖：PRAGMA 生效、外键级联删除、genres/actors 去重与排序、NFC/NFD 合并与依赖重绑、删视频组无外键违规、`migrate_path_nfc` 在 1 万行上的耗时。

### ✅ 11. Unicode 路径迁移的启动成本已量化（P2-6）

测试 `nfc_migration_cost_on_large_library` 实测：**1 万行重新打开数据库（含全表读取 + 归一化 + HashMap 构建）约 200ms（debug 构建）**，且每次启动对主连接与 watcher 连接各跑一次。

结论：**先不改逻辑**。200ms 在 debug 下可接受，release 下会更低；`migrate_path_nfc` 的“每次启动都跑”是有意的安全网（防外部写入造成 NFD/NFC 重复行）。代码里那句“Gated by `PRAGMA user_version`”与实际不符，属于注释错误而非功能缺失 —— 已在 `database.rs` 的注释中改正。

### ✅ 12. 清理与元数据（M-1 / M-2 / P2-5）

- 删除 `env_logger` 依赖（`Cargo.toml` 零引用，实际用 `log4rs`）。
- `Cargo.toml` 的 `authors` 从 `["you"]` 改为实际作者。
- 删除根目录两个 0 字节文件 `reelfs@0.1.0`、`tauri`；`.gitignore` 改为锚定的 `/reelfs@*` 与 `/tauri`，避免误伤真实目录。
- `license` 与 `repository` 保持为空：仓库没有配置 remote，License 是发布决策，不应由审计替用户决定。

---

## 三、P1 — 优先修复

### P1-1 修改 NAS 路径后 watcher 不会更新

**状态：已修复（见 2.3）。保留原分析如下。**

**结论：已确认。**

证据：

- watcher 只在启动阶段创建：`src-tauri/src/main.rs:1144`。
- `update_config` 位于 `src-tauri/src/main.rs:316`，只负责写入 `config.json` 并替换内存配置。
- `AppState` 没有保存 watcher handle、停止通道或重启能力。
- `watcher::start_watcher` 启动 detached thread 后仅返回 `Result<()>`。

影响：

- 用户运行时添加 NAS 路径后，扫描可以读取新配置，但 watcher 仍只监听启动时的旧路径。
- 用户删除路径后，旧目录仍可能继续产生监听事件。
- 当前需要重启应用才能让监听范围与配置一致，UI 和文档没有明确提示。

建议：

1. 把 watcher 封装为可停止的 `WatcherManager`。
2. 在 `AppState` 保存停止通道和线程 handle。
3. `update_config` 比较新旧 `nas_paths`；变化时停止旧 watcher，再按新路径启动。
4. 短期方案：保存配置后明确提示“重启应用以更新文件监听”。

预估：短期提示 10 分钟；完整 watcher 生命周期管理 1～2 小时。

### P1-2 全量扫描可长时间持有主数据库 Mutex

**状态：已修复（见 2.4）。**

**结论：已确认；实际卡顿程度需实测。**

关键证据：`src-tauri/src/import_manager.rs:537` 附近。

```rust
let db = self.db.lock_recover();
for (...) in &existing_updates {
    db.update_movie_metadata(...)
}
```

全量扫描时，代码会在整个 `existing_updates` 循环期间持有主数据库 Mutex。若片库有 10,000 条已有记录，UI 中所有使用同一 `state.db` 的查询都会等待该循环完成。

需要注意：

- 文件解析部分使用 rayon 并行，且没有持有 DB 锁，设计合理。
- 新记录按 100 条批量插入并在批次间释放锁，也较合理。
- 问题集中在已有记录更新阶段，共三个缺陷：
  1. 长时间持锁 + 逐条 SQL 更新。
  2. 循环内没有 `stop_requested()` 检查 → 该阶段点“停止扫描”无效。
  3. 循环内不发进度事件 → 进度条在耗时最长的阶段冻结。
- 仓库内已有正确范式可复用：`probe_and_update_video_info`（`import_manager.rs:570` 起）短锁取数 → 锁外并行探测 → 分批写回。

建议（推荐顺序）：

1. 增加 `batch_update_movie_metadata`，每 100～500 条开一次事务。
2. 每个批次结束后释放 Mutex，让 UI 查询获得执行机会。
3. 每批之间检查 `stop_requested()`，并调用 `emit_progress_throttled()` 更新进度。
4. 中期让导入线程使用独立 SQLite 连接；配合 WAL，UI 读取不需要等待同一 Rust Mutex。
5. 记录每批耗时和最长锁持有时间，再决定是否需要连接池。

不要简单改成 `tokio::sync::Mutex`：它不会让同步 SQLite 变成非阻塞，也不能解决长临界区。

预估：批量事务 + 分段释放锁约 1～2 小时。

### P1-3 Blob 缩略图缓存无上限且从未清理

**状态：已修复（见 2.6）。**

**结论：已确认。**

证据：

- `src/lib/thumbnailCache.ts:8` 使用全局 `Map<string, string>` 保存所有 Blob URL。
- 每次加载图片都会 `URL.createObjectURL(blob)` 并永久放入 Map。
- `clearThumbnailCache()` 位于 `thumbnailCache.ts:99`，但项目中没有调用者。
- 首页、列表、演员卡片和详情页都会使用该缓存。

影响：

- 浏览的电影越多，Renderer 进程持有的图片 Blob 越多。
- 项目标称支持 10,000+ 电影；若每张缩略图为几十 KB，长期浏览可能占用数百 MB。
- 后端清理磁盘缓存时，前端旧 Blob URL 仍可能继续显示，直到进程退出。

实现时必须额外处理两点：

- 缓存 key 是 `thumbnail_path`，而该路径固定为 `{cache}/thumbnails/{id}.jpg`。`regenerate_all_thumbnails` 会原地覆盖同一路径 → 路径不变、缓存不失效，前端继续显示旧图。重新生成后必须清理对应 key。
- LRU 淘汰时若 revoke 正在渲染的 `<img>` 引用的 URL，会出现破图。淘汰需要跳过在用 URL（引用计数或“当前可见 key”集合）。

建议：

1. 改成有上限的 LRU 缓存，例如先从 300～500 项开始实测。
2. 淘汰缓存项时调用 `URL.revokeObjectURL(url)`，但跳过在用 URL。
3. 后端“清理缓存”和“重新生成缩略图”成功后同步调用 `clearThumbnailCache()`。
4. 应用退出/页面刷新前统一 revoke。
5. 记录 cache hit、miss、entry count，确认上限是否合适。

预估：45～90 分钟。

### P1-4 部分 async 命令直接运行同步操作

**状态：热点命令已修复（见 2.5）；剩余的短命令保持原样。**

**结论：存在设计风险，但原报告的严重程度被高估。**

事实：

- `src-tauri/src/main.rs` 有 34 个 `#[tauri::command] async fn`。
- 只有图片处理和视频信息探测等少数路径使用了 `tokio::task::spawn_blocking`。
- 多个命令在 async 上下文中直接运行同步 rusqlite、文件系统或进程启动操作。

不应写成：

- “一次查询会阻塞整个 Tokio 运行时”——通常只会占用当前 worker，具体影响取决于运行时配置和任务持续时间。
- “必然导致窗口白屏”——UI 事件循环与 Tokio worker 不是同一概念，必须用实测证明。
- “当前存在跨 await 持锁死锁”——目前主要 DB 临界区内没有 `.await`，不能据此判定已有死锁。

应优先测量这些命令：

1. `get_movies_filtered` / 搜索：大库复杂 SQL。
2. `get_unique_actors`：全表读取、字符串拆分与去重。
3. `delete_invalid_records`：持锁期间对每个 NAS 路径调用 `Path::exists()`。
4. `get_stats` / `clear_cache`：同步文件系统遍历或删除。
5. `play_movie` / `show_in_file_manager`：同步进程创建，通常较短，但应避免持 DB 锁到进程启动阶段。

建议：

- 不要机械地改完全部 34 个命令。
- 先为命令记录耗时；超过约 16～50ms 或包含 NAS I/O 的操作移入 `spawn_blocking`。
- 保留 `std::sync::Mutex` 并在 blocking 线程中使用，或改成专用数据库 worker/连接池。
- 若实现统一 helper，必须统一 `Mutex`、rusqlite 和 JoinError 的错误类型；原报告中的 `db_call` 示例错误类型不一致，不能直接编译。

预估：埋点 30 分钟；按结果修热点约 1～3 小时。

### P1-5 无 CI、无 lint、测试基线不足

**状态：CI、scripts、测试已加入（见 2.10）；前端 ESLint 仍未加入，原因见下。**

**结论：已确认。**

证据：

- 无 `.github/workflows/`。
- Rust 全项目只有 1 个 `#[test]`：`src-tauri/src/video_group_detector.rs:191`。
- `package.json` 没有 `lint`、`test`、`typecheck` script。
- 没有 ESLint/Prettier 配置。

成本实测（2026-09-29）：

- `cargo fmt --check` 已经干净，不需要先格式化一遍。
- `cargo clippy` 全项目只剩 2 个警告 → 可以直接启用 `-D warnings`。

建议：

1. 加 npm scripts：`typecheck`、`lint`、`test`。
2. CI 执行 `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test`、`npm run typecheck`、`npm run build`。
3. Linux 侧 CI 需要 webkit2gtk 等 Tauri 系统依赖，预算时不能漏掉这一步。
4. 优先测试纯函数：文件名标题提取、NFO 解析、LIKE 转义、路径 NFC 归一化、视频组检测。
5. 给 SQLite migration、FTS trigger、级联删除和 watcher rename 匹配增加临时数据库测试。

预估：基础 CI 30～60 分钟；首批单测 1～2 小时。

### P1-6 启用外键后，旧数据库里的孤儿行会变成硬错误

**状态：代码侧删除路径已用集成测试覆盖（见 2.4 与 2.10 的 `deleting_video_group_leaves_no_foreign_key_violations`）；真实片库仍需手动跑一次 `foreign_key_check`。**

**结论：机制已确认，实际影响待用真实数据库验证。**

- schema 中 `movies.group_id REFERENCES video_groups(id)` 没有 `ON DELETE` 子句（默认 `NO ACTION`），只有 `video_parts` 是 `ON DELETE CASCADE`。
- `delete_video_group`（`video_group.rs:364`）只把「出现在 `video_parts` 里」的电影 `group_id` 置空。若某电影的 `group_id` 指向该组、但该电影不在 `video_parts` 中，`DELETE FROM video_groups` 会因外键约束失败。
- 已验证安全的两处：`clear_all_movies`（`database.rs:1408`）先删 `movies`，顺序对外键友好；`migrate_path_nfc` 删除重复行前会重绑 `play_history` 与 `video_parts`。

验证步骤：

1. 复制一份真实 `movies.db`。
2. 执行 `PRAGMA foreign_key_check;`，确认是否存在孤儿行。
3. 若有孤儿，先写一次性清理逻辑，再用 CI 集成测试长期守住删除路径。

---

## 四、P2 — 次优先改进

### P2-1 Info 日志位于请求热路径

**状态：已修复（见 2.8）。**

**结论：日志偏多成立；“无轮转、无限增长”不成立。**

现状：

- `src-tauri/src/main.rs:1088-1100` 已配置 `RollingFileAppender`。
- 单文件上限 10MB，保留 5 个历史文件；总量大约上限为当前文件加 5 个历史文件。
- 默认日志级别为 `Info`：`main.rs:1109`。
- `get_movies` 等高频命令每次请求会记录调用、结果数量，有时还记录第一条记录。
- 前端 `logger.info` 也会通过 `frontend_log` 转发到后端日志。

建议：

- 请求开始/结果数量改为 `debug!`。
- 保留启动、扫描阶段变化、错误和关键配置变更为 `info!`。
- 删除 `get_movies` 中“第一部电影”的日志。
- 增加模块级日志配置；开发环境 Info，发布环境 Warn/Info 可选。

预估：20～30 分钟。

### P2-2 genres/actors 去重算法可优化

**状态：已修复（见 2.9）。**

**结论：已确认存在 O(tokens × unique_values) 的线性去重；优先级应低于运行时功能问题。**

位置：

- `src-tauri/src/database.rs:1301` `get_unique_genres`
- `src-tauri/src/database.rs:1329` `get_unique_actors`

代码使用 `Vec::contains` 去重。类型通常只有几十个，影响较小；演员可能有数千个，成本更明显。筛选栏首次加载时会调用这两个接口。

建议：使用 `HashSet<String>` 或 `BTreeSet<String>`，最后排序输出。

预估：15 分钟。

### P2-3 CSP 关闭

**状态：未实施。** 启用 CSP 需要实际启动应用验证 Blob 图片、Tauri FS 协议与本地资源加载，审计环境不具备 GUI 回归条件。盲加策略会把可用的图片加载改成白屏，不建议在没跑过应用的情况下改。

**结论：配置事实成立；风险理由需保持克制。**

- `src-tauri/tauri.conf.json:48` 为 `"csp": null`。
- React 默认会转义文本；项目中未发现 `dangerouslySetInnerHTML`、直接 `innerHTML` 或 `eval`。
- 因此，NFO 标题/剧情本身目前不是明确的 XSS 路径。

CSP 仍是合理的纵深防御，但启用前需要验证 Blob 图片、Tauri FS API 和本地资源协议。不要直接粘贴未经运行验证的策略。

预估：配置和功能回归测试约 30～60 分钟。

### P2-4 TypeScript 存在局部 `any`

**状态：未实施**，与虚拟列表升级一起做更划算（回调签名会一起变）。

静态搜索得到 12 处 `: any` / `as any` / `@ts-ignore` 匹配，主要集中在：

- `MovieGrid.tsx`
- `MovieList.tsx`
- `ActorGrid.tsx`
- `FilterSortBar.tsx`
- 日志可变参数

多数是第三方回调或通用日志参数，不是当前故障。建议在升级虚拟列表组件或修改筛选类型时同步收紧。

### P2-5 未使用依赖 `env_logger`

**状态：已修复（见 2.12）。**

`src-tauri/Cargo.toml` 声明 `env_logger = "0.11"`，但 `src-tauri/src/` 下零引用；实际使用 `log4rs`。移除后 `Cargo.lock` 同步更新。

预估：5 分钟。

### P2-6 每次启动都执行 Unicode 路径全表迁移，且注释描述的“门控”不存在

**状态：已量化并决定不改（见 2.11）。实测 1 万行 debug 构建约 200ms/次。**

- `database.rs:406` 注释写着 “Gated by `PRAGMA user_version`”，但全仓库检索不到 `user_version`（只有这句注释）→ 门控不存在。
- `migrate_path_nfc` 由 `init_schema` 调用，因此**每次创建连接都会执行**：`SELECT id, file_path FROM movies` 全表读取 + HashMap 构建 + 可能的写入，全部在一个事务内。
- 主连接与 watcher 连接各执行一次，即每次启动至少两遍。

建议：要么真正用 `user_version` 做一次性门控，要么先测启动耗时再决定。10,000 条量级下影响可能很小，不要把结论说死。

预估：测量 10 分钟；门控 20 分钟。

---

## 五、低优先级维护项

### M-1 Cargo 包元数据不完整

**状态：部分处理。** `authors` 已从 `["you"]` 改为实际作者；`license`、`repository` 保持为空（仓库无 remote，License 属发布决策）。

若计划公开分发，应填写真实仓库地址和许可证。没有 LICENSE 不代表软件不能运行，而是默认保留全部权利。

### M-2 工作区存在两个本地空文件

**状态：已处理。** 两个 0 字节文件（`reelfs@0.1.0`、`tauri`）已删除，`.gitignore` 规则已改为锚定的 `/reelfs@*` 与 `/tauri`，避免匹配子目录里的同名真实目录。

### M-3 文档存在重叠

当前 `doc/` 有 9 个 Markdown 文件，约 90KB；其中原有文档 8 个，约 78KB，新增文件是本审计报告。

Tauri v1 相关说明仍出现在 `DEVELOPMENT.md`、`OPERATIONS.md`、`DOCUMENTATION_REPORT.md`。在决定是否迁移 Tauri v2 后，再统一文档，避免先改一遍、迁移后再改一遍。

建议最终保留：

1. `ARCHITECTURE.md`
2. `DEVELOPMENT.md`
3. `OPERATIONS.md`
4. `AUDIT.md`（完成后可归档）

---

## 六、升级决策（不是缺陷）

### D-1 Tauri v1 → v2 ✅ 已完成

迁移原因（Linux 实测）：

- nixpkgs 26.11 已移除 `webkitgtk_4_0`（WebKitGTK 上游删除 4.0 API），而 Tauri 1.x 的 `webkit2gtk-rs 0.18` 只认 `webkit2gtk-4.0`。
- 为编译 v1 只能钉 `nixos-24.11`，其 mesa/glvnd（24.2.8）与系统 mesa（26.2.3）混用后，WebKit 无法创建 EGL display（`EGL_BAD_PARAMETER`），窗口空白、dev server 收不到任何请求。
- Tauri v2 使用 `webkit2gtk-4.1`，与当前系统图形栈完全一致。

迁移内容：

- `tauri`/`tauri-build` 1.x → 2.x；`allowlist` 改为 `capabilities/default.json`（`fs:scope` 沿用 `$HOME/.reelfs/**`、`/Volumes/**`、`/mnt/**`）。
- 不再需要 `shell-open`（打开文件走 Rust `std::process::Command`），移除 `tauri-plugin-shell`。
- 前端：`@tauri-apps/api` v2（`invoke` 改从 `@tauri-apps/api/core`），`readBinaryFile` → 插件 `readFile`（`@tauri-apps/plugin-fs`），`dialog.open` 走 `@tauri-apps/plugin-dialog`。
- Rust：`tauri::Window` → `tauri::WebviewWindow`，`.emit()` 需 `use tauri::Emitter`。

验证：`cargo test` 7 passed、`npm run typecheck`、`npm run build` 均通过；Linux 上首次正常渲染（dev server 收到 83 个请求，前端输出 `[MovieStore]` 日志）。CI 的 Rust job 已改回 `ubuntu-latest` + `libwebkit2gtk-4.1-dev`。

### D-2 react-window 1 → 2 或 TanStack Virtual

版本事实：

- 当前锁定 `react-window 1.8.11`。
- `react-window` 仍存在新版本；“上游已归档并官方要求迁移到 TanStack Virtual”的旧结论不准确。

可选方案：

1. 保留 1.8：最低风险，先修业务问题。
2. 升级 react-window 2：继续使用同一项目，但需要适配新 API。
3. 换 TanStack Virtual：能力更灵活，迁移和回归成本更高。

该项应基于现有虚拟列表是否有实际 bug、维护需求和性能数据决定，不应与 Tauri v2 绑定为一次大改。

---

## 七、审计与实施限制

本次主要是静态阅读、编译检查和临时数据库测试，没有完成以下验证（这些不是“已排除”，而是“未验证”）：

- 10,000 部影片真实数据库基准测试（仅覆盖了 1 万行空记录的迁移耗时）。
- NAS 高延迟、断连、重连测试。
- watcher 在 macOS/Linux 上的事件差异测试（新的 `WatcherHandle` 停止/重启逻辑未在真实文件事件下跑过）。
- SQLite 锁竞争和崩溃恢复测试。
- CSP 启用后的完整 UI 回归（因此未改 CSP）。
- 内存 profiling 和 Blob 缓存峰值测量（LRU 上限 400 是估算，未实测）。
- SQL fuzzing、安全渗透测试。

因此，不能仅凭 grep 结果断言“绝对不存在 SQL 注入或命令注入”。当前抽查到的查询主要使用参数绑定，进程调用主要使用 `Command::arg`，未发现明显字符串拼接执行，但这只是有限静态检查。

另外，本轮改动**未经 GUI 手测**：`cargo test` 7 项通过、`clippy -D warnings` 通过、`tsc` 与 `vite build` 通过，但“扫描大库时 UI 是否真的不卡”“增删 NAS 路径后监听是否真的生效”需要你实际跑一次应用确认。

---

## 八、跟踪清单

| # | 项目 | 类型 | 预估 | 状态 |
|---|---|---|---|---|
| 1 | package description | 维护 | 1 分钟 | ✅ 已完成 |
| 2 | SQLite WAL / busy timeout / foreign keys | 稳定性 | 10 分钟 | ✅ 完成，已由测试 `pragmas_are_applied_at_open` 守住 |
| 3 | 配置变化后重启 watcher | P1 | ~2 小时 | ✅ 完成（`WatcherHandle` + `sync_watcher_with_config`），待 GUI 验证 |
| 4 | 全量更新改分批事务 + 停止响应 + 进度 | P1 | ~1 小时 | ✅ 完成（每批 200 条） |
| 5 | 缩略图 Blob 缓存 LRU + 重生成失效 + revoke 保护 | P1 | ~1 小时 | ✅ 完成（上限 400 + 引用计数） |
| 6 | 慢命令改用 spawn_blocking | P1 | ~2 小时 | ✅ 完成 15 个热点命令（未做埋点，按代码可证明的阻塞直接修） |
| 7 | CI + Rust 测试（fmt/clippy/test） | P1 | ~1 小时 | ✅ 完成（7 个测试全绿） |
| 8 | 前端 ESLint | P1 | 2～4 小时 | ⬜ 未做：11k 行代码无基线，需先跑一遍存量告警再启用 |
| 9 | 降低热路径日志级别 | P2 | 20 分钟 | ✅ 完成 |
| 10 | actors/genres 使用 Set 去重 | P2 | 15 分钟 | ✅ 完成 |
| 11 | CSP 策略及回归测试 | P2 | 30～60 分钟 | ⬜ 未做：需启动应用验证 Blob/FS 协议 |
| 12 | Unicode 迁移耗时量化（原 user_version 注释问题） | P2 | 20 分钟 | ✅ 完成：1 万行约 200ms（debug），保持不改 |
| 13 | 删除 env_logger、Cargo 元数据、空文件、.gitignore | 维护 | 20 分钟 | ✅ 完成（license/repository 保留为空） |
| 14 | 修好历史失败测试 `test_detect_groups` | 维护 | 30 分钟 | ✅ 完成（顺带修复 `[上集]` 匹配缺口，正则新增 1 条、扩展 2 条） |
| 15 | 真实片库跑一次 `PRAGMA foreign_key_check` | P1 | 10 分钟 | ⬜ 需你本地执行（代码路径已用测试覆盖） |
| 16 | Tauri v2 迁移 | 决策 | 1～2 天 | ✅ 完成（见 D-1） |
| 17 | 虚拟列表升级（react-window 2 或 TanStack Virtual） | 决策 | 4～8 小时 | ⬜ 待决策 |
| 18 | TypeScript `any` 收紧 | 维护 | 30 分钟 | ⬜ 与 #17 一起做 |
| 19 | 文档合并重写 | 维护 | 40 分钟 | ⬜ 建议等 Tauri v2 决策后 |
| 20 | 记录 Linux 构建约束（runner / webkit2gtk / wry） | 维护 | 15 分钟 | ✅ 完成，见第九节 |

### 本轮改动文件

- Rust：`src-tauri/src/{database,import_manager,main,watcher,video_group_detector}.rs`、`Cargo.toml`
- 前端：`src/lib/{thumbnailCache,thumbnailGenQueue}.ts`、`src/components/{MovieCard,MovieList,ActorCard}.tsx`、`src/pages/{MovieDetail,VideoGroupDetail,Settings}.tsx`
- 工程：`.github/workflows/ci.yml`、`package.json`、`.gitignore`、`doc/AUDIT.md`

### 下一步验证命令

```bash
cd src-tauri && cargo test          # 7 passed
npm run typecheck && npm run build
npm run tauri:dev                    # 手测：扫描大库时 UI 响应、增删 NAS 路径后监听是否立即生效
```

---

## 九、已知环境约束（Linux 构建）— 已随 Tauri v2 迁移失效

> **历史记录。** 以下三条只适用于 Tauri 1.x + `webkit2gtk 4.0`。迁移到 Tauri v2（`webkit2gtk-4.1`）后，`wry` 钉版本和 `ubuntu-22.04` 约束都不再需要，CI 已改用 `ubuntu-latest` + `libwebkit2gtk-4.1-dev`。保留本节是为了说明当初为何会有那些约束。

以下三条都由 CI 实测得出。本地 macOS 构建走 WKWebView，不会编译 `webkitgtk` 那段代码，**所以在 Mac 上永远是绿的，只有 Linux CI 能暴露问题**。任何一条被去掉都会让 CI 变红。

### 1. `wry` 必须钉在 `0.24.12` 或更高

`webkit2gtk 0.18.2` 把 `Settings` 的方法移进了 `SettingsExt` trait，而 `wry 0.24.11` 没有 import 这个 trait，于是 Tauri 1.8.x 在 Linux 上编译失败：

```
error[E0599]: no method named `set_enable_developer_extras` found for struct `webkit2gtk::Settings`
 --> wry-0.24.11/src/webview/webkitgtk/mod.rs:294
```

- 证据：CI run `36545781127` 失败；`wry 0.24.11` 源码里 `SettingsExt` 出现 0 次，`0.24.12` 出现 1 次（上游已修，且 tauri 的 `^0.24` 约束允许该版本）
- 处置：`cargo update -p wry --precise 0.24.12`，提交 `ab94c62`
- **`Cargo.lock` 必须入库**（当前已入库），否则下次解析会重新拿到坏版本

### 2. CI 的 Rust job 必须使用 `ubuntu-22.04`

Ubuntu 24.04 已移除 `libwebkit2gtk-4.0-dev`，`apt-get install` 直接失败（CI run `36543533870`）。处置见提交 `8d2ed89`。

### 3. 升级 Tauri 之前先看 Linux 结果

Tauri 1.x 与新版 `webkit2gtk` 的组合在 Linux 上很脆。今后改动 `tauri`、`wry`、`webkit2gtk` 或 `Cargo.lock` 时，必须以 Linux CI 结果为准，不能只凭本机 macOS 编译通过或 clippy 通过就认为没问题。
