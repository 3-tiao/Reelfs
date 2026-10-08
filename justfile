# Reelfs 开发入口。
# 沙盒机制见 AGENTS.md：run 启动的是隔离实例，config/db/cache 全在 .agentenv/，
# 不会碰 ~/.reelfs 和真实 NAS 路径。
# 涉及 Rust 的动作都走 nix dev shell（构建依赖声明在 flake.nix）。

# 列出所有命令
default:
    @just --list

# 启动 app（隔离沙盒；会先停掉已有实例，避免 1420 端口冲突）
run: stop
    ./scripts/agent-env.sh run

# 停掉 dev 实例（app 进程 + vite dev server）
stop:
    #!/usr/bin/env bash
    pkill -x reelfs 2>/dev/null || true
    pid="$(ss -tlnp 2>/dev/null | grep ':1420' | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
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
