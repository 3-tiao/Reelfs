# Reelfs 开发指南

## 开发环境设置

### 前置要求

- **Rust**: 1.70+ (推荐使用 rustup)
- **Node.js**: 20.19+（或 22.12+，以 vite 的 engines 要求为准）
- **操作系统**: macOS 或 Linux

### 安装依赖

**macOS**:
```bash
# 安装 Xcode Command Line Tools
xcode-select --install

# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装开发依赖
brew install pkg-config
```

**Linux (Debian/Ubuntu)**:
```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装开发依赖
sudo apt install -y libwebkit2gtk-4.1-dev \
    libsoup-3.0-dev \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

**NixOS**:
```nix
environment.systemPackages = with pkgs; [
  rustc
  cargo
  pkg-config
  openssl
  webkitgtk
  libsoup
  gtk3
  librsvg
];
```

### 克隆项目

```bash
git clone https://github.com/yourusername/reelfs.git
cd reelfs
```

### 安装项目依赖

```bash
# 安装前端依赖
npm install

# Tauri CLI 会自动安装
```

## 开发工作流

### 启动开发服务器

```bash
# 启动前端 + Rust 后端（热重载）
npm run tauri:dev
```

这会：
1. 启动 Vite 开发服务器（localhost:1420）
2. 编译 Rust 代码
3. 打开 Tauri 应用窗口
4. 监听文件变化自动重载

### 单独开发前端

```bash
# 只启动前端开发服务器
npm run dev
```

在浏览器访问 http://localhost:1420

注意：这种模式下 Tauri API 不可用。

### 检查代码

```bash
# 检查 Rust 代码
cd src-tauri && cargo check

# 检查前端代码
npm run build
```

### 运行测试

```bash
# Rust 单元测试
cd src-tauri && cargo test

# 前端测试（如果添加了）
npm test
```

### 代码格式化

```bash
# Rust 格式化
cd src-tauri && cargo fmt

# 前端格式化（需要安装 prettier）
npx prettier --write src/
```

## 项目结构详解

```
reelfs/
├── src/                          # React 前端
│   ├── pages/                   # 页面组件
│   │   ├── Home.tsx             # 主页（电影网格）
│   │   ├── MovieDetail.tsx      # 详情页
│   │   ├── Search.tsx           # 搜索页
│   │   └── Settings.tsx         # 设置页
│   ├── components/              # 可复用组件
│   │   ├── MovieCard.tsx        # 电影卡片
│   │   ├── MovieGrid.tsx        # 虚拟滚动网格
│   │   ├── SearchBar.tsx        # 搜索栏
│   │   └── ScanProgress.tsx     # 扫描进度条
│   ├── stores/                  # Zustand 状态管理
│   │   ├── movieStore.ts        # 电影数据状态
│   │   └── settingsStore.ts     # 设置状态
│   ├── services/                # API 封装
│   │   └── tauri.ts             # Tauri invoke 封装
│   ├── styles/                  # 样式
│   │   └── global.css           # 全局样式
│   ├── App.tsx                  # 根组件（路由）
│   └── main.tsx                 # 入口文件
│
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs              # 主程序入口
│   │   ├── models.rs            # 数据结构定义
│   │   ├── database.rs          # SQLite 数据库层
│   │   ├── indexer.rs           # 目录扫描 + NFO 解析
│   │   ├── thumbnail.rs         # 缩略图生成
│   │   ├── player.rs            # 播放器调用
│   │   └── watcher.rs           # 文件系统监听
│   ├── Cargo.toml               # Rust 依赖
│   ├── tauri.conf.json          # Tauri 配置
│   └── build.rs                 # 构建脚本
│
├── public/                       # 静态资源
├── dist/                         # 前端构建输出
├── node_modules/                 # Node 依赖
├── package.json                  # 前端依赖
├── vite.config.ts               # Vite 配置
├── tsconfig.json                # TypeScript 配置
├── tailwind.config.js           # Tailwind CSS 配置
├── README.md                     # 项目说明
├── USAGE.md                      # 用户指南
├── PERFORMANCE.md                # 性能优化指南
└── DEVELOPMENT.md                # 本文档
```

## 核心模块说明

### 1. 数据库层 (database.rs)

职责：
- SQLite 数据库初始化
- CRUD 操作
- 事务管理
- FTS5 全文搜索

关键函数：
```rust
pub fn new(db_path: &str) -> Result<Self>
pub fn get_movies(&self, offset: i32, limit: i32) -> Result<Vec<Movie>>
pub fn search_movies(&self, query: &str) -> Result<Vec<Movie>>
pub fn batch_insert_movies(&self, movies: &[...]) -> Result<usize>
```

### 2. 索引引擎 (indexer.rs)

职责：
- 递归扫描目录
- 解析 .nfo 文件（Kodi/Emby 格式）
- 提取元数据

关键函数：
```rust
pub fn scan_directory(path: &str) -> Vec<(PathBuf, Option<MovieMetadata>)>
pub fn parse_nfo_file(nfo_path: &Path) -> Option<MovieMetadata>
pub fn is_video_file(path: &Path) -> bool
```

### 3. 缩略图系统 (thumbnail.rs)

职责：
- 图片压缩和缩放
- WebP 格式转换
- 缓存管理

关键函数：
```rust
pub fn generate_thumbnail(source_path: &str, output_path: &str) -> ImageResult<()>
pub fn get_thumbnail_path(cache_dir: &str, movie_id: i64) -> String
pub fn clear_cache(cache_dir: &str) -> std::io::Result<()>
```

### 4. 文件监听器 (watcher.rs)

职责：
- 监听文件系统变化
- 增量更新数据库
- Debounce 处理

关键函数：
```rust
pub fn start_watcher(paths: Vec<String>, db_path: String) -> Result<(), Box<dyn std::error::Error>>
fn handle_fs_event(db: &Database, event: Event)
```

### 5. 播放器集成 (player.rs)

职责：
- 调用系统播放器
- 支持断点续播（mpv）

关键函数：
```rust
pub fn play_movie(file_path: &str, start_position: Option<f64>) -> Result<(), String>
```

## Tauri Commands

前端通过 `invoke` 调用后端函数：

```typescript
// 获取电影列表
const movies = await invoke<Movie[]>('get_movies', { offset: 0, limit: 200 });

// 搜索电影
const results = await invoke<Movie[]>('search_movies', { query: 'matrix' });

// 播放电影
await invoke('play_movie', { id: 123 });
```

后端定义：
```rust
#[tauri::command]
async fn get_movies(state: tauri::State<'_, AppState>, offset: i32, limit: i32) -> Result<Vec<Movie>, String>

#[tauri::command]
async fn search_movies(state: tauri::State<'_, AppState>, query: String) -> Result<Vec<Movie>, String>

#[tauri::command]
async fn play_movie(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String>
```

## 状态管理

### Rust 端（Tauri State）

```rust
struct AppState {
    db: Arc<Mutex<Database>>,
    config: Arc<Mutex<AppConfig>>,
    scan_status: Arc<Mutex<ScanStatus>>,
}
```

使用 `Arc<Mutex<>>` 在多线程间安全共享状态。

### 前端（Zustand）

```typescript
interface MovieStore {
  movies: Movie[];
  isLoading: boolean;
  fetchMovies: (offset: number) => Promise<void>;
  searchMovies: (query: string) => Promise<void>;
}

const useMovieStore = create<MovieStore>((set) => ({
  movies: [],
  isLoading: false,
  fetchMovies: async (offset) => { /* ... */ },
}));
```

## 事件系统

Rust 向前端推送事件：

```rust
// Rust 端发送事件
window.emit("scan-progress", scan_status)?;
```

```typescript
// 前端监听事件
import { listen } from "@tauri-apps/api/event";

listen<ScanStatus>("scan-progress", (event) => {
  console.log("Scan progress:", event.payload);
});
```

## 调试技巧

### 前端调试

1. 打开开发者工具：`F12` 或 `Cmd+Option+I`
2. 使用 React DevTools 扩展
3. 查看 Network 面板（虽然是 IPC 调用）

### Rust 调试

1. **打印日志**:
```rust
println!("Debug: {:?}", value);
eprintln!("Error: {}", error);
```

2. **使用 dbg! 宏**:
```rust
let result = dbg!(some_function());
```

3. **LLDB 调试器**:
```bash
rust-lldb target/debug/reelfs
```

### 数据库调试

```bash
# 打开数据库
sqlite3 ~/.reelfs/db/movies.db

# 查看表结构
.schema movies

# 查询数据
SELECT * FROM movies LIMIT 10;

# FTS 搜索测试
SELECT * FROM movie_fts WHERE movie_fts MATCH 'matrix';
```

## 常见开发问题

### 1. Rust 编译错误

**问题**: `error: linking with 'cc' failed`

**解决**:
```bash
# macOS
xcode-select --install

# Linux
sudo apt install build-essential
```

### 2. WebView 未显示

**问题**: Tauri 窗口是空白的

**解决**:
- 检查前端开发服务器是否运行
- 查看 `tauri.conf.json` 中的 `devPath` 配置
- 确认防火墙没有阻止 localhost:1420

### 3. 跨平台路径问题

**问题**: 文件路径在不同系统不兼容

**解决**:
```rust
// 使用 std::path::PathBuf
use std::path::PathBuf;

let path = PathBuf::from(path_str);
```

### 4. SQLite 锁定错误

**问题**: `database is locked`

**解决**:
- 使用事务批量操作
- 避免长时间持有锁
- 考虑使用 WAL 模式

## 构建发布版本

### 开发构建

```bash
npm run tauri:dev
```

### 生产构建

```bash
# 构建所有平台
npm run tauri:build

# 只构建当前平台
npm run tauri:build -- --target current
```

构建产物位置：
- macOS: `src-tauri/target/release/bundle/dmg/`
- Linux: `src-tauri/target/release/bundle/appimage/`
- Debian: `src-tauri/target/release/bundle/deb/`

### 交叉编译

```bash
# 添加目标平台
rustup target add x86_64-unknown-linux-gnu

# 构建指定平台
npm run tauri:build -- --target x86_64-unknown-linux-gnu
```

## 性能分析

### Rust 性能分析

```bash
# 安装 flamegraph
cargo install flamegraph

# 生成火焰图
cargo flamegraph --bin reelfs
```

### 前端性能分析

使用 Chrome DevTools:
1. 打开 Performance 面板
2. 点击 Record
3. 执行操作（如滚动、搜索）
4. 停止录制
5. 分析 FPS、内存、CPU 使用

## 贡献指南

### 提交代码

1. Fork 项目
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交代码：`git commit -am 'Add some feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 提交 Pull Request

### 代码规范

**Rust**:
- 遵循 Rust 官方风格指南
- 运行 `cargo fmt` 格式化
- 运行 `cargo clippy` 检查

**TypeScript/React**:
- 使用 ESLint + Prettier
- 函数组件优先
- 使用 TypeScript 类型注解

### 提交信息规范

```
feat: 添加新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式调整
refactor: 重构
perf: 性能优化
test: 添加测试
chore: 构建/工具相关
```

## 技术栈详解

### 前端

- **React 18**: UI 框架
- **React Router v6**: 路由管理
- **Zustand**: 状态管理（比 Redux 轻量）
- **react-window**: 虚拟滚动
- **Tailwind CSS**: 样式框架
- **Lucide React**: 图标库
- **Vite**: 构建工具

### 后端

- **Tauri 2.x**: 应用框架
- **Rust 1.70+**: 编程语言
- **rusqlite**: SQLite 绑定
- **quick-xml**: XML 解析（NFO 文件）
- **notify**: 文件系统监听
- **image**: 图片处理
- **walkdir**: 目录遍历
- **tokio**: 异步运行时

## 资源链接

- [Tauri 官方文档](https://tauri.app/)
- [React 官方文档](https://react.dev/)
- [Rust 官方文档](https://doc.rust-lang.org/)
- [SQLite 文档](https://www.sqlite.org/docs.html)
- [Kodi NFO 格式](https://kodi.wiki/view/NFO_files)

## 获取帮助

- 提交 Issue：https://github.com/yourusername/reelfs/issues
- 讨论区：https://github.com/yourusername/reelfs/discussions
- Email：your@email.com
