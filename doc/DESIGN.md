```markdown
# NAS 本地电影浏览器设计方案（跨平台 macOS + NixOS）

> ✅ 跨平台（macOS + NixOS）  
> ✅ 影片规模非常大（1万+）  
> ✅ 电影为主  
> ✅ 本地播放器播放  
> ❌ 不做服务器 / 不做转码 / 不做用户系统  

---

# 一、技术选型结论

## ✅ 推荐：Tauri + Rust + SQLite

理由：

- 真正轻量（比 Electron 小很多）
- 原生文件访问能力强
- 跨平台支持好（macOS + Linux）
- 启动快
- 适合做高性能本地索引工具

Flutter 也可以，但桌面端文件系统能力和性能不如 Rust。

---

# 二、整体架构设计（适配大规模）

```

NAS (SMB 挂载)
↓
本地路径 (/Volumes/... or /mnt/...)
↓
Indexer (Rust)
↓
SQLite
↓
UI (Tauri)
↓
系统播放器

````

核心理念：

> 本地数据库索引 + 系统播放器启动器

---

# 三、数据库设计（SQLite）

## movies 表

```sql
CREATE TABLE movies (
    id INTEGER PRIMARY KEY,
    file_path TEXT UNIQUE,
    title TEXT,
    year INTEGER,
    plot TEXT,
    poster_path TEXT,
    fanart_path TEXT,
    added_at DATETIME,
    updated_at DATETIME
);
````

## 播放历史

```sql
CREATE TABLE play_history (
    movie_id INTEGER,
    last_position REAL,
    last_played DATETIME
);
```

## 索引优化

```sql
CREATE INDEX idx_title ON movies(title);
CREATE INDEX idx_year ON movies(year);
```

## 全文搜索（可选）

```sql
CREATE VIRTUAL TABLE movie_fts USING fts5(title, plot);
```

---

# 四、索引策略（大规模关键）

## ❌ 不能每次启动全量扫描

## ✅ 正确做法

### 1️⃣ 首次全量扫描

* 递归扫描目录
* 查找 `.nfo`
* 解析 XML
* 批量写入 SQLite（事务）

### 2️⃣ 后续增量更新

* Linux → inotify
* macOS → FSEvents
* 监听文件新增/删除
* 同步更新数据库

目标：

> 启动时间 < 300ms

---

# 五、UI 设计

## 首页

* 海报网格
* 虚拟滚动（react-window）
* 分页加载（每次 200 条）

⚠️ 必须使用虚拟列表，否则 1万条会卡。

---

## 详情页

* 大封面
* 简介
* 播放按钮
* 文件路径
* 播放进度

---

# 六、播放策略

## 不要内嵌播放器

直接调用系统默认播放器。

### macOS

```rust
Command::new("open")
```

### Linux

```rust
Command::new("xdg-open")
```

可选：

```bash
mpv --start=123.4 movie.mkv
```

实现“继续播放”。

---

# 七、缩略图缓存（必须）

如果 poster 原图 2MB：

1万部电影 = 20GB 读取

解决方案：

* 首次扫描生成 300px 缩略图
* 存储在：

```
~/.yourapp/cache/posters/
```

UI 只读取缩略图。

---

# 八、工程结构建议

```
/src-tauri
    /indexer
    /database
    /watcher
    /player

/frontend
    /grid
    /detail
    /search
```

---

# 九、启动流程设计

```
1. 打开 SQLite
2. 查询 movies count
3. 启动文件监听（后台线程）
4. UI 立即渲染
```

禁止：

```
启动 → 扫描 → 等待 → 再显示 UI
```

---

# 十、为什么不用 Jellyfin？

Jellyfin 是媒体服务器：

* 转码
* 权限系统
* REST API
* Web UI
* 内存占用高

你需要的是：

> Finder + 元数据渲染

而不是：

> 私人 Netflix 服务器

---

# 十一、Tauri 上手难度评估

你有：

* Flutter
* Vue
* React

你已经完成 70% 条件。

## 真正要学的只有：

1. Rust 基础语法（2天）
2. Tauri command 调用
3. 打包流程

示例：

### Rust

```rust
#[tauri::command]
fn scan(path: String) -> String {
    "ok".into()
}
```

### 前端

```js
invoke("scan", { path: "/mnt/nas" })
```

---

# 十二、和 Flutter Desktop 对比

| 项目       | Flutter | Tauri  |
| -------- | ------- | ------ |
| UI 流畅度   | 好       | 好      |
| 包体积      | 较大      | 很小     |
| 启动速度     | 中等      | 快      |
| 文件监听     | 麻烦      | Rust 强 |
| 调用系统命令   | 需要插件    | 简单     |
| Linux 适配 | 一般      | 很好     |

结论：

> 工具型应用 → Tauri 更优雅

---

# 十三、推荐开发节奏

## 第一步（1天）

* React 页面
* 一个按钮
* 点击调用 Rust
* 打印日志

理解架构。

---

## 第二步（2-3天）

* 扫描目录
* 读取 `.nfo`
* 返回 JSON
* 前端展示列表

完成 MVP。

---

## 第三步

* SQLite 持久化
* 文件监听
* 播放进度

---

# 最终定位

> 一个带 SQLite 索引的海报浏览器 + 系统播放器启动器

轻量、快速、纯本地。

非常适合做成一个小而美的个人工具。

```
```

