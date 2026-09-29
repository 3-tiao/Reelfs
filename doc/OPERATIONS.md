# Reelfs 综合操作指南

## 目录

1. [快速开始](#快速开始)
2. [环境准备](#环境准备)
3. [应用运行](#应用运行)
4. [调试指南](#调试指南)
5. [目录结构](#目录结构)
6. [常见问题排查](#常见问题排查)
7. [开发工作流](#开发工作流)
8. [文档查阅指引](#文档查阅指引)

---

## 快速开始

### 5分钟快速上手

```bash
# 1. 进入项目目录
cd $HOME/Documents/workspace/github/Reelfs

# 2. 启动开发服务器
npm run tauri:dev

# 3. 配置NAS路径（在应用设置中）
# 4. 扫描电影库
# 5. 开始使用！
```

---

## 环境准备

### 系统要求

- **操作系统**: macOS 10.13+ 或 Linux (Ubuntu 18.04+, Arch Linux, NixOS)
- **Rust**: 1.70 或更高版本
- **Node.js**: 18 或更高版本
- **内存**: 至少 4GB RAM
- **磁盘空间**: 至少 1GB 可用空间

### macOS 环境准备

#### 安装 Xcode Command Line Tools

```bash
xcode-select --install
```

#### 安装 Rust

```bash
# 使用 rustup 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 重新加载环境变量
source $HOME/.cargo/env

# 验证安装
rustc --version
cargo --version
```

#### 安装开发依赖

```bash
# 安装 pkg-config
brew install pkg-config

# 安装 mpv 播放器（可选，用于断点续播）
brew install mpv
```

#### 安装 Node.js

```bash
# 使用 Homebrew 安装
brew install node

# 或使用 nvm（推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

### Linux 环境准备

#### Debian/Ubuntu

```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# 安装开发依赖
sudo apt update
sudo apt install -y \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    pkg-config

# 安装 mpv 播放器
sudo apt install mpv

# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

#### Arch Linux

```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# 安装开发依赖
sudo pacman -S \
    base-devel \
    pkg-config \
    openssl \
    webkit2gtk \
    libsoup \
    gtk3 \
    librsvg \
    mpv

# 安装 Node.js
sudo pacman -S nodejs npm
```

#### NixOS

在 `configuration.nix` 中添加：

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
  mpv
  nodejs
  npm
];
```

然后运行：

```bash
nixos-rebuild switch
```

### 验证环境

```bash
# 检查 Rust 版本
rustc --version
cargo --version

# 检查 Node.js 版本
node --version
npm --version

# 检查 mpv（可选）
mpv --version
```

---

## 应用运行

### 开发模式

#### 启动开发服务器

```bash
# 进入项目目录
cd $HOME/Documents/workspace/github/Reelfs

# 启动开发服务器（首次启动需要编译，约2-3分钟）
npm run tauri:dev
```

这会：
1. 启动 Vite 开发服务器（http://localhost:1420）
2. 编译 Rust 代码
3. 打开 Tauri 应用窗口
4. 监听文件变化自动重载

#### 单独启动前端

```bash
# 只启动前端开发服务器（在浏览器中访问）
npm run dev
```

访问 http://localhost:1420

**注意**: 这种模式下 Tauri API 不可用，只能开发前端 UI。

### 生产构建

#### 构建应用

```bash
# 构建所有平台
npm run tauri:build

# 只构建当前平台
npm run tauri:build -- --target current
```

#### 构建产物位置

- **macOS**: `src-tauri/target/release/bundle/dmg/Reelfs_0.1.0_x64.dmg`
- **Linux**: `src-tauri/target/release/bundle/appimage/Reelfs_0.1.0_amd64.AppImage`
- **Debian**: `src-tauri/target/release/bundle/deb/reelfs_0.1.0_amd64.deb`

#### 安装应用

**macOS**:
```bash
# 打开 .dmg 文件
open src-tauri/target/release/bundle/dmg/Reelfs_0.1.0_x64.dmg

# 拖拽到 Applications 文件夹
```

**Linux**:
```bash
# AppImage（推荐）
chmod +x src-tauri/target/release/bundle/appimage/Reelfs_0.1.0_amd64.AppImage
./Reelfs_0.1.0_amd64.AppImage

# Debian/Ubuntu
sudo dpkg -i src-tauri/target/release/bundle/deb/reelfs_0.1.0_amd64.deb
```

### 首次配置

#### 1. 配置 NAS 路径

1. 启动应用后，点击右上角的 ⚙️ 设置图标
2. 在"NAS Paths"部分，点击"Add Path"按钮
3. 选择你的电影目录：
   - macOS: `/Volumes/NAS/Movies`
   - Linux: `/mnt/nas/movies`
4. 可以添加多个路径
5. 点击"Save Settings"保存

#### 2. 扫描电影库

1. 在设置页面，点击"Start Full Scan"按钮
2. 返回主页，底部会显示扫描进度
3. 扫描期间可以正常浏览已扫描的电影
4. 扫描完成后会自动刷新列表

#### 3. 浏览和播放

- **浏览电影**: 主页海报网格，流畅滚动
- **搜索电影**: 顶部搜索栏，实时搜索
- **查看详情**: 点击任意电影卡片
- **播放电影**: 详情页点击"Play"按钮

---

## 调试指南

### 前端调试

#### 打开开发者工具

- **macOS**: `Cmd + Option + I`
- **Linux**: `Ctrl + Shift + I`

#### 使用 React DevTools

1. 安装 React DevTools 扩展
2. 在开发者工具中选择"React"标签
3. 查看组件树、状态、props

#### 查看网络请求

虽然使用 IPC 调用，但可以在开发者工具中查看：
- Console: 查看日志输出
- Network: 查看 Tauri invoke 调用
- Performance: 分析性能

#### 前端日志

```typescript
// 在代码中添加日志
console.log('Debug info:', data);
console.error('Error:', error);
console.warn('Warning:', warning);
```

### Rust 后端调试

#### 打印日志

```rust
// 使用 println! 打印到终端
println!("Debug: {:?}", value);

// 使用 eprintln! 打印错误
eprintln!("Error: {}", error);

// 使用 dbg! 宏（开发调试）
let result = dbg!(some_function());
```

#### 使用日志系统

项目已集成 `log` 和 `env_logger`，支持分级日志：

```rust
use log::{info, debug, warn, error};

info!("信息日志");
debug!("调试日志");
warn!("警告日志");
error!("错误日志");
```

设置日志级别：

```bash
# 设置日志级别为 DEBUG
RUST_LOG=debug npm run tauri:dev

# 只显示特定模块的日志
RUST_LOG=reelfs=debug npm run tauri:dev
```

#### LLDB 调试器

```bash
# 使用 rust-lldb 调试
rust-lldb target/debug/reelfs

# 在 LLDB 中
(lldb) break main
(lldb) run
(lldb) print variable_name
(lldb) continue
```

### 数据库调试

#### 打开数据库

```bash
# macOS/Linux
sqlite3 ~/.reelfs/db/movies.db
```

#### 常用 SQL 命令

```sql
-- 查看表结构
.schema movies

-- 查看所有表
.tables

-- 查询电影数据
SELECT id, title, year FROM movies LIMIT 10;

-- 搜索电影
SELECT * FROM movies WHERE title LIKE '%matrix%';

-- FTS 全文搜索
SELECT * FROM movie_fts WHERE movie_fts MATCH 'matrix';

-- 查看播放历史
SELECT * FROM play_history ORDER BY last_played DESC LIMIT 10;

-- 统计电影数量
SELECT COUNT(*) FROM movies;
```

### 性能分析

#### 前端性能分析

1. 打开 Chrome DevTools
2. 选择"Performance"标签
3. 点击"Record"按钮
4. 执行操作（如滚动、搜索）
5. 停止录制
6. 分析 FPS、内存、CPU 使用

#### Rust 性能分析

```bash
# 安装 flamegraph
cargo install flamegraph

# 生成火焰图
cd src-tauri
cargo flamegraph --bin reelfs

# 查看火焰图
open flamegraph.svg
```

#### 内存分析

```bash
# 查看应用内存占用
ps aux | grep reelfs

# 持续监控内存
watch -n 1 'ps aux | grep reelfs'
```

### 常见调试场景

#### 场景1: 缩略图不显示

**检查步骤**:

1. 检查数据库中是否有缩略图路径：
```bash
sqlite3 ~/.reelfs/db/movies.db "SELECT id, title, thumbnail_path FROM movies WHERE thumbnail_path IS NOT NULL LIMIT 5;"
```

2. 检查缩略图文件是否存在：
```bash
ls -la ~/.reelfs/cache/thumbnails/
```

3. 查看日志中的缩略图生成错误：
```bash
RUST_LOG=reelfs=debug npm run tauri:dev
```

4. 检查 Tauri 文件权限配置：
```bash
cat src-tauri/tauri.conf.json | grep -A 5 "fs"
```

#### 场景2: 扫描没有找到电影

**检查步骤**:

1. 确认 NAS 路径是否正确挂载：
```bash
# macOS
ls /Volumes/

# Linux
ls /mnt/
```

2. 检查文件扩展名是否支持：
```bash
# 查看支持的扩展名
grep "VIDEO_EXTENSIONS" src-tauri/src/indexer.rs
```

3. 查看扫描日志：
```bash
RUST_LOG=reelfs=debug npm run tauri:dev
```

4. 手动测试扫描：
```bash
cd src-tauri
cargo run --example test_scan
```

#### 场景3: 播放器无法启动

**检查步骤**:

1. 检查 mpv 是否安装：
```bash
mpv --version
```

2. 测试播放器命令：
```bash
# macOS
open /path/to/movie.mkv

# Linux
mpv /path/to/movie.mkv
```

3. 查看播放器日志：
```bash
RUST_LOG=reelfs=debug npm run tauri:dev
```

4. 检查文件路径是否可访问：
```bash
ls -la /path/to/movie.mkv
```

---

## 目录结构

### 项目根目录

```
Reelfs/
├── doc/                          # 文档目录
│   ├── QUICKSTART.md            # 快速开始指南
│   ├── USAGE.md                 # 详细使用指南
│   ├── DEVELOPMENT.md           # 开发文档
│   ├── PERFORMANCE.md            # 性能优化指南
│   ├── PROJECT_SUMMARY.md       # 项目总结
│   ├── DESIGN.md                # 设计方案
│   └── OPERATIONS.md            # 本文档
├── src/                          # React 前端
│   ├── pages/                   # 页面组件
│   ├── components/              # 可复用组件
│   ├── stores/                  # Zustand 状态管理
│   ├── services/                # API 封装
│   ├── styles/                  # 全局样式
│   ├── App.tsx                  # 根组件
│   └── main.tsx                 # 入口文件
├── src-tauri/                    # Rust 后端
│   ├── src/                     # Rust 源代码
│   │   ├── main.rs             # 主程序入口
│   │   ├── models.rs           # 数据结构定义
│   │   ├── database.rs         # SQLite 数据库层
│   │   ├── indexer.rs          # 目录扫描 + NFO 解析
│   │   ├── thumbnail.rs        # 缩略图生成
│   │   ├── player.rs           # 播放器调用
│   │   └── watcher.rs          # 文件系统监听
│   ├── examples/               # 示例代码
│   ├── Cargo.toml              # Rust 依赖配置
│   ├── tauri.conf.json         # Tauri 配置
│   └── build.rs                # 构建脚本
├── cache/                       # 缓存目录
│   └── thumbnails/             # 缩略图缓存
├── node_modules/               # Node.js 依赖
├── dist/                       # 前端构建输出
├── package.json                # 前端依赖配置
├── vite.config.ts             # Vite 构建配置
├── tsconfig.json              # TypeScript 配置
├── tailwind.config.js         # Tailwind CSS 配置
├── README.md                  # 项目说明
└── .gitignore                 # Git 忽略规则
```

### 数据目录

```
~/.reelfs/
├── config.json              # 配置文件
├── db/
│   └── movies.db           # SQLite 数据库
└── cache/
    └── thumbnails/         # 缩略图缓存
        ├── 1.jpg
        ├── 2.jpg
        └── ...
```

---

## 常见问题排查

### 安装问题

#### 问题: Rust 编译错误

**错误信息**: `error: linking with 'cc' failed`

**解决方案**:

```bash
# macOS
xcode-select --install

# Linux (Debian/Ubuntu)
sudo apt install build-essential

# Linux (Arch Linux)
sudo pacman -S base-devel
```

#### 问题: Node.js 版本不兼容

**错误信息**: `Node.js version too old`

**解决方案**:

```bash
# 使用 nvm 安装 Node.js 18
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

### 运行问题

#### 问题: WebView 未显示

**症状**: Tauri 窗口是空白的

**检查步骤**:

1. 检查前端开发服务器是否运行：
```bash
curl http://localhost:1420
```

2. 查看 `tauri.conf.json` 中的 `devPath` 配置：
```bash
cat src-tauri/tauri.conf.json | grep devPath
```

3. 确认防火墙没有阻止 localhost:1420

#### 问题: 文件监听不工作

**症状**: 新增电影没有自动显示

**解决方案**:

1. 重启应用
2. 在设置页面手动触发全量扫描
3. 检查 NAS 路径是否可读写：
```bash
ls -la /path/to/nas
```

4. 查看日志中的文件监听错误：
```bash
RUST_LOG=reelfs=debug npm run tauri:dev
```

#### 问题: 缩略图生成失败

**症状**: 海报不显示或显示错误

**检查步骤**:

1. 检查缓存目录权限：
```bash
ls -la ~/.reelfs/cache/thumbnails/
```

2. 检查 Tauri 文件权限配置：
```bash
cat src-tauri/tauri.conf.json | grep -A 10 "fs"
```

3. 手动生成缩略图：
```bash
cd src-tauri
cargo run --example test_thumbnail
```

4. 清理缓存后重新生成：
```bash
rm -rf ~/.reelfs/cache/thumbnails/*
# 在应用设置中点击"Clear Thumbnail Cache"
```

### 性能问题

#### 问题: 应用启动慢

**症状**: 启动时间超过 1 秒

**优化方案**:

1. 使用 Release 构建：
```bash
npm run tauri:build
```

2. 检查数据库大小：
```bash
ls -lh ~/.reelfs/db/movies.db
```

3. 清理缩略图缓存：
```bash
rm -rf ~/.reelfs/cache/thumbnails/*
```

4. 优化数据库：
```bash
sqlite3 ~/.reelfs/db/movies.db "VACUUM;"
```

#### 问题: 滚动卡顿

**症状**: 滚动电影列表时 FPS 低于 60

**检查步骤**:

1. 打开开发者工具，查看 Performance 面板
2. 检查是否有内存泄漏
3. 减少同时加载的缩略图数量
4. 使用虚拟滚动（已实现）

#### 问题: 搜索慢

**症状**: 搜索响应时间超过 100ms

**优化方案**:

1. 检查 FTS 索引是否创建：
```bash
sqlite3 ~/.reelfs/db/movies.db "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%fts%';"
```

2. 重建 FTS 索引：
```bash
sqlite3 ~/.reelfs/db/movies.db "DROP TABLE IF EXISTS movie_fts;"
sqlite3 ~/.reelfs/db/movies.db "CREATE VIRTUAL TABLE movie_fts USING fts5(title, plot, actors, director, content=movies, content_rowid=id, tokenize='unicode61');"
```

3. 添加防抖（已实现）

---

## 开发工作流

### 日常开发流程

```bash
# 1. 拉取最新代码
git pull origin master

# 2. 安装依赖（如果有更新）
npm install

# 3. 启动开发服务器
npm run tauri:dev

# 4. 开发代码
# - 修改前端代码（src/）
# - 修改后端代码（src-tauri/src/）
# - 应用会自动重载

# 5. 测试功能

# 6. 提交代码
git add .
git commit -m "feat: 添加新功能"
git push origin master
```

### 代码检查

#### Rust 代码检查

```bash
# 检查代码
cd src-tauri
cargo check

# 格式化代码
cargo fmt

# 代码检查（clippy）
cargo clippy

# 运行测试
cargo test
```

#### 前端代码检查

```bash
# 类型检查
npm run build

# 格式化代码（需要安装 prettier）
npx prettier --write src/

# 代码检查（需要安装 eslint）
npm run lint
```

### 提交代码规范

#### 提交信息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type 类型**:
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 添加测试
- `chore`: 构建/工具相关

**示例**:
```
feat(thumbnail): 添加缩略图自动生成功能

- 在扫描完成后自动生成缩略图
- 使用 JPEG 格式优化文件大小
- 添加缓存清理功能

Closes #123
```

### 版本发布流程

```bash
# 1. 更新版本号
# - package.json
# - src-tauri/Cargo.toml
# - src-tauri/tauri.conf.json

# 2. 更新 CHANGELOG.md

# 3. 创建 Git 标签
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0

# 4. 构建发布版本
npm run tauri:build

# 5. 上传到 GitHub Releases
```

---

## 文档查阅指引

### 文档索引

| 文档 | 用途 | 目标读者 |
|------|------|---------|
| [README.md](../README.md) | 项目介绍和概述 | 所有人 |
| [QUICKSTART.md](QUICKSTART.md) | 5分钟快速上手 | 新用户 |
| [USAGE.md](USAGE.md) | 详细使用指南 | 普通用户 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 开发指南和API文档 | 开发者 |
| [PERFORMANCE.md](PERFORMANCE.md) | 性能优化指南 | 开发者 |
| [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) | 项目总结和完成情况 | 所有人 |
| [DESIGN.md](DESIGN.md) | 设计方案和架构 | 开发者 |
| [OPERATIONS.md](OPERATIONS.md) | 综合操作指南（本文档） | 所有人 |

### 按需求查阅

#### 我想快速上手

1. 阅读 [QUICKSTART.md](QUICKSTART.md)
2. 按照"5分钟快速上手"章节操作
3. 遇到问题查看"常见问题排查"章节

#### 我想了解如何使用

1. 阅读 [USAGE.md](USAGE.md)
2. 查看"主要功能"章节
3. 参考"NFO文件格式"章节

#### 我想参与开发

1. 阅读 [DEVELOPMENT.md](DEVELOPMENT.md)
2. 按照"开发环境设置"章节配置环境
3. 查看"核心模块说明"了解架构
4. 参考"调试技巧"章节

#### 我想优化性能

1. 阅读 [PERFORMANCE.md](PERFORMANCE.md)
2. 查看"性能指标"章节
3. 参考"架构优化"章节
4. 使用"性能分析"工具

#### 我想了解项目设计

1. 阅读 [DESIGN.md](DESIGN.md)
2. 查看"技术选型"章节
3. 参考"整体架构设计"章节

#### 我想全面了解项目

1. 阅读 [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
2. 查看"已实现功能"章节
3. 参考"架构亮点"章节

#### 我想解决具体问题

1. 查阅本文档的"常见问题排查"章节
2. 根据问题类型查找对应解决方案
3. 如果问题未解决，查看其他相关文档

### 文档更新

#### 文档维护原则

- **准确性**: 确保文档内容与代码一致
- **简洁性**: 使用简洁明了的语言
- **完整性**: 覆盖所有重要功能
- **时效性**: 及时更新过时内容

#### 更新文档

```bash
# 1. 编辑文档
vim doc/OPERATIONS.md

# 2. 预览文档（使用 Markdown 预览工具）
# - VS Code: 安装 Markdown Preview Enhanced 插件
# - Typora: 专业的 Markdown 编辑器

# 3. 提交文档更新
git add doc/OPERATIONS.md
git commit -m "docs: 更新操作指南"
git push origin master
```

---

## 附录

### 常用命令速查

```bash
# 开发
npm run tauri:dev              # 启动开发服务器
npm run dev                    # 只启动前端
npm run build                  # 构建前端
npm run tauri:build            # 构建应用

# Rust
cargo check                    # 检查代码
cargo fmt                      # 格式化代码
cargo clippy                   # 代码检查
cargo test                     # 运行测试
cargo clean                    # 清理构建

# 数据库
sqlite3 ~/.reelfs/db/movies.db # 打开数据库

# 日志
RUST_LOG=debug npm run tauri:dev  # 设置日志级别为 DEBUG
RUST_LOG=reelfs=debug npm run tauri:dev  # 只显示 reelfs 模块的日志

# Git
git pull origin master         # 拉取最新代码
git add .                      # 添加所有更改
git commit -m "message"        # 提交更改
git push origin master        # 推送到远程
```

### 环境变量

```bash
# Rust 日志级别
export RUST_LOG=debug          # 设置日志级别
export RUST_LOG=reelfs=info    # 只显示 reelfs 模块的日志

# Node.js
export NODE_ENV=development    # 开发模式
export NODE_ENV=production     # 生产模式
```

### 配置文件位置

```bash
# 应用配置
~/.reelfs/config.json

# 数据库
~/.reelfs/db/movies.db

# 缓存
~/.reelfs/cache/thumbnails/

# 项目配置
./package.json                 # 前端依赖
./src-tauri/Cargo.toml        # Rust 依赖
./src-tauri/tauri.conf.json   # Tauri 配置
```

### 有用的链接

- [Tauri 官方文档](https://tauri.app/)
- [React 官方文档](https://react.dev/)
- [Rust 官方文档](https://doc.rust-lang.org/)
- [SQLite 文档](https://www.sqlite.org/docs.html)
- [Kodi NFO 格式](https://kodi.wiki/view/NFO_files)
- [Zustand 文档](https://github.com/pmndrs/zustand)
- [Tailwind CSS 文档](https://tailwindcss.com/)

---

## 获取帮助

如果遇到问题：

1. 查阅本文档的"常见问题排查"章节
2. 查看其他相关文档
3. 检查 GitHub Issues
4. 提交新的 Issue

---

**最后更新**: 2026-02-24  
**版本**: v0.1.0  
**维护者**: Reelfs Team
