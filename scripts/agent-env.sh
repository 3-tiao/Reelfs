#!/usr/bin/env bash
# Agent 专用隔离环境：把 Reelfs 的全部读写（config / 数据库 / 缩略图缓存 /
# 日志 / 媒体库）都关进仓库内的 .agentenv/ 沙盒，绝不触碰真实的 ~/.reelfs
# 和用户 NAS 媒体。
#
# 用法：
#   scripts/agent-env.sh init     # 初始化沙盒（目录 + 样本媒体 + config.json）
#   scripts/agent-env.sh run      # init 后以沙盒环境启动 Reelfs（tauri dev）
#   scripts/agent-env.sh shell    # 输出 export 语句，供 eval 注入环境变量
#   scripts/agent-env.sh status   # 查看沙盒状态
#   scripts/agent-env.sh clean    # 删除整个沙盒
#
# 原理：应用进程收到 REELFS_HOME 后，config.json（及默认 db/cache/logs）
# 都落在 $REELFS_HOME/.reelfs/ 下（见 src-tauri/src/path_utils.rs）。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_ROOT="${REELFS_AGENT_ROOT:-$REPO_ROOT/.agentenv}"
SANDBOX_HOME="$AGENT_ROOT/home"
MARKER="$AGENT_ROOT/SANDBOX.md"
MEDIA_DIR="$AGENT_ROOT/media"
CONFIG="$SANDBOX_HOME/.reelfs/config.json"

log() { echo "[agent-env] $*"; }
die() { echo "[agent-env] 错误: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 防呆检查：沙盒必须和真实资源分开
# ---------------------------------------------------------------------------
check_safety() {
  local real_home
  real_home="$(cd "$HOME" && pwd)"
  mkdir -p "$AGENT_ROOT"
  local sandbox
  sandbox="$(cd "$AGENT_ROOT" && pwd)"
  [[ "$sandbox" != "$real_home" ]] ||
    die "沙盒目录不能是用户主目录"
  [[ "$sandbox" != "$real_home/.reelfs" ]] ||
    die "沙盒目录不能是真实的 ~/.reelfs"
}

# 已有 config.json 里的路径必须仍在沙盒内（防止陈旧配置把真实库挂进来）：
# db/cache 归 $SANDBOX_HOME（home/），媒体 nas_paths 归 $AGENT_ROOT（.agentenv/）。
# 不满足时拒绝启动，除非 --reseed 强制重写。
check_config_is_sandboxed() {
  [[ -f "$CONFIG" ]] || return 0
  python3 - "$CONFIG" "$SANDBOX_HOME" "$AGENT_ROOT" <<'PY'
import json, sys, os
config_path, home, root = sys.argv[1], os.path.abspath(sys.argv[2]), os.path.abspath(sys.argv[3])
with open(config_path) as f:
    cfg = json.load(f)
bad = [k for k in ("db_path", "cache_dir")
       if not os.path.abspath(cfg.get(k, "")).startswith(home + os.sep)]
nas = [p for p in cfg.get("nas_paths", [])
       if not os.path.abspath(p).startswith(root + os.sep)]
problems = bad + ["nas_paths: " + ", ".join(nas)] if nas else bad
if problems:
    print("; ".join(problems))
    sys.exit(1)
PY
}

# ---------------------------------------------------------------------------
# init：目录 + 样本媒体 + 沙盒 config.json
# ---------------------------------------------------------------------------
# 样本媒体来自共享测试数据集（testdata/manifest.json），由
# scripts/gen-testdata.py 物化：沙盒里找得到 ffmpeg（dev shell 自带）就生成
# 真实可播放视频，否则回退到仓库内置的微型样本。ffmpeg 的查找逻辑（PATH
# → nix develop 回退）在生成器里。
seed_media() {
  if ! command -v python3 >/dev/null 2>&1; then
    log "未找到 python3，跳过样本媒体生成（应用仍可启动，库里会是空/占位文件）"
    mkdir -p "$MEDIA_DIR"
    touch "$MEDIA_DIR/placeholder-sample.mp4"
    return 0
  fi
  # 之前没 ffmpeg 时留下的 0 字节占位文件会让索引器报错，有真样本后删掉
  rm -f "$MEDIA_DIR/placeholder-sample.mp4"
  python3 "$REPO_ROOT/scripts/gen-testdata.py" --out "$MEDIA_DIR"
}

write_config() {
  mkdir -p "$SANDBOX_HOME/.reelfs"
  cat > "$CONFIG" <<JSON
{
  "nas_paths": ["$MEDIA_DIR"],
  "cache_dir": "$SANDBOX_HOME/.reelfs/cache",
  "db_path": "$SANDBOX_HOME/.reelfs/movies.db",
  "auto_generate_thumbnails": true,
  "theme": "dark",
  "default_player": "system"
}
JSON
}

cmd_init() {
  check_safety
  mkdir -p "$SANDBOX_HOME/.reelfs" "$MEDIA_DIR"

  if [[ ! -f "$MARKER" ]]; then
    cat > "$MARKER" <<MD
# Agent 沙盒（可整体删除）

本目录是 agent 测试专用隔离环境，由 scripts/agent-env.sh 管理和创建。
里面只有生成的样本视频和测试数据库，删除不影响真实 Reelfs 数据
（真实数据在 ~/.reelfs 与用户 NAS 路径）。

清理：scripts/agent-env.sh clean
MD
  fi

  if [[ -f "$CONFIG" ]]; then
    if ! bad="$(check_config_is_sandboxed 2>&1)"; then
      die "已有 config.json 指向沙盒外路径，拒绝复用: ${bad}（可用 --reseed 重写）"
    fi
    log "config.json 已存在且指向沙盒内，保留"
  else
    write_config
    log "已写入沙盒 config.json"
  fi

  log "生成样本媒体 → $MEDIA_DIR"
  seed_media
  log "沙盒就绪: $AGENT_ROOT"
}

# ---------------------------------------------------------------------------
# run / shell / status / clean
# ---------------------------------------------------------------------------
# 沙盒环境变量。REELFS_HOME 只盖住 reelfs 自己的 config/db/cache；
# Tauri（窗口状态）和 WebKit（localstorage 等）还会按 XDG 规范写到
# $XDG_CONFIG_HOME / $XDG_DATA_HOME —— 不一起改就会落到真实家目录，
# 那就不是沙盒了。
sandbox_env() {
  cat <<ENV
REELFS_HOME=$SANDBOX_HOME
XDG_CONFIG_HOME=$SANDBOX_HOME/.config
XDG_DATA_HOME=$SANDBOX_HOME/.local/share
XDG_CACHE_HOME=$SANDBOX_HOME/.cache
XDG_STATE_HOME=$SANDBOX_HOME/.local/state
ENV
}

cmd_shell() {
  sandbox_env | sed 's/^/export /'
}

cmd_run() {
  # cargo 需要的构建工具链/依赖在 flake.nix 里声明（Linux 是 GTK/webkit dev
  # 依赖 + GSETTINGS_SCHEMA_DIR；macOS 只需 rust 工具链，webview 用系统
  # WKWebView）；不在 nix shell 里就先进去（IN_NIX_SHELL 由 nix develop/
  # nix-shell 设置，可防递归）。
  if [[ -z "${IN_NIX_SHELL:-}" && -f "$REPO_ROOT/flake.nix" ]] && command -v nix >/dev/null 2>&1; then
    log "进入 nix dev shell（flake.nix 声明的构建依赖）后再启动"
    exec nix develop "$REPO_ROOT" -c bash "$0" run
  fi
  cmd_init
  # GSETTINGS_SCHEMA_DIR 只在 Linux 上需要（见 flake.nix）：没有它 GTK 读不到
  # 字体缩放，WebKitGTK 会把 device scale factor 算成负数，webview 视口整个崩。
  if [[ "$(uname -s)" == "Linux" && -z "${GSETTINGS_SCHEMA_DIR:-}" ]]; then
    log "警告：GSETTINGS_SCHEMA_DIR 未设置，GTK/WebKitGTK 可能算错视口尺寸"
  fi
  log "启动 Reelfs（REELFS_HOME=${SANDBOX_HOME}）…"
  # shellcheck disable=SC2046
  (cd "$REPO_ROOT" && env $(sandbox_env | tr '\n' ' ') npm run tauri dev)
}

cmd_status() {
  log "沙盒根: $AGENT_ROOT"
  log "REELFS_HOME: $SANDBOX_HOME"
  if [[ -f "$CONFIG" ]]; then
    log "config.json: 存在"
    check_config_is_sandboxed &&
      log "config.json 路径检查: 全部在沙盒内" ||
      log "config.json 路径检查: 存在沙盒外路径（危险！）"
  else
    log "config.json: 不存在（尚未 init）"
  fi
  log "样本媒体: $(find "$MEDIA_DIR" -type f \( -name '*.mp4' -o -name '*.mkv' -o -name '*.webm' -o -name '*.avi' -o -name '*.mov' -o -name '*.wmv' -o -name '*.flv' -o -name '*.m4v' \) 2>/dev/null | wc -l | tr -d ' ') 个视频文件"
  [[ -d "$REPO_ROOT/.reelfs" ]] && log "仓库根存在 .reelfs 目录（历史遗留），与沙盒无关"
  return 0
}

cmd_clean() {
  check_safety
  [[ -f "$MARKER" ]] || die "$AGENT_ROOT 缺少 SANDBOX.md 标记，不像 agent 沙盒，拒绝删除"
  rm -rf "$AGENT_ROOT"
  log "沙盒已删除"
}

main() {
  local action="${1:-help}"
  case "$action" in
    init)    [[ "${2:-}" == "--reseed" ]] && rm -f "$CONFIG"; cmd_init ;;
    run)     cmd_run ;;
    shell)   cmd_shell ;;
    status)  cmd_status ;;
    clean)   cmd_clean ;;
    help|*)  sed -n '6,11p' "${BASH_SOURCE[0]}" | sed 's/^# //' ;;
  esac
}

main "$@"
