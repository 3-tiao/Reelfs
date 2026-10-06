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
seed_media() {
  local ff
  ff="$(command -v ffmpeg || true)"
  [[ -n "$ff" ]] || {
    log "未找到 ffmpeg，跳过样本媒体生成（应用仍可启动，库里会是空/占位文件）"
    mkdir -p "$MEDIA_DIR"
    touch "$MEDIA_DIR/placeholder-sample.mp4"
    return 0
  }

  mkdir -p "$MEDIA_DIR/系列/流浪地球三部曲" "$MEDIA_DIR/Collections/Sci-Fi"

  # 6 秒测试画面 + 静音音轨，足够索引、出缩略图、可播放，又几乎不占空间
  gen() { # gen <相对路径>
    local out="$MEDIA_DIR/$1"
    # 已有同名文件且体积正常才复用：上次失败的 0 字节/截断残留要重新生成
    if [[ -f "$out" ]] && (( $(wc -c < "$out") >= 10240 )); then
      return 0
    fi
    rm -f "$out"
    # 容器差异：webm 只收 vp8/vp9 + vorbis/opus，其余用 h264/aac
    local codecs=(-c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac)
    if [[ "$out" == *.webm ]]; then
      codecs=(-c:v libvpx -b:v 512k -c:a libvorbis)
    fi
    "$ff" -loglevel error -y \
      -f lavfi -i "testsrc=duration=6:size=640x360:rate=24" \
      -f lavfi -i "sine=frequency=440:duration=6" \
      "${codecs[@]}" -shortest "$out"
    log "  已生成 $1"
  }

  gen "Agent 测试影片 A.mp4"
  gen "Agent 测试影片 B.mp4"
  gen "sample-movie-c.mp4"
  gen "sample-movie-d.mkv"
  gen "系列/流浪地球三部曲/流浪地球 1.mp4"
  gen "系列/流浪地球三部曲/流浪地球 2.mp4"
  gen "Collections/Sci-Fi/sample-movie-e.mp4"
  gen "Collections/Sci-Fi/sample-movie-f.webm"

  # 非视频干扰文件：验证索引器不会误收
  echo "not a video" > "$MEDIA_DIR/readme.txt"
}

write_config() {
  mkdir -p "$SANDBOX_HOME/.reelfs"
  cat > "$CONFIG" <<JSON
{
  "nas_paths": ["$MEDIA_DIR"],
  "cache_dir": "$SANDBOX_HOME/.reelfs/cache",
  "db_path": "$SANDBOX_HOME/.reelfs/movies.db",
  "scan_on_startup": true,
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
cmd_shell() {
  cat <<ENV
export REELFS_HOME="$SANDBOX_HOME"
ENV
}

cmd_run() {
  cmd_init
  log "启动 Reelfs（REELFS_HOME=${SANDBOX_HOME}）…"
  (cd "$REPO_ROOT" && REELFS_HOME="$SANDBOX_HOME" npm run tauri dev)
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
  log "样本媒体: $(find "$MEDIA_DIR" -type f \( -name '*.mp4' -o -name '*.mkv' -o -name '*.webm' \) 2>/dev/null | wc -l | tr -d ' ') 个视频文件"
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
