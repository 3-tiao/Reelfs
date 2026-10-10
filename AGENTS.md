# AGENTS.md — Agent 工作规则（Reelfs）

## 铁律：不要碰用户的真实 Reelfs 数据

用户的真实资源只有一处入口，agent 一律不得读写：

- `~/.reelfs/`（config.json、movies.db、缩略图缓存、logs）
- 用户 config.json 里 `nas_paths` 指向的真实 NAS / 本地媒体目录

任何会**启动 Reelfs 应用**的操作（可用性测试、UI 验证、手动跑、扫描媒体库），
必须走隔离沙盒：

```bash
just dev                      # 初始化沙盒并启动应用（等价于旧的 scripts/agent-env.sh run）
scripts/agent-env.sh status   # 查看沙盒状态
scripts/agent-env.sh clean    # 测试完清理整个沙盒
```

**`just run` 不是沙盒**：它是真实配置（`~/.reelfs` + `config.json` 里的真实媒体
路径），只能由用户本人执行，agent 一律不得运行。这两个名字的区别就是数据目录，
弄反了一次就会扫到用户的真实媒体库。

沙盒在 `<repo>/.agentenv/`（gitignored）：应用把 config/db/cache/logs 全部写进
`.agentenv/home/.reelfs/`，媒体库指向 `.agentenv/media/` 里脚本生成的微型样本
视频。实现见 `src-tauri/src/path_utils.rs` 的 `reelfs_base_dir`（`REELFS_HOME`
环境变量覆盖 `HOME`）。脚本还会把 `XDG_CONFIG_HOME` 等四个 XDG 目录一并指向
沙盒，否则 Tauri 的窗口状态、WebKit 的 localstorage 会落到真实家目录。

不要绕过脚本直接 `npm run tauri dev` / `cargo run`——那样应用会落到真实的
`~/.reelfs` 上（包括启动时的日志写入）。

## 测试数据

- 标准测试数据集在 `testdata/manifest.json` 声明，`scripts/gen-testdata.py`
  物化（schema 与覆盖面见 `testdata/README.md`）：
  `python3 scripts/gen-testdata.py --out <dir>` 或 `just testdata`。有
  ffmpeg 生成真实可播放视频，没有则回退内置微型样本（`--mode fast/real`
  可强制）。Rust 管线测试（`src-tauri/src/fixture_tests.rs`，跑在
  `cargo test` 里，需要 python3——dev shell 已带）与 agent 沙盒共用这份数据。
- 需要媒体文件时，用上面生成的样本，或往 `.agentenv/media/` 放自建的微型
  文件；不要复制用户真实影片。
- 单元测试一律用 temp 目录，不落 `~`。

## 端到端测试（e2e）

无头端到端：启动沙盒应用 → 全量导入数据集 → 对 SQLite/缓存/日志断言 14
条用例。脚本三件套：

```bash
bash scripts/e2e-launch.sh                     # 重建 .agentenv/e2e 沙盒并启动（前台等待就绪后退出）
python3 scripts/e2e-check.py <结果.json>       # 只读断言，结果写 JSON；脚手架级错误才 exit 非 0
bash scripts/e2e-stop.sh                       # 只按 pidfile/进程组杀自己启动的实例
```

- 隔离沙盒固定在 `<repo>/.agentenv/e2e`（e2e-launch 内部已设
  `REELFS_AGENT_ROOT`），与 `just dev` 的 `.agentenv/home` 互不影响；
  数据入库靠 `REELFS_E2E_AUTOSCAN=1`（启动即自动全量导入，仅测试 hook，
  定义在 `src-tauri/src/main.rs`，默认关闭）。
- `REELFS_E2E_HEADLESS=1`（launch 已设）：主窗口创建后立即隐藏，不弹屏。
- 纪律：杀进程**只**用 e2e-stop.sh（按 pidfile 精确到自己的进程组），
  禁止 `pkill -x reelfs`、禁止杀 1420 已有监听——用户可能有自己的实例。
  e2e-launch 每次运行都会 `rm -rf .agentenv/e2e` 重建，里面没有需要保留
  的数据。cargo 构建与 e2e 共享 `src-tauri/target` 目录锁，并行跑会互相
  等待（就绪超时 `E2E_READY_TIMEOUT` 秒，默认 600）。
- 用例清单与期望值：`scripts/e2e-check.py`（断言依据 =
  `testdata/manifest.json`）；两轮历史报告在 `usability/e2e-round{1,2}-report.md`。

## 常用门禁命令

涉及 Rust 的门禁需要 flake.nix 里声明的构建依赖（gtk/webkit dev 包等）。
裸 shell 里用 `nix develop -c` 包一层：

```bash
npm run typecheck     # 前端 TS（不需要 dev shell）
npm run build         # 前端构建（不需要 dev shell）
npm run test          # 前端 vitest（不需要 dev shell）
nix develop -c npm run test:rust   # cargo test（src-tauri）
nix develop -c npm run lint:rust   # cargo clippy + fmt
```

（已经在 `nix develop` 里就不用再包。）`scripts/agent-env.sh run`
会自己进 dev shell，不用手动处理。

提交纪律：改动留给用户审阅，未经用户明确要求不要 commit/push。
