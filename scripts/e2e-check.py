#!/usr/bin/env python3
"""Reelfs 端到端只读断言。

用法: python3 scripts/e2e-check.py <结果JSON输出路径>

前置: scripts/e2e-launch.sh 已在隔离沙盒 (<repo>/.agentenv/e2e) 启动应用。
  第二轮起应用以 REELFS_E2E_AUTOSCAN=1 启动（main.rs setup() 的 env 门控），
  启动即走 start_initial_scan 同款导入管线：NFO 解析 → 视频探针 → 缩略图 →
  自动建组；launch 末尾 touch 所有 .nfo 覆盖 watcher 元数据刷新路径。

断言对象（全部只读）:
  - <repo>/.agentenv/e2e/home/.reelfs/movies.db   （sqlite3 只读 URI，WAL 下外部
    只读连接与应用并发写互不阻塞，database.rs:169-171 busy_timeout=10s）
  - <repo>/.agentenv/e2e/home/.reelfs/cache/thumbnails/
  - <repo>/.agentenv/e2e/testdata-mode            （launch 写入的数据集模式标记）
  - testdata/manifest.json 的 expect 字段

等待策略: 先等 movies 行数达 manifest 视频数且稳定，再等 reelfs.log 出现
  '[导入管理器] 导入完成'——探针/建组发生在行数到齐之后，只等 COUNT 会拿
  不到终态。

退出码: 0 = 断言流程完整跑完（用例 pass/fail/skipped 以结果 JSON 为准）;
        2 = 脚手架级错误（DB 缺失/结构不对/manifest 不可读/结果路径不可写）。
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import unicodedata
import urllib.parse
from collections import Counter
from pathlib import Path

# 注意用 absolute() 而非 resolve()：库内 file_path / thumbnail_path 由应用按
# config.json 的写入形式（agent-env.sh 的 logical pwd）存储，resolve() 会解析
# symlink（如 macOS /tmp → /private/tmp）导致字符串前缀比对误判；配合
# media_prefixes() 的 realpath 兜底，两种形式都能匹配。
REPO = Path(__file__).absolute().parent.parent
E2E = REPO / ".agentenv" / "e2e"
DB_PATH = E2E / "home" / ".reelfs" / "movies.db"
MEDIA_ROOT = E2E / "media"
THUMB_ROOT = E2E / "home" / ".reelfs" / "cache" / "thumbnails"
MANIFEST_PATH = REPO / "testdata" / "manifest.json"
REELFS_LOG = E2E / "home" / ".reelfs" / "logs" / "reelfs.log"
MODE_MARKER = E2E / "testdata-mode"

EXPECTED_COUNT = 37  # manifest 中 kind==video 条目数（Kodi 6 + 平铺 15 + 系列 15 + 深嵌套 1）
INGEST_TIMEOUT = 120  # 入库等待上限（秒）
STABLE_SECS = 5  # 行数稳定窗口（秒）
POLL_INTERVAL = 3

# 扫描收尾标志（import_manager.rs run_import_process 末尾的 info 日志）。
SCAN_DONE_MARK = "[导入管理器] 导入完成"

# 探针期望（应用 get_video_info 要求 ffprobe stream 级 duration>0 才算成功，
# indexer.rs:385-393）。实测（2026-10，本机 ffmpeg/ffprobe）各模式 stream=
# duration 结果：mkv（matroska）/flv/webm 的 duration 只在容器级、stream 级
# 为 N/A——fast 模式下这些扩展名的内容其实是 mp4 字节，ffprobe 按内容读得出
# 4/320/180；remux/real 模式是真容器，探不到时长 → 三列 NULL。这是应用探针
# 的真实局限（testdata/README.md 已知差异），不是数据集缺陷。
SAMPLE_PROBE = (4, 320, 180)  # testdata/blobs/sample.mp4 的实际值
PROBE_NULL_EXTS = {"remux": {"mkv", "flv", "webm"}, "real": {"mkv", "flv", "webm"}}


def dataset_mode() -> str:
    """launch 写入的数据集模式标记；缺省按 fast（PROBE-01 期望值依模式而变）。"""
    try:
        return MODE_MARKER.read_text(encoding="utf-8").strip() or "fast"
    except OSError:
        return "fast"


def expected_probe(mode: str, entry: dict, defaults: dict):
    """manifest 视频条目 → 探针三列期望值（None 表示应保持 NULL）。"""
    if entry.get("corrupt") or entry.get("empty"):
        return None
    ext = Path(entry["path"]).suffix.lstrip(".").lower()
    if mode == "fast":
        return SAMPLE_PROBE
    if ext in PROBE_NULL_EXTS.get(mode, set()):
        return None
    if mode == "remux":
        return SAMPLE_PROBE
    # real：按 manifest 条目（default 4 / [320,180]）
    dur = int(entry.get("duration_seconds", defaults.get("duration_seconds", 4)))
    w, h = entry.get("resolution", defaults.get("resolution", [320, 180]))
    return (dur, int(w), int(h))


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def media_prefixes() -> list[str]:
    """媒体根前缀的两种形式：脚本定位用的逻辑路径与 realpath（macOS 上 /tmp 与
    /private/tmp 这类 symlink 差异会让字符串前缀比对误判，库内路径由应用按
    config.json 的写入形式存储）。"""
    out = []
    for c in (str(MEDIA_ROOT), os.path.realpath(MEDIA_ROOT)):
        s = nfc(c) + "/"
        if s not in out:
            out.append(s)
    return out


def thumb_candidates(movie_id: int) -> set[str]:
    out = set()
    for base in (str(THUMB_ROOT), os.path.realpath(THUMB_ROOT)):
        out.add(nfc(f"{base}/{movie_id}.jpg"))
    return out


def scaffold_fail(msg: str) -> "None":
    print(f"[e2e-check] 脚手架错误: {msg}", file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------------------
# 前置：打开 DB、加载 manifest
# ---------------------------------------------------------------------------
def open_db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        scaffold_fail(f"数据库不存在: {DB_PATH}（请先跑 scripts/e2e-launch.sh）")
    uri = "file:" + urllib.parse.quote(str(DB_PATH)) + "?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=10)
        conn.execute("SELECT 1 FROM movies LIMIT 1")
    except sqlite3.Error as e:
        scaffold_fail(f"打开/查询 movies.db 失败: {e}")
    missing = {
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE name IN "
            "('movies','movie_fts','video_groups','video_parts')"
        )
    }
    need = {"movies", "movie_fts", "video_groups", "video_parts"} - missing
    if need:
        scaffold_fail(f"数据库缺少表: {sorted(need)}（结构不对）")
    return conn


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        scaffold_fail(f"manifest 不存在: {MANIFEST_PATH}")
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        scaffold_fail(f"manifest 读取/解析失败: {e}")


# ---------------------------------------------------------------------------
# 等待入库：COUNT==37 且稳定 STABLE_SECS 秒；超时也继续跑（用例自然 fail）
# ---------------------------------------------------------------------------
def wait_ingest(conn: sqlite3.Connection) -> dict:
    t0 = time.monotonic()
    first_hit = None
    count = -1
    last_printed = -1
    while True:
        count = conn.execute("SELECT COUNT(*) FROM movies").fetchone()[0]
        now = time.monotonic()
        if count != last_printed:
            print(f"[e2e-check] 入库进度: {count}/{EXPECTED_COUNT}")
            last_printed = count
        if count == EXPECTED_COUNT:
            if first_hit is None:
                first_hit = now
            if now - first_hit >= STABLE_SECS:
                return {"count": count, "waited_s": round(now - t0, 1), "stable": True}
        else:
            first_hit = None
        if now - t0 >= INGEST_TIMEOUT:
            return {"count": count, "waited_s": round(now - t0, 1), "stable": False}
        time.sleep(POLL_INTERVAL)


# ---------------------------------------------------------------------------
# 等待扫描收尾：行数到齐后探针/缩略图/建组才依次发生，必须等完成日志。
# ---------------------------------------------------------------------------
def wait_scan_done() -> bool:
    t0 = time.monotonic()
    while time.monotonic() - t0 < INGEST_TIMEOUT:
        try:
            text = REELFS_LOG.read_text(encoding="utf-8", errors="replace")
        except OSError:
            text = ""
        if SCAN_DONE_MARK in text:
            return True
        time.sleep(POLL_INTERVAL)
    return False


# ---------------------------------------------------------------------------
# 快照与工具
# ---------------------------------------------------------------------------
MOVIE_COLS = (
    "id,file_path,title,year,plot,rating,genres,director,actors,thumbnail_path,"
    "duration_seconds,width,height,group_id"
)


def snapshot(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(f"SELECT {MOVIE_COLS} FROM movies ORDER BY id").fetchall()
    cols = MOVIE_COLS.split(",")
    return [dict(zip(cols, r)) for r in rows]


def by_path_sub(sn: list[dict], needle: str) -> list[dict]:
    """等价于 SQL LIKE '%needle%'，但避免 LIKE 的 _/% 通配与大小写语义（python 侧
    NFC 子串匹配与库内 NFC 存储一致，path_utils.rs:8-10）。"""
    n = nfc(needle)
    return [m for m in sn if n in nfc(m["file_path"])]


def rows_by_rel(sn: list[dict]) -> dict[str, dict]:
    """媒体根相对路径（NFC）→ 行。库内 file_path 按 config.json 的写入形式存储，
    前缀剥离复用 media_prefixes() 的 realpath 兜底。"""
    out = {}
    for m in sn:
        p = nfc(m["file_path"])
        for pre in media_prefixes():
            if p.startswith(pre):
                out[p[len(pre):]] = m
                break
    return out


def group_expectations(manifest: dict) -> dict[str, list]:
    """manifest → {组名(NFC): [(part, 相对路径), ...]}（按 part 升序）。"""
    exp: dict[str, list] = {}
    for e in manifest["files"]:
        if e.get("kind") != "video":
            continue
        g = (e.get("expect") or {}).get("group")
        if g:
            exp.setdefault(nfc(g), []).append((int(e["expect"]["part"]), nfc(e["path"])))
    for v in exp.values():
        v.sort()
    return exp


def fts_match(conn: sqlite3.Connection, query: str) -> list[str]:
    sql = (
        "SELECT m.file_path FROM movie_fts JOIN movies m ON m.id = movie_fts.rowid "
        "WHERE movie_fts MATCH ?"
    )
    try:
        return [r[0] for r in conn.execute(sql, (query,))]
    except sqlite3.Error as e:
        raise AssertionError(f"FTS 查询失败 ({query!r}): {e}") from e


def fmt_row(m: dict) -> str:
    keys = ("title", "year", "plot", "rating", "genres", "director", "actors")
    body = ", ".join(f"{k}={m.get(k)!r}" for k in keys)
    return f"[{m['id']}] {m['file_path']} ({body})"


# ---------------------------------------------------------------------------
# 用例实现：每个函数返回 (status, detail)，status ∈ pass|fail|skipped
# ---------------------------------------------------------------------------
def check_scan_01(conn, sn, manifest, ingest):
    videos = [e for e in manifest["files"] if e.get("kind") == "video"]
    expected = {nfc(e["path"]) for e in videos}
    prefixes = media_prefixes()
    actual = set()
    outside = []
    for m in sn:
        p = nfc(m["file_path"])
        for pre in prefixes:
            if p.startswith(pre):
                actual.add(p[len(pre):])
                break
        else:
            outside.append(m["file_path"])
    problems = []
    if len(sn) != EXPECTED_COUNT:
        problems.append(f"行数 {len(sn)} != {EXPECTED_COUNT}")
    if outside:
        problems.append(f"媒体根之外的路径 {len(outside)} 条: {outside[:3]}")
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing:
        problems.append(f"缺失 {len(missing)} 个: {missing[:5]}")
    if extra:
        problems.append(f"多出 {len(extra)} 个（含干扰文件混入）: {extra[:5]}")
    if problems:
        return "fail", "; ".join(problems) + f"（入库等待终态: {ingest}）"
    return "pass", (
        f"恰 {EXPECTED_COUNT} 行，file_path 集合与 manifest 完全一致"
        f"（{len([e for e in manifest['files'] if e.get('kind') == 'file'])} 个干扰文件零混入）"
    )


def check_nfo_common(sn, manifest, path_needle, with_plot=True):
    rows = by_path_sub(sn, path_needle)
    if len(rows) != 1:
        return None, f"按路径子串 {path_needle!r} 应恰命中 1 行，实际 {len(rows)} 行: " + "; ".join(
            fmt_row(m) for m in rows
        )
    entry = next(
        e for e in manifest["files"] if "path" in e and nfc(path_needle) in nfc(e["path"])
    )
    nfo = entry.get("nfo") or {}
    if not nfo:
        return None, f"manifest 条目无 nfo 字段: {entry['path']}"
    m = rows[0]
    exp = {
        "title": nfo.get("title"),
        "year": nfo.get("year"),
        "genres": ", ".join(nfo["genres"]) if nfo.get("genres") else None,
        "director": nfo.get("director"),
        "actors": ", ".join(nfo["actors"]) if nfo.get("actors") else None,
    }
    if with_plot:
        exp["plot"] = nfo.get("plot")
    diffs = []
    for k, v in exp.items():
        got = m.get(k)
        if isinstance(v, str):
            got = nfc(got) if got is not None else None
            v = nfc(v)
        if got != v:
            diffs.append(f"{k}: 期望 {v!r} 实际 {got!r}")
    if diffs:
        return None, "; ".join(diffs) + f"（{fmt_row(m)}）"
    return m, None


def check_nfo_01(conn, sn, manifest, ingest):
    m, err = check_nfo_common(sn, manifest, "Inception")
    if err:
        return "fail", err
    return "pass", (
        f"NFO 元数据落库且优先于文件名: title={m['title']!r}（非文件名提取的 "
        f"'Inception (2010)'）, year={m['year']}, genres={m['genres']!r}, "
        f"director={m['director']!r}, actors={m['actors']!r}"
    )


def check_nfo_02(conn, sn, manifest, ingest):
    rows = by_path_sub(sn, "双重NFO")
    if len(rows) != 1:
        return "fail", f"应恰命中 1 行，实际 {len(rows)} 行: " + "; ".join(fmt_row(m) for m in rows)
    m = rows[0]
    if nfc(m["title"]) != "同名 NFO 的标题" or m["year"] != 2001:
        return "fail", (
            f"期望 title='同名 NFO 的标题' year=2001（stem.nfo 优先于 movie.nfo，"
            f"indexer.rs:69-85），实际: {fmt_row(m)}"
        )
    return "pass", f"同名 NFO 优先于 movie.nfo: title={m['title']!r}, year={m['year']}"


def check_nfo_03(conn, sn, manifest, ingest):
    m, err = check_nfo_common(sn, manifest, "盗梦空间")
    if err:
        return "fail", err
    return "pass", (
        f"中文 NFO 元数据完整落库（NFC）: title={m['title']!r}, year={m['year']}, "
        f"genres={m['genres']!r}, director={m['director']!r}, actors={m['actors']!r}"
    )


def check_group_01(conn, sn, manifest, ingest):
    exp = group_expectations(manifest)
    rows = conn.execute("SELECT id, title, part_count FROM video_groups").fetchall()

    def to_rel(p: str) -> str:
        p = nfc(p)
        for pre in media_prefixes():
            if p.startswith(pre):
                return p[len(pre):]
        return "?outside-media-root?" + p

    problems = []
    if len(rows) != len(exp):
        problems.append(
            f"video_groups {len(rows)} 组 != 期望 {len(exp)} 组: "
            + "; ".join(f"{t!r}(part_count={pc})" for _gid, t, pc in rows)
        )
    got: dict[str, list] = {}
    for gid, title, part_count in rows:
        members = conn.execute(
            "SELECT vp.part_number, m.file_path FROM video_parts vp "
            "JOIN movies m ON m.id = vp.movie_id WHERE vp.group_id = ? "
            "ORDER BY vp.part_number",
            (gid,),
        ).fetchall()
        if part_count != len(members):
            problems.append(f"组 {title!r}: part_count={part_count} != 成员数 {len(members)}")
        got[nfc(title)] = sorted((int(pn), to_rel(fp)) for pn, fp in members)
    for g in sorted(set(exp) | set(got)):
        if exp.get(g) != got.get(g):
            problems.append(f"组 {g!r}: 期望 {exp.get(g)}，实际 {got.get(g)}")
    if problems:
        return "fail", "; ".join(problems)
    total = sum(len(v) for v in exp.values())
    summary = "、".join(f"{g} {len(v)} 部" for g, v in sorted(exp.items()))
    return "pass", (
        f"video_groups 恰 {len(exp)} 组（{summary}），每行 part_count==成员数，"
        f"成员与部号和 manifest 精确一致（共 {total} 行被分组）"
    )


def check_probe_01(conn, sn, manifest, ingest):
    mode = dataset_mode()
    defaults = manifest.get("defaults", {})
    rel_rows = rows_by_rel(sn)
    problems = []
    n_valued = 0
    n_null = 0
    for e in manifest["files"]:
        if e.get("kind") != "video":
            continue
        rel = nfc(e["path"])
        m = rel_rows.get(rel)
        if m is None:
            problems.append(f"缺行: {rel}")
            continue
        got = (m["duration_seconds"], m["width"], m["height"])
        exp = expected_probe(mode, e, defaults)
        if exp is None:
            if got != (None, None, None):
                problems.append(f"{rel}: 期望三列 NULL，实际 {got}")
            else:
                n_null += 1
        elif got != exp:
            problems.append(f"{rel}: 期望 {exp}，实际 {got}")
        else:
            n_valued += 1
    # 用例主断言：The.Matrix.1999（.mkv 走 ffprobe 路径）三列非空为正
    matrix = rel_rows.get(nfc("平铺电影/The.Matrix.1999.mkv"))
    if matrix is not None and not (
        matrix["duration_seconds"] and matrix["width"] and matrix["height"]
    ):
        problems.append(f"The.Matrix.1999 三列应非空为正: {fmt_row(matrix)}")
    if problems:
        head = "; ".join(problems[:8])
        more = f"（共 {len(problems)} 项）" if len(problems) > 8 else ""
        return "fail", f"模式={mode}; {head}{more}"
    return "pass", (
        f"模式={mode}: {n_valued} 个正常视频三列精确匹配（fast 下均为 "
        f"{SAMPLE_PROBE}），{n_null} 个损坏/空/不可探视频三列 NULL；"
        "The.Matrix.1999（ffprobe 路径）非空为正"
    )


def check_ext_01(conn, sn, manifest, ingest):
    expected = {"mp4": 23, "mkv": 7, "avi": 2, "webm": 1, "mov": 1, "wmv": 1, "flv": 1, "m4v": 1}
    exts = Counter()
    bad = []
    for m in sn:
        name = nfc(m["file_path"]).rsplit("/", 1)[-1]
        if "." not in name:
            bad.append(m["file_path"])
            continue
        exts[name.rsplit(".", 1)[1].lower()] += 1
    problems = []
    if bad:
        problems.append(f"无扩展名路径 {len(bad)} 条: {bad[:3]}")
    if dict(exts) != expected:
        problems.append(f"扩展名计数 {dict(sorted(exts.items()))} != 期望 {expected}")
    if not any(nfc(m["file_path"]).endswith("MOVIE_UPPER.MKV") for m in sn):
        problems.append("未找到大写扩展名路径 MOVIE_UPPER.MKV（file_path 应原样保留大小写）")
    if problems:
        return "fail", "; ".join(problems)
    return "pass", f"8 种扩展名计数精确匹配（共 {sum(exts.values())} 行），大写 .MKV 路径原样保留"


def check_scan_02(conn, sn, manifest, ingest):
    rows = [m for m in sn if nfc(m["file_path"]).endswith("/a/b/c/deep movie.mp4")]
    if len(rows) != 1:
        return "fail", f"深嵌套路径应恰 1 行，实际 {len(rows)}: " + "; ".join(fmt_row(m) for m in rows)
    if rows[0]["title"] != "deep movie":
        return "fail", f"期望 title='deep movie'，实际 {rows[0]['title']!r}"
    return "pass", f"深嵌套递归收录: {rows[0]['file_path']} → title={rows[0]['title']!r}"


def check_group_02(conn, sn, manifest, ingest):
    rel_rows = rows_by_rel(sn)
    lonely = [
        nfc(e["path"])
        for e in manifest["files"]
        if e.get("kind") == "video" and (e.get("expect") or {}).get("no_group")
    ]
    if not lonely:
        return "fail", "manifest 无 no_group 条目（数据集变了？用例需同步）"
    problems = []
    for rel in lonely:
        m = rel_rows.get(rel)
        if m is None:
            problems.append(f"缺行: {rel}")
            continue
        if m["group_id"] is not None:
            problems.append(f"{rel}: group_id 应为 NULL，实际 {m['group_id']}")
        n_parts = conn.execute(
            "SELECT COUNT(*) FROM video_parts WHERE movie_id = ?", (m["id"],)
        ).fetchone()[0]
        if n_parts:
            problems.append(f"{rel}: 不应有 video_parts 行，实际 {n_parts} 行")
    grouped = conn.execute(
        "SELECT COUNT(*) FROM movies WHERE group_id IS NOT NULL"
    ).fetchone()[0]
    parts_total = conn.execute("SELECT COUNT(*) FROM video_parts").fetchone()[0]
    exp_grouped = sum(len(v) for v in group_expectations(manifest).values())
    if grouped != exp_grouped or parts_total != exp_grouped:
        problems.append(
            f"全库被分组行数 {grouped} / video_parts 总行数 {parts_total}，"
            f"期望均为 {exp_grouped}（6 组成员之和）"
        )
    if problems:
        return "fail", "; ".join(problems)
    return "pass", (
        f"孤立单部不成组: {'、'.join(lonely)} 的 group_id 为 NULL 且无 video_parts 行；"
        f"全库恰 {grouped} 行被分组（与 6 组成员之和一致）"
    )


def check_thumb_01(conn, sn, manifest, ingest):
    rows = [m for m in sn if m["thumbnail_path"]]
    markers = ["Inception", "盗梦空间", "海报全家福", "流浪地球 上集", "流浪地球 中集", "流浪地球 下集"]
    problems = []
    if len(rows) != 6:
        problems.append(
            f"thumbnail_path 非空应恰 6 行，实际 {len(rows)}: "
            + "; ".join(f"{m['file_path']} → {m['thumbnail_path']}" for m in rows)
        )
    matched = set()
    for mk in markers:
        hit = [m for m in rows if nfc(mk) in nfc(m["file_path"])]
        if len(hit) != 1:
            problems.append(f"标记 {mk!r} 应恰命中 1 行，实际 {len(hit)}")
        else:
            matched.add(id(hit[0]))
    if len(rows) == 6 and len(matched) != 6:
        problems.append("6 行未能与 6 个标记一一对应")
    for m in rows:
        tid, tp = m["id"], m["thumbnail_path"]
        if nfc(tp) not in thumb_candidates(tid):
            problems.append(f"id={tid} thumbnail_path={tp!r} 不在预期命名 thumbnails/{tid}.jpg")
            continue
        f = Path(tp)
        if not f.exists():
            problems.append(f"缩略图文件不存在: {tp}")
            continue
        size = f.stat().st_size
        head = f.read_bytes()[:2]
        if size <= 0:
            problems.append(f"缩略图文件为空: {tp}")
        elif head != b"\xff\xd8":
            problems.append(f"缩略图非 JPEG（前两字节 {head!r}）: {tp}")
    if problems:
        return "fail", "; ".join(problems)
    return "pass", (
        f"恰 6 部有海报的影片生成缩略图（{THUMB_ROOT}/{{id}}.jpg，存在、非空、JPEG 魔数）；"
        f"流浪地球三部曲共享同目录 poster.jpg"
    )


def check_search_01(conn, sn, manifest, ingest):
    try:
        hits = fts_match(conn, "matrix*")
    except AssertionError as e:
        return "fail", str(e)
    if len(hits) != 1 or not nfc(hits[0]).endswith("The.Matrix.1999.mkv"):
        return "fail", f"'matrix*' 应恰命中 The.Matrix.1999.mkv 一行，实际 {len(hits)}: {hits}"
    return "pass", f"FTS 前缀搜索 'matrix*' 恰命中 1 行: {hits[0].rsplit('/', 1)[-1]}"


def check_search_02(conn, sn, manifest, ingest):
    try:
        hits = fts_match(conn, "盗梦*")
    except AssertionError as e:
        return "fail", str(e)
    if len(hits) != 1 or "盗梦空间 (2010).mp4" not in nfc(hits[0]):
        return "fail", f"'盗梦*' 应恰命中 盗梦空间 (2010).mp4 一行，实际 {len(hits)}: {hits}"
    return "pass", f"FTS 中文前缀搜索 '盗梦*' 恰命中 1 行（unicode61 分词）"


def check_search_03(conn, sn, manifest, ingest):
    rows = by_path_sub(sn, "盗梦空间")
    if len(rows) != 1 or nfc(rows[0]["actors"] or "") != "莱昂纳多·迪卡普里奥, 渡边谦":
        return "fail", (
            "前置不成立: 盗梦空间 actors 应为 '莱昂纳多·迪卡普里奥, 渡边谦'，实际: "
            + "; ".join(fmt_row(m) for m in rows)
        )
    try:
        hits = fts_match(conn, "迪卡普里奥*")
    except AssertionError as e:
        return "fail", str(e)
    if len(hits) != 1 or "盗梦空间 (2010).mp4" not in nfc(hits[0]):
        return "fail", f"'迪卡普里奥*' 应恰命中 盗梦空间 一行，实际 {len(hits)}: {hits}"
    return "pass", "NFO 演员名随 movies_ai 触发器进 FTS，'迪卡普里奥*' 恰命中盗梦空间"


def check_edge_01(conn, sn, manifest, ingest):
    # NFO 10 分制评分在解析边界换算为应用 5 分制落库
    # （indexer.rs normalize_nfo_rating：÷2 后取 0.1 精度，8.8→4.4、8.9→4.5）
    want = {"Inception (2010).mp4": 4.4, "盗梦空间 (2010).mp4": 4.5}
    rows = by_path_sub(sn, "Inception") + by_path_sub(sn, "盗梦空间")
    problems = []
    if len(rows) != 2:
        problems.append(f"Inception/盗梦空间 应恰 2 行，实际 {len(rows)}")
    for m in rows:
        expected = next(
            (v for k, v in want.items() if nfc(k) in nfc(m["file_path"])), None
        )
        if (
            expected is None
            or m["rating"] is None
            or abs(m["rating"] - expected) > 1e-6
        ):
            problems.append(
                f"{m['file_path']} rating 期望 ≈{expected}，实际 {m['rating']!r}"
            )
    n_over = conn.execute("SELECT COUNT(*) FROM movies WHERE rating>5").fetchone()[0]
    if n_over != 0:
        over = [r[0] for r in conn.execute("SELECT file_path FROM movies WHERE rating>5")]
        problems.append(f"rating>5 的行应 0，实际 {n_over}: {over[:3]}")
    if problems:
        return "fail", "; ".join(problems)
    return "pass", (
        "10 分制 NFO 评分经 normalize_nfo_rating 换算 5 分制落库"
        "（8.8→4.4、8.9→4.5），全表无 rating>5 的行"
    )


CASES = [
    ("SCAN-01", "收录数量与路径集合精确匹配（37 行、路径与 manifest 一致、干扰文件零混入）", check_scan_01),
    ("NFO-01", "NFO 元数据落库且优先于文件名（Inception）", check_nfo_01),
    ("NFO-02", "同名 NFO 优先于 movie.nfo（双重NFO）", check_nfo_02),
    ("NFO-03", "中文 NFO 元数据完整落库且 NFC 存储（盗梦空间）", check_nfo_03),
    ("GROUP-01", "系列识别落库（video_groups 恰 6 组、part 精确匹配）", check_group_01),
    ("PROBE-01", "视频探针（duration/width/height；损坏/空文件为 NULL）", check_probe_01),
    ("EXT-01", "扩展名全覆盖（mp4=23、mkv=7、avi=2、其余各 1；大写 .MKV 原样保留）", check_ext_01),
    ("SCAN-02", "深嵌套递归收录（deep movie）", check_scan_02),
    ("GROUP-02", "孤立单部不成组（孤独的单部 CD1；全库恰 14 行被分组）", check_group_02),
    ("THUMB-01", "海报缩略图生成落盘（恰 6 部，{id}.jpg 存在、非空、JPEG）", check_thumb_01),
    ("SEARCH-01", "FTS 英文前缀搜索（matrix* 恰命中 The Matrix）", check_search_01),
    ("SEARCH-02", "FTS 中文标题前缀搜索（盗梦*）", check_search_02),
    ("SEARCH-03", "FTS 演员名搜索（迪卡普里奥*，依赖 NFO actors 进 FTS）", check_search_03),
    ("EDGE-01", "10 分制 NFO 评分换算 5 分制落库（8.8→4.4、8.9→4.5）", check_edge_01),
]


def main() -> int:
    ap = argparse.ArgumentParser(description="Reelfs e2e 只读断言")
    ap.add_argument("out", help="结果 JSON 输出路径")
    args = ap.parse_args()
    out_path = Path(args.out)
    if not out_path.parent.is_dir():
        scaffold_fail(f"结果输出目录不存在: {out_path.parent}")

    conn = open_db()
    manifest = load_manifest()

    print(f"[e2e-check] DB: {DB_PATH}")
    ingest = wait_ingest(conn)
    if not ingest["stable"]:
        print(
            f"[e2e-check] 警告: {INGEST_TIMEOUT}s 内入库未达稳定终态 {ingest}，继续执行断言（相关用例将 fail）",
            file=sys.stderr,
        )
    scan_done = wait_scan_done()
    if not scan_done:
        print(
            f"[e2e-check] 警告: {INGEST_TIMEOUT}s 内未见 '{SCAN_DONE_MARK}'"
            "（扫描未完成，或 REELFS_E2E_AUTOSCAN 未生效），继续执行断言（探针/分组用例将 fail）",
            file=sys.stderr,
        )
    sn = snapshot(conn)

    results = []
    for cid, name, fn in CASES:
        try:
            status, detail = fn(conn, sn, manifest, ingest)
        except Exception as e:  # 单用例异常不拖垮整个报告
            status, detail = "fail", f"用例执行异常: {type(e).__name__}: {e}"
        results.append({"id": cid, "name": name, "status": status, "detail": detail})
        print(f"[e2e-check] {cid:9s} {status.upper():7s} {name}")

    passed = sum(1 for r in results if r["status"] == "pass")
    failed = sum(1 for r in results if r["status"] == "fail")
    skipped = sum(1 for r in results if r["status"] == "skipped")
    report = {
        "cases": results,
        "summary": {
            "pass": passed,
            "fail": failed,
            "skipped": skipped,
            "db": str(DB_PATH),
            "reelfs_log_exists": REELFS_LOG.exists(),
            "ingest": ingest,
            "scan_done": scan_done,
            "dataset_mode": dataset_mode(),
        },
    }
    tmp = out_path.with_name(out_path.name + ".tmp")
    tmp.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(out_path)
    print(
        f"[e2e-check] 汇总: {passed} pass / {failed} fail / {skipped} skipped；"
        f"结果已写入 {out_path}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
