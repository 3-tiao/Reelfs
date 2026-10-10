# Reelfs 开发入口。
# 两个启动方式，区别在**数据目录**：
#   just dev  → 沙盒实例：config/db/cache 全在 .agentenv/，媒体是生成的样本视频。
#               agent 只能用这个（见 AGENTS.md）。
#   just run  → 真实实例：用 ~/.reelfs 和 config 里的真实媒体路径。**只给用户用**。
# 涉及 Rust 的动作都走 nix dev shell（构建依赖声明在 flake.nix）。

# 列出所有命令
default:
    @just --list

# 启动真实实例（~/.reelfs + 真实媒体路径，仅用户使用）
run: stop
    @echo "▶ 真实配置：使用 ~/.reelfs，会扫描 config.json 里的真实路径"
    nix develop -c npm run tauri dev

# 启动沙盒实例（隔离环境，agent 用这个）
dev: stop
    ./scripts/agent-env.sh run

# 停掉正在跑的实例（app 进程 + vite dev server）
stop:
    #!/usr/bin/env bash
    pkill -x reelfs 2>/dev/null || true
    pid=""
    if command -v ss >/dev/null 2>&1; then
        # Linux（iproute2）；grep -P 是 GNU grep，只有这条 Linux 分支用
        pid="$(ss -tlnp 2>/dev/null | grep ':1420' | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
    elif command -v lsof >/dev/null 2>&1; then
        # macOS
        pid="$(lsof -ti tcp:1420 -sTCP:LISTEN 2>/dev/null | head -1 || true)"
    fi
    if [ -n "${pid:-}" ]; then kill "$pid" 2>/dev/null || true; fi

# 沙盒状态（路径检查 + 样本媒体数量）
status:
    ./scripts/agent-env.sh status

# 删除整个沙盒（样本视频、测试库、日志）
clean:
    ./scripts/agent-env.sh clean

# 前端：类型检查 + 构建 + 单测
check:
    npm run typecheck
    npm run build
    npm run test

# 生成共享测试媒体数据集到指定目录（默认 .agentenv/testdata；auto 模式
# 有 ffmpeg 就生成真实视频，没有则用仓库内置微型样本）。额外参数原样透传，
# 例如 just testdata .agentenv/media --prune
testdata out=".agentenv/testdata" *args:
    python3 scripts/gen-testdata.py --out "{{out}}" {{args}}

# 前端单测
test:
    npm run test

# Rust：cargo test
test-rust:
    nix develop -c npm run test:rust

# Rust：clippy -D warnings + fmt --check
lint:
    nix develop -c npm run lint:rust

# 全部门禁（提交前跑这个）
gate: check lint test-rust
