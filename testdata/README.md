# 测试数据集（testdata/）

一份声明式的测试媒体库 `manifest.json`，给开发手测和自动化测试共用。
同一份文件名/元数据形态，既能被物化成真实目录喂给应用（`just dev` 的沙盒
媒体库），也是 Rust 管线测试（`src-tauri/src/fixture_tests.rs`）和前端
fixtures（`src/test/fixtures.ts`）的断言依据——手测看到的库和测试断言的库
是同一套，沙盒里复现的问题可以直接落成测试。

## 用法

```bash
python3 scripts/gen-testdata.py --list                 # 只看数据集摘要
python3 scripts/gen-testdata.py --out /tmp/td          # 物化（auto 模式）
python3 scripts/gen-testdata.py --out /tmp/td --mode fast    # 无 ffmpeg，秒级
python3 scripts/gen-testdata.py --out /tmp/td --mode remux   # ffmpeg 秒级重封装
python3 scripts/gen-testdata.py --out /tmp/td --mode real    # ffmpeg 真实编码
just testdata                                          # 生成到 .agentenv/testdata
```

- **fast**：所有视频是同一个内置微型真实 mp4（`blobs/sample.mp4`，
  320x180 / 4s）的副本，海报是内置小图。无外部依赖，CI 和 `cargo test`
  用这个。缺点：mkv/webm 等扩展名与真实容器不符（内容都是 mp4 字节）。
- **remux**：有 ffmpeg 时的折中——mp4/m4v 仍复制内置样本，其余扩展名用
  `ffmpeg -c copy` 把 sample.mp4 秒级重封装成真实对应容器（内容仍是
  320x180 / 4s，不重编码）；webm 装不下 sample 的 h264/aac，回退 real
  编码。给"按容器类型断言"的用例用（注意见下面"已知差异"）。
- **real**：按 manifest 逐条 ffmpeg 编码（可播放、可出缩略图），海报按
  路径哈希生成纯色图。`just dev` 的沙盒用这个。
- **auto**（默认）：找得到 ffmpeg（PATH → `nix develop` 回退）就用 real，
  否则退回 fast。
- 幂等：重复运行只补缺失/截断的文件（real/remux 对已存在且 ≥4KB 的视频
  直接跳过——同一目录先 fast 再 remux 不会重封装已有文件，切模式用
  `--force` 或全新目录）。`--prune` 会删除输出目录里不在 manifest 中的
  文件——`.agentenv/media` 里有自建样本时**不要**开。
- `--force` 忽略幂等跳过，全部重写。

## manifest schema

`files` 数组，每项一个文件；`_doc` 开头的对象是纯注释。

```jsonc
{
  "path": "系列/流浪地球三部曲/流浪地球 上集.mp4",  // 相对输出目录，/ 分隔
  "kind": "video",            // video | file（干扰文件）
  "duration_seconds": 6,      // 可选，real 模式时长（默认 4）
  "resolution": [640, 360],   // 可选，real 模式分辨率（默认 [320,180]）
  "corrupt": false,           // 写入垃圾字节：探针必须失败
  "empty": false,             // 写 0 字节文件
  "nfo": {                    // 在视频旁写 NFO（as=stem → 同名.nfo；as=movie → movie.nfo）
    "as": "stem", "title": "…", "year": 2019, "rating": 7.9,
    "plot": "…", "genres": ["科幻"], "director": "…", "actors": ["…"]
  },
  "posters": ["poster.jpg"],  // 在视频所在目录写这些海报文件
  "expect": {                 // fixture_tests 的断言依据（生成器忽略）
    "title": "流浪地球 上集",  // extract_title_from_filename 的期望值
    "nfo_title": "…",         // NFO 解析出的标题（有 nfo 时必填）
    "poster": "poster.jpg",   // 海报优先级胜出者（有 posters 时必填）
    "group": "流浪地球", "part": 1,  // 系列识别：组名 + part 号
    "no_group": true,         // 匹配了模式但单部，不得成组
    "probe_ok": false         // 探针期望（corrupt/empty 自动视为 false）
  }
}
```

`kind: "file"` 条目：`content`（默认文本）或 `nfo`（在该路径直接写 NFO，
用于孤立的 .nfo 和 movie.nfo 优先级用例）。

## 数据集覆盖面

- **布局**：Kodi 式单片（folder-per-movie + movie.nfo + poster）、平铺散装、
  深嵌套（`深嵌套/a/b/c/`）
- **扩展名**：mkv / mp4 / avi / mov / wmv / flv / webm / m4v 全部，含大写
  `MOVIE_UPPER.MKV`
- **命名**：点分隔（`The.Matrix.1999`）、下划线、连字符保留、中文+空格、
  带括号年份
- **NFO**：完整元数据 / 最小元数据 / 同名 NFO 优先于 movie.nfo / 中文元数据
- **海报**：`poster.jpg > poster.png > folder.jpg > cover.jpg > fanart.jpg >
  fanart.png` 优先级（`海报全家福` 目录六种全放）
- **系列**（video_group_detector 全部模式）：上/中/下集、CD1/CD2、
  Part 1/2、EP01/EP02/E03、第1集/第2集、Disc1/Disc2，外加单部不成组
  （`孤独的单部 CD1`）
- **边界**：损坏文件、空文件、字幕（srt/ass）、孤立 nfo/jpg、无扩展名文件

## 已知差异（有意保留）

应用探针（`indexer.rs get_video_info`）的 ffprobe 路径要求 **stream 级**
`duration` 可读（容器级时长不算），而 matroska(mkv)/flv/webm 的 duration
只在容器级、stream 级为 N/A（2026-10 本机 ffmpeg 实测，real 与 remux 模式
均如此）——所以这些容器里的视频探不出时长，三列保持 NULL。这是应用探针
的真实局限，不是数据集缺陷；fast 模式无此问题（所有扩展名的内容都是 mp4
字节，ffprobe 按内容读得出 4/320/180，mp4/m4v 走 mp4 crate 同样成功）。
e2e（`scripts/e2e-launch.sh`）因此固定用 fast，并把模式写进
`.agentenv/e2e/testdata-mode`，`scripts/e2e-check.py` 按模式算探针期望值。

## e2e 专用 env 门控（默认关闭）

`src-tauri/src/main.rs` 的 `setup()` 认两个仅供测试沙盒使用的环境变量，
不设置时应用行为与正常启动完全一致（详见 `scripts/e2e-launch.sh`）：

- `REELFS_E2E_AUTOSCAN=1`：启动即自动跑一次与 `start_initial_scan` 命令
  同一管线的导入（NFO 解析 → 视频探针 → 缩略图 → 自动建组）。无头 e2e
  进程外无法 invoke Tauri command，这是唯一能让探针/建组在 e2e 下运行的
  入口；watcher 的单文件增量路径既不探测三列也不建组（现有设计）。
- `REELFS_E2E_HEADLESS=1`：主窗口创建后立即隐藏，避免每轮 e2e 在用户屏幕
  上弹 1280x800 窗口。只消除用户侧干扰；无 WindowServer 的 Linux CI 仍需
  虚拟显示（xvfb）才能跑 WKWebView。

## 消费方

| 消费方 | 模式 | 入口 |
| --- | --- | --- |
| agent 沙盒 / `just dev` | auto | `scripts/agent-env.sh` → `seed_media()` |
| e2e（无头沙盒） | fast（写 testdata-mode 标记） | `scripts/e2e-launch.sh` |
| Rust 管线测试 | fast | `src-tauri/src/fixture_tests.rs` |
| 前端 vitest | —（手写镜像） | `src/test/fixtures.ts`（标题/路径与 manifest 同名对照） |
