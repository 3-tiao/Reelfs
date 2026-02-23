# Reelfs 快速启动指南

## 🚀 5 分钟上手

### 第 1 步：启动应用

```bash
# 进入项目目录
cd /Users/user/Documents/workspace/github/Reelfs

# 启动开发服务器
npm run tauri:dev
```

首次启动会自动编译 Rust 代码（约 2-3 分钟），后续启动会很快。

### 第 2 步：配置 NAS 路径

1. 应用启动后，点击右上角的 ⚙️ 设置图标
2. 在"NAS Paths"部分，点击"Add Path"按钮
3. 选择你的电影目录，例如：
   - macOS: `/Volumes/NAS/Movies`
   - Linux: `/mnt/nas/movies`
4. 可以添加多个路径
5. 点击"Save Settings"保存

### 第 3 步：扫描电影库

1. 在设置页面，点击"Start Full Scan"按钮
2. 返回主页，底部会显示扫描进度
3. 扫描期间可以正常浏览已扫描的电影
4. 扫描完成后会自动刷新列表

### 第 4 步：浏览和播放

- **浏览电影**：主页海报网格，流畅滚动
- **搜索电影**：顶部搜索栏，实时搜索
- **查看详情**：点击任意电影卡片
- **播放电影**：详情页点击"Play"按钮

---

## 📁 目录结构要求

Reelfs 支持以下目录结构：

### 推荐结构（Kodi/Emby 兼容）

```
Movies/
├── The Matrix (1999)/
│   ├── The Matrix (1999).mkv        # 视频文件
│   ├── The Matrix (1999).nfo        # 元数据文件（与视频同名）
│   ├── poster.jpg                   # 海报
│   └── fanart.jpg                   # 背景图
│
├── Inception (2010)/
│   ├── Inception.mp4
│   ├── movie.nfo                    # 或使用固定名称 movie.nfo
│   └── poster.jpg
│
└── Avatar/
    ├── Avatar.mkv
    ├── Avatar.nfo
    └── poster.jpg
```

### 简单结构（无 NFO）

```
Movies/
├── The Matrix (1999).mkv
├── Inception (2010).mp4
└── Avatar.mkv
```

无 NFO 文件时，Reelfs 会从文件名提取标题。

---

## 🎬 NFO 文件示例

创建 `movie.nfo` 文件：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>The Matrix</title>
  <year>1999</year>
  <rating>8.7</rating>
  <plot>A computer hacker learns from mysterious rebels...</plot>
  <director>Lana Wachowski</director>
  <actor><name>Keanu Reeves</name></actor>
  <actor><name>Laurence Fishburne</name></actor>
  <genre>Action</genre>
  <genre>Sci-Fi</genre>
  <thumb aspect="poster">poster.jpg</thumb>
  <fanart><thumb>fanart.jpg</thumb></fanart>
</movie>
```

---

## 🎯 常见使用场景

### 场景 1：首次导入大量电影

```
1. 配置 NAS 路径
2. 点击"Start Full Scan"
3. 泡杯咖啡等待（10000 部约 10 分钟）
4. 扫描完成后即可使用
```

### 场景 2：新增几部电影

```
1. 直接将电影复制到 NAS
2. Reelfs 自动检测（< 1 秒）
3. 新电影自动出现在列表中
无需手动重新扫描！
```

### 场景 3：搜索特定电影

```
1. 在主页顶部搜索栏输入关键词
2. 实时显示匹配结果
3. 支持标题、演员、导演、剧情搜索
```

### 场景 4：继续观看未看完的电影

```
1. 打开电影详情页
2. 点击"Continue Playing (45m)"
3. 自动跳转到上次播放位置
需要安装 mpv 播放器
```

---

## ⚙️ 推荐配置

### macOS 用户

安装 mpv 以支持断点续播：
```bash
brew install mpv
```

### Linux 用户

安装 mpv：
```bash
# Debian/Ubuntu
sudo apt install mpv

# Arch Linux
sudo pacman -S mpv

# Fedora
sudo dnf install mpv
```

---

## 📊 性能预期

| 电影数量 | 首次扫描时间 | 启动速度 | 搜索速度 |
|---------|-------------|---------|---------|
| 1000    | ~1 分钟      | < 300ms | < 50ms  |
| 5000    | ~5 分钟      | < 300ms | < 80ms  |
| 10000   | ~10 分钟     | < 300ms | < 100ms |

---

## 🐛 故障排查

### 问题：扫描没有找到电影

**检查清单**:
- ✅ NAS 是否已挂载？
- ✅ 路径是否正确？
- ✅ 文件扩展名是否支持？（mkv, mp4, avi, mov...）
- ✅ 是否点击了"Start Full Scan"？

### 问题：海报不显示

**解决方案**:
- 检查 .nfo 文件中的 poster 路径
- 确认海报文件存在
- 在设置中清理缓存后重新生成

### 问题：播放器无法启动

**解决方案**:
- macOS: 安装 mpv (`brew install mpv`)
- Linux: 安装 mpv (`sudo apt install mpv`)
- 检查文件路径是否可访问

---

## 🎓 进阶技巧

### 1. 批量下载元数据

使用 Kodi 或 tinyMediaManager 批量生成 NFO 文件：
```bash
# 推荐工具
- Kodi（免费）
- tinyMediaManager（开源）
- MediaElch（开源）
```

### 2. 优化缩略图加载

定期清理缓存可以释放空间：
```
设置 > Clear Thumbnail Cache
```

### 3. 备份数据库

定期备份避免数据丢失：
```bash
cp ~/.reelfs/db/movies.db ~/backup/movies_backup.db
```

### 4. 多路径管理

可以添加多个 NAS 路径：
```
/Volumes/NAS1/Movies
/Volumes/NAS2/Movies
/Users/username/Movies
```

---

## 📖 更多文档

- **详细使用指南**: [USAGE.md](USAGE.md)
- **开发文档**: [DEVELOPMENT.md](DEVELOPMENT.md)
- **性能优化**: [PERFORMANCE.md](PERFORMANCE.md)
- **项目总结**: [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)

---

## 🎉 开始使用

```bash
# 1. 启动应用
npm run tauri:dev

# 2. 配置路径
# 3. 扫描电影
# 4. 开始观影！
```

享受你的私人电影库吧！🍿
