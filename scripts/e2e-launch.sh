#!/usr/bin/env bash
# e2e-launch.sh — Reelfs 端到端：初始化隔离沙盒、后台启动应用（自动扫描导入）。
#
# 铁律（AGENTS.md，违反即事故）：
#   - 只动 <repo>/.agentenv/e2e，绝不碰 .agentenv 其他目录，绝不读写 ~/.reelfs；
#   - 不用 just run / just dev / scripts/agent-env.sh run（前两者会跑 justfile 的
#     stop 配方 pkill -x reelfs + 杀 1420 监听，会杀用户自己的实例；run 会自动
#     进 nix develop）；
#   - 只清理本脚本启动的进程（pidfile/pgidfile 记录的进程组），绝不杀 1420 上
#     已有的监听（那只可能是别人的实例）。
#
# 流程：
#   0. 预检：端口 1420 被占直接退出；残留 pid 清理；cargo/rustc 编译锁预检
#      （其他会话在编译时 tauri dev 会静默等 target 目录锁，快速失败好过
#      600s 就绪超时）；可选预热编译（E2E_WARMUP=0 关闭）；
#   1. rm -rf <repo>/.agentenv/e2e → gen-testdata 物化（默认 fast；fast 是唯一
#      能让 .mkv（mp4 字节）探出非空 duration 的模式，实测 remux/real 的
#      mkv/flv/webm 容器无 stream duration、应用探针返回 NULL）→ 模式写
#      testdata-mode 标记（e2e-check.py 按模式算探针期望值）→
#      REELFS_AGENT_ROOT=e2e scripts/agent-env.sh init（写沙盒 config.json，
#      seed 对已存在且 size 达标的文件幂等跳过）；
#   2. 媒体就位后不再腾空（第二轮起改为方案 b：应用启动即自动扫描，见下）；
#   3. eval agent-env.sh shell 导出沙盒环境（REELFS_HOME + 4 个 XDG），
#      再 export 两个 e2e 专用 env 门控（main.rs setup()，默认关闭）：
#      REELFS_E2E_AUTOSCAN=1  启动即自动 start_import（与 start_initial_scan
#        命令同一管线：NFO 解析 → 视频探针 → 缩略图 → 自动建组）。无头进程
#        外无法 invoke Tauri command，这是唯一能让探针/建组落地的入口；
#      REELFS_E2E_HEADLESS=1  主窗口创建后立即隐藏，不再在用户屏幕上弹
#        1280x800 窗口（无 WindowServer 的 Linux CI 仍需 xvfb，见 testdata/README.md）；
#   4. set -m 后台启动 npm run tauri dev（自成进程组，npm→vite→cargo→reelfs
#      全链同组），stdout/stderr 经 awk 分流写 app.log（全量）与 vite.log
#      （dev-server/错误行）；pid 写 .agentenv/e2e/app.pid，pgid 写 app.pgid；
#   5. 就绪等待（上限 E2E_READY_TIMEOUT，默认 600s）：reelfs.log 同时出现
#      '[应用启动] 文件监听器启动成功'与 '[前端] [MovieStore]'；扫描收尾
#      （'[导入管理器] 导入完成'）与断言由 scripts/e2e-check.py 负责；
#   6. touch 所有 .nfo：扫描管线已写全 NFO 元数据，这里钉住 watcher 的
#      元数据刷新路径（Modify(Data) → handle_nfo_changed，watcher.rs:204-220）。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E="$REPO/.agentenv/e2e"
PIDFILE="$E2E/app.pid"
PGIDFILE="$E2E/app.pgid"
APP_LOG="$E2E/app.log"
VITE_LOG="$E2E/vite.log"
REELFS_LOG="$E2E/home/.reelfs/logs/reelfs.log"
READY_TIMEOUT="${E2E_READY_TIMEOUT:-600}"

log() { echo "[e2e-launch] $*"; }
die() { echo "[e2e-launch] 错误: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 清理：只杀 pidfile/pgidfile 记录的、本脚本启动的进程组。
# 安全闸：pgid 必须是数字、不等于 1、不等于脚本自身进程组（防止 set -m 未生效
# 时组杀误伤调用方 shell）；不满足则退化为只杀单 pid 并警告。
# ---------------------------------------------------------------------------
kill_group() {
  local pgid=""
  if [ -f "$PGIDFILE" ]; then
    pgid="$(cat "$PGIDFILE" 2>/dev/null || true)"
  fi
  local my_pgid
  my_pgid="$(ps -o pgid= -p $$ | tr -d ' ')"
  if [[ "$pgid" =~ ^[0-9]+$ ]] && [ "$pgid" != "1" ] && [ "$pgid" != "$my_pgid" ] \
    && kill -0 -- "-$pgid" 2>/dev/null; then
    kill -TERM -- "-$pgid" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 -- "-$pgid" 2>/dev/null || break
      sleep 1
    done
    kill -KILL -- "-$pgid" 2>/dev/null || true
    log "已终止进程组 $pgid"
  fi
  rm -f "$PIDFILE" "$PGIDFILE"
}

cleanup_and_fail() {
  kill_group
  exit 1
}

# ---------------------------------------------------------------------------
# 前置预检
# ---------------------------------------------------------------------------
case "$E2E" in
  "$REPO/.agentenv/e2e") ;;
  *) die "E2E 路径异常: ${E2E}（预期 <repo>/.agentenv/e2e）" ;;
esac

for tool in npm node python3 lsof cargo; do
  command -v "$tool" >/dev/null 2>&1 || die "缺少工具: $tool"
done

# 残留 pid 预检：必须先于 rm -rf "$E2E"（否则 pidfile 被删，残留进程成孤儿）
if [ -f "$PIDFILE" ]; then
  old_pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    echo "[e2e-launch] 错误: 上一轮 e2e 实例仍在运行 (pid $old_pid)，先清理自己的进程组后退出" >&2
    kill_group
    exit 1
  fi
  rm -f "$PIDFILE" "$PGIDFILE"
fi

# 端口预检：被占直接报错退出，绝不杀已有监听（可能是用户自己的实例）
if lsof -ti tcp:1420 -sTCP:LISTEN >/dev/null 2>&1; then
  die "端口 1420 已被占用（可能是用户自己的 Reelfs/vite 实例），拒绝启动"
fi

# cargo 编译锁预检：其他会话在跑 cargo test/clippy/tauri dev 时，本脚本的
# tauri dev 会静默阻塞等 src-tauri/target 目录锁，在 600s 就绪超时里极难分
# 辨『慢』与『死锁』——直接快速失败并指明原因。
if pgrep -fl 'cargo|rustc' >/dev/null 2>&1; then
  echo "[e2e-launch] 错误: 检测到正在运行的 cargo/rustc（会持有 target 目录锁，tauri dev 将一直等待）:" >&2
  pgrep -fl 'cargo|rustc' | sed 's/^/    /' >&2
  die "等上述编译结束（或停掉它）后重跑本脚本"
fi

# 可选预热编译（E2E_WARMUP=0 关闭）：把 debug 产物的编译+链接移出就绪等待
# 窗口。与 tauri dev 共用 src-tauri/target；环境有差异时 tauri dev 最多重编
# reelfs 壳子，依赖缓存照常复用。
if [[ "${E2E_WARMUP:-1}" != "0" ]]; then
  log "预热编译 cargo build --bin reelfs（E2E_WARMUP=0 可跳过）…"
  warm_start=$SECONDS
  if ! cargo build --manifest-path "$REPO/src-tauri/Cargo.toml" --bin reelfs; then
    die "预热编译失败（编译错误与 e2e 无关，先修编译）"
  fi
  log "预热完成（耗时 $((SECONDS - warm_start))s）"
fi

trap 'log "收到中断信号，清理自己的进程组"; kill_group; exit 130' INT TERM

# ---------------------------------------------------------------------------
# 步骤 1：重建沙盒（只动 e2e 子目录）
# ---------------------------------------------------------------------------
log "重建沙盒: rm -rf ${E2E}（精确到 e2e，不动 .agentenv 其他内容）"
rm -rf "$E2E"
mkdir -p "$E2E/media"

# fast 模式预物化（秒级，复制内置 sample.mp4）：之后 init 的 auto→real 对
# 已存在且 size≥4096 的视频 / size≥512 的海报幂等跳过（gen-testdata.py），
# 避免 real 模式逐条编码 37 个视频的 1-3 分钟。
# 模式写入 testdata-mode 标记，e2e-check.py 据此计算探针期望值（fast 下
# 所有非损坏视频探出同一组 4/320/180；要换模式改这里并同步 e2e-check）。
DATASET_MODE=fast
log "物化测试数据集（--mode ${DATASET_MODE}）→ $E2E/media"
python3 "$REPO/scripts/gen-testdata.py" --out "$E2E/media" --mode "$DATASET_MODE"
echo "$DATASET_MODE" >"$E2E/testdata-mode"

log "初始化沙盒配置 (REELFS_AGENT_ROOT=$E2E agent-env.sh init)"
REELFS_AGENT_ROOT="$E2E" "$REPO/scripts/agent-env.sh" init

# ---------------------------------------------------------------------------
# 步骤 2：（第二轮起无此步）媒体保持就位。应用启动即通过
# REELFS_E2E_AUTOSCAN 自动扫描导入（见步骤 3），不再走第一轮的
# staging 腾空 + cp 注入——watcher 增量路径不探测视频三列也不建组，
# 探针/分组用例必须有扫描管线。watcher 路径仍被步骤 6 的 touch .nfo 覆盖。
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 步骤 3：导出沙盒环境（REELFS_HOME + XDG_*，全部指向 $E2E/home）+
# e2e 专用 env 门控（main.rs setup() 识别，默认关闭，正常启动不受影响）
# ---------------------------------------------------------------------------
eval "$(REELFS_AGENT_ROOT="$E2E" "$REPO/scripts/agent-env.sh" shell)"
export REELFS_E2E_AUTOSCAN=1
export REELFS_E2E_HEADLESS=1
log "沙盒环境: REELFS_HOME=$REELFS_HOME REELFS_E2E_AUTOSCAN=1 REELFS_E2E_HEADLESS=1"

# ---------------------------------------------------------------------------
# 步骤 4：后台启动（set -m 自建进程组；npm→vite(1420)→cargo→reelfs 全链同组）
# stdout/stderr 合流经 awk 分流：app.log 全量，vite.log 收 dev-server/错误行
# ---------------------------------------------------------------------------
cd "$REPO"
log "后台启动 npm run tauri dev（REELFS_E2E_HEADLESS=1，主窗口创建后即隐藏）"
set -m
npm run tauri dev \
  > >(awk -v app="$APP_LOG" -v vite="$VITE_LOG" '
        {
          print >> app; fflush(app)
          if ($0 ~ /(VITE|vite|Local:|1420|BeforeDevCommand|ready in|[Ee]rror|ERROR|[Ww]arning)/) {
            print >> vite; fflush(vite)
          }
        }') \
  2>&1 &
APP_PID=$!
set +m
echo "$APP_PID" >"$PIDFILE"

pgid="$(ps -o pgid= -p "$APP_PID" 2>/dev/null | tr -d ' ' || true)"
my_pgid="$(ps -o pgid= -p $$ | tr -d ' ')"
if [ "$pgid" = "$APP_PID" ] && [ "$pgid" != "$my_pgid" ]; then
  echo "$pgid" >"$PGIDFILE"
  log "应用进程组: pgid=${pgid}（pidfile=${PIDFILE}）"
else
  echo "[e2e-launch] 警告: 进程组异常 (pgid='$pgid' pid='$APP_PID' 自身组='$my_pgid')，e2e-stop 将退化为单进程清理" >&2
fi

# ---------------------------------------------------------------------------
# 步骤 5：就绪等待（两条件都满足才算就绪；超时清理自己并 exit 1）
#   (1) reelfs.log 出现 '[应用启动] 文件监听器启动成功'（main.rs:1203，先于事件循环）
#   (2) reelfs.log 出现 '[前端] [MovieStore]'（webview 真正起来）
# ---------------------------------------------------------------------------
log "等待应用就绪（上限 ${READY_TIMEOUT}s；首次 cargo 链接 1-3 分钟，target 冷则 5-15 分钟）…"
ready_start=$SECONDS
while :; do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "[e2e-launch] 错误: npm run tauri dev (pid $APP_PID) 提前退出，疑似编译/启动失败" >&2
    echo "---- $APP_LOG 尾部 ----" >&2
    tail -n 40 "$APP_LOG" 2>/dev/null | sed 's/^/    /' >&2
    cleanup_and_fail
  fi
  if grep -qF '[应用启动] 文件监听器启动成功' "$REELFS_LOG" 2>/dev/null \
    && grep -qF '[前端] [MovieStore]' "$REELFS_LOG" 2>/dev/null; then
    break
  fi
  if (( SECONDS - ready_start >= READY_TIMEOUT )); then
    echo "[e2e-launch] 错误: ${READY_TIMEOUT}s 内未观察到就绪信号" >&2
    echo "  就绪判据: reelfs.log 需同时包含 '[应用启动] 文件监听器启动成功' 与 '[前端] [MovieStore]'" >&2
    echo "  提示: 若其他会话正在跑 cargo test/clippy，tauri dev 会阻塞等 target 目录锁；" >&2
    echo "        排查: ps aux | grep -E 'cargo|rustc'" >&2
    echo "---- $REELFS_LOG 尾部 ----" >&2
    tail -n 30 "$REELFS_LOG" 2>/dev/null | sed 's/^/    /' >&2
    echo "---- $APP_LOG 尾部 ----" >&2
    tail -n 30 "$APP_LOG" 2>/dev/null | sed 's/^/    /' >&2
    cleanup_and_fail
  fi
  sleep 5
done
log "应用就绪（耗时 $((SECONDS - ready_start))s，pid ${APP_PID}）"

# ---------------------------------------------------------------------------
# 步骤 6：touch 所有 .nfo——钉住 watcher 的元数据刷新路径（Modify(Data) →
# handle_nfo_changed → refresh_movie_metadata_for_video，watcher.rs:204-220；
# 只更新元数据列，不动探针三列/缩略图/分组）。元数据本体已由启动扫描写入。
# ---------------------------------------------------------------------------
log "touch 所有 .nfo（覆盖 watcher 元数据刷新路径）"
find "$E2E/media" -name '*.nfo' -exec touch {} \;

log "完成。应用继续运行 (pid $APP_PID)，REELFS_E2E_AUTOSCAN 的导入已在后台进行；"
log "入库/扫描完成等待与断言由 scripts/e2e-check.py 负责，停止用 scripts/e2e-stop.sh"
exit 0
