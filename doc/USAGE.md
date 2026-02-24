# Reelfs 使用指南

## 快速开始

### 1. 安装

从 Releases 页面下载对应平台的安装包：
- **macOS**: `Reelfs.dmg`
- **Linux**: `Reelfs.AppImage` 或 `Reelfs.deb`

### 2. 配置 NAS 路径

首次启动应用后：

1. 点击右上角的设置图标
2. 在"NAS Paths"部分点击"Add Path"
3. 选择你的电影目录（例如：`/Volumes/NAS/Movies` 或 `/mnt/nas/movies`）
4. 可以添加多个路径
5. 点击"Save Settings"保存配置

### 3. 首次扫描

配置完路径后：

1. 在设置页面点击"Start Full Scan"按钮
2. 等待扫描完成（会在底部显示进度条）
3. 扫描期间可以继续使用应用
4. 扫描完成后返回主页即可看到所有电影

## 主要功能

### 浏览电影

- **网格视图**: 主页以海报网格方式展示所有电影
- **虚拟滚动**: 即使有上万部电影也能流畅滚动
- **懒加载**: 海报图片按需加载，节省带宽

### 搜索电影

1. 在主页顶部的搜索栏输入关键词
2. 支持按标题、演员、导演、剧情搜索
3. 实时显示搜索结果（300ms 防抖）
4. 清空搜索栏返回全部电影

### 查看详情

点击任意电影卡片可查看：
- 大海报和背景图
- 详细信息（年份、评分、类型、导演、演员）
- 完整剧情简介
- 文件信息（路径、大小）
- 播放历史（播放次数、上次观看时间）

### 播放电影

1. 在详情页点击"Play"按钮
2. 系统会调用默认播放器（或 mpv）
3. 如果之前播放过，会显示"Continue Playing"并自动跳转到上次播放位置

支持的播放器：
- **macOS**: QuickTime Player（默认）、mpv（如已安装）
- **Linux**: mpv（推荐）、xdg-open（系统默认）

### 自动更新

应用会自动监听文件系统变化：
- 新增电影会自动加入数据库
- 删除的电影会自动移除
- 无需手动重新扫描

## NFO 文件格式

Reelfs 支持 Kodi/Emby 格式的 .nfo 文件：

```
Movies/
├── The Matrix (1999)/
│   ├── The Matrix (1999).mkv
│   ├── The Matrix (1999).nfo      ← 与电影同名
│   ├── poster.jpg
│   └── fanart.jpg
或
├── Inception/
│   ├── Inception.mp4
│   ├── movie.nfo                   ← 固定文件名
│   └── poster.jpg
```

NFO 文件示例：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>The Matrix</title>
  <year>1999</year>
  <rating>8.7</rating>
  <plot>A computer hacker learns...</plot>
  <director>Lana Wachowski</director>
  <actor>
    <name>Keanu Reeves</name>
  </actor>
  <genre>Action</genre>
  <genre>Sci-Fi</genre>
  <thumb aspect="poster">poster.jpg</thumb>
  <fanart>
    <thumb>fanart.jpg</thumb>
  </fanart>
</movie>
```

## 性能优化技巧

### 大规模影库（10000+ 部）

1. **首次扫描建议**：
   - 在非高峰时段进行
   - 扫描期间可正常使用应用
   - 大约每 1000 部电影需要 1-2 分钟

2. **缩略图生成**：
   - 首次扫描时会后台生成缩略图
   - 使用 WebP 格式，压缩率高
   - 约 10000 部电影占用 500MB-1GB 空间

3. **定期清理**：
   - 在设置页面可以清理缩略图缓存
   - 删除的电影缩略图不会自动清理，建议定期手动清理

### 数据库维护

数据库位置：`~/.reelfs/db/movies.db`

- 使用 SQLite，性能优异
- 支持 FTS5 全文搜索
- 自动创建索引优化查询
- 定期备份数据库文件以防数据丢失

## 故障排查

### 电影没有显示

1. 检查 NAS 路径是否正确挂载
2. 确认已点击"Start Full Scan"
3. 查看扫描进度是否完成
4. 检查文件扩展名是否支持（mkv, mp4, avi, mov, wmv, flv, webm, m4v）

### 海报不显示

1. 确认 .nfo 文件中有 poster 路径
2. 检查海报图片文件是否存在
3. 在设置中清理缓存后重新生成

### 播放器无法启动

**macOS**:
```bash
# 安装 mpv 以支持断点续播
brew install mpv
```

**Linux**:
```bash
# Debian/Ubuntu
sudo apt install mpv

# Arch Linux
sudo pacman -S mpv
```

### 文件监听不工作

如果新增电影没有自动显示：
1. 重启应用
2. 在设置页面手动触发全量扫描
3. 检查 NAS 路径是否可读写

## 数据位置

所有应用数据存储在：`~/.reelfs/`

```
~/.reelfs/
├── config.json              # 配置文件
├── db/
│   └── movies.db           # SQLite 数据库
└── cache/
    └── thumbnails/         # 缩略图缓存
        ├── 1.webp
        ├── 2.webp
        └── ...
```

## 卸载

1. 卸载应用
2. 删除数据目录：`rm -rf ~/.reelfs`

## 常见问题

**Q: 支持哪些视频格式？**  
A: mkv, mp4, avi, mov, wmv, flv, webm, m4v

**Q: 可以在线播放吗？**  
A: 不支持，Reelfs 只调用系统播放器，不做转码和在线播放

**Q: 支持字幕吗？**  
A: 如果字幕文件与视频文件同名，播放器会自动加载

**Q: 可以管理电视剧吗？**  
A: 当前版本专注于电影，电视剧支持可能会在未来版本添加

**Q: 数据存储在哪里？**  
A: 所有数据本地存储，不上传云端，完全私密

## 快捷键

- `Esc`: 返回上一页
- `Ctrl/Cmd + F`: 聚焦搜索栏
- `Enter`: 在详情页播放电影

## 技术支持

遇到问题？提交 Issue：
https://github.com/yourusername/reelfs/issues

## 更新日志

### v0.1.0 (2026-02-23)

- ✅ 初始版本发布
- ✅ 支持 10000+ 影片规模
- ✅ SQLite 全文搜索
- ✅ 虚拟滚动优化
- ✅ 自动文件监听
- ✅ 系统播放器集成
- ✅ 播放历史记录
