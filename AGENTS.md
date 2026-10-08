# AGENTS.md — Agent 工作规则（Reelfs）

## 铁律：不要碰用户的真实 Reelfs 数据

用户的真实资源只有一处入口，agent 一律不得读写：

- `~/.reelfs/`（config.json、movies.db、缩略图缓存、logs）
- 用户 config.json 里 `nas_paths` 指向的真实 NAS / 本地媒体目录

任何会**启动 Reelfs 应用**的操作（可用性测试、UI 验证、手动跑、扫描媒体库），
必须走隔离沙盒：

```bash
scripts/agent-env.sh run      # 初始化沙盒并启动应用（REELFS_HOME 已指向沙盒）
scripts/agent-env.sh status   # 查看沙盒状态
scripts/agent-env.sh clean    # 测试完清理整个沙盒
```

沙盒在 `<repo>/.agentenv/`（gitignored）：应用把 config/db/cache/logs 全部写进
`.agentenv/home/.reelfs/`，媒体库指向 `.agentenv/media/` 里脚本生成的微型样本
视频。实现见 `src-tauri/src/path_utils.rs` 的 `reelfs_base_dir`（`REELFS_HOME`
环境变量覆盖 `HOME`）。

不要绕过脚本直接 `npm run tauri dev` / `cargo run`——那样应用会落到真实的
`~/.reelfs` 上（包括启动时的日志写入）。

## 测试数据

- 需要媒体文件时，用 `scripts/agent-env.sh init` 生成的样本，或往
  `.agentenv/media/` 放自建的微型文件；不要复制用户真实影片。
- 单元测试一律用 temp 目录，不落 `~`。

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
