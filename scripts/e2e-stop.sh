#!/usr/bin/env bash
# e2e-stop.sh — 停止 e2e-launch.sh 启动的 Reelfs 沙盒实例。
#
# 只按 pidfile/pgidfile 杀自己启动的进程组（npm→vite→cargo→reelfs 全链同组）；
# 禁止 pkill -x reelfs；禁止杀 1420 端口上任何监听——那可能是用户自己的实例
# （justfile 的 stop 配方就是必须避开的反面教材）。
# 沙盒数据保留在 <repo>/.agentenv/e2e 供诊断，不做数据清理。
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E="$REPO/.agentenv/e2e"
PIDFILE="$E2E/app.pid"
PGIDFILE="$E2E/app.pgid"

log() { echo "[e2e-stop] $*"; }

if [ ! -f "$PIDFILE" ]; then
  log "无 pidfile($PIDFILE)：没有需要停止的 e2e 实例"
  exit 0
fi

pid="$(cat "$PIDFILE" 2>/dev/null || true)"
pgid=""
[ -f "$PGIDFILE" ] && pgid="$(cat "$PGIDFILE" 2>/dev/null || true)"
if [ -z "$pgid" ] && [ -n "$pid" ]; then
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
fi

# 自身进程组（绝不组杀自己所在的组，防误伤调用方 shell）
my_pgid="$(ps -o pgid= -p $$ | tr -d ' ')"

group_alive() {
  [ -n "${1:-}" ] && kill -0 -- "-$1" 2>/dev/null
}

if [[ "$pgid" =~ ^[0-9]+$ ]] && [ "$pgid" != "1" ] && [ "$pgid" != "$my_pgid" ]; then
  if group_alive "$pgid"; then
    log "向进程组 $pgid 发送 TERM（只限 e2e-launch 启动的组）"
    kill -TERM -- "-$pgid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      group_alive "$pgid" || break
      sleep 1
    done
    if group_alive "$pgid"; then
      log "组内仍有进程，KILL 兜底（仍只限该组）"
      kill -KILL -- "-$pgid" 2>/dev/null || true
    fi
    log "进程组 $pgid 已停止"
  else
    log "进程组 $pgid 已无存活进程"
  fi
elif [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  echo "[e2e-stop] 警告: pgid 异常(pgid='${pgid}')，仅终止单进程 ${pid}；如有残留请手工检查" >&2
  kill -TERM "$pid" 2>/dev/null || true
  sleep 3
  kill -KILL "$pid" 2>/dev/null || true
else
  log "进程 $pid 已不在运行"
fi

rm -f "$PIDFILE" "$PGIDFILE"
log "完成（沙盒数据保留在 $E2E 供诊断；数据清理由外层决定是否 rm -rf 精确到该目录）"
