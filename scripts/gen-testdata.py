#!/usr/bin/env python3
"""物化 testdata/manifest.json 描述的 Reelfs 测试媒体库。

一份声明式数据集（manifest），物化模式：

  fast   视频统一复制仓库内置的微型真实 mp4（testdata/blobs/sample.mp4，
         320x180 / 4s），海报复制内置小图 —— 无任何外部依赖，秒级完成，
         Rust 测试（src-tauri/src/fixture_tests.rs）用它。缺点：mkv/webm
         等扩展名与真实容器不符（内容都是 mp4 字节）。
  remux  有 ffmpeg 时的折中：mp4/m4v 仍复制内置样本，其余扩展名用
         `ffmpeg -c copy` 把 sample.mp4 秒级重封装成真实对应容器（内容
         仍是 320x180 / 4s，不重编码）；webm/wmv 装不下 sample 的
         h264/aac，回退 real 编码。e2e（scripts/e2e-launch.sh）用它，
         让按容器断言的用例不失真。
  real   用 ffmpeg 逐条生成真实编码视频（可出缩略图、可播放）和纯色海报，
         agent 沙盒（scripts/agent-env.sh → just dev）用它。
  auto   找得到 ffmpeg 就 real，否则回退 fast（默认）。

用法：
  python3 scripts/gen-testdata.py --out <dir> [--mode auto|fast|remux|real]
                                  [--ffmpeg PATH] [--force] [--prune]
  python3 scripts/gen-testdata.py --list

幂等：重复运行只补缺失/截断的文件，不重写内容一致的文件（real/remux
模式下已存在且 ≥4KB 的视频直接跳过——注意这意味着在同一目录先 fast 再
remux 不会重封装已有文件，要切换模式请用 --force 或全新目录）。
--prune 会删掉输出目录里不在 manifest 中的文件 —— 只对完全由本脚本管理
的目录使用（.agentenv/media 里有自建样本时别开）。
"""

from __future__ import annotations

import argparse
import colorsys
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from xml.sax.saxutils import escape

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_MANIFEST = REPO_ROOT / "testdata" / "manifest.json"
BLOB_VIDEO = REPO_ROOT / "testdata" / "blobs" / "sample.mp4"
BLOB_JPEG = REPO_ROOT / "testdata" / "blobs" / "poster.jpg"
BLOB_PNG = REPO_ROOT / "testdata" / "blobs" / "poster.png"

# 与 src-tauri/src/indexer.rs 的 VIDEO_EXTENSIONS 保持一致
VIDEO_EXTENSIONS = {"mkv", "mp4", "avi", "mov", "wmv", "flv", "webm", "m4v"}
IMAGE_BLOBS = {".jpg": BLOB_JPEG, ".jpeg": BLOB_JPEG, ".png": BLOB_PNG}

CORRUPT_BYTES = b"this file pretends to be a video but is plain garbage bytes\n" * 8
DEFAULT_JUNK_CONTENT = "test junk file\n"


def log(msg: str) -> None:
    print(f"[testdata] {msg}")


def die(msg: str) -> None:
    print(f"[testdata] 错误: {msg}", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# manifest 加载与校验
# ---------------------------------------------------------------------------

class Manifest:
    def __init__(self, data: dict):
        self.defaults = data.get("defaults", {})
        self.name = data.get("name", "unnamed")
        self.entries = []
        seen = set()
        for raw in data.get("files", []):
            if "_doc" in raw:  # 纯注释行
                continue
            self._validate(raw, seen)
            self.entries.append(raw)

    @staticmethod
    def _validate(e: dict, seen: set) -> None:
        path = e.get("path")
        if not path or not isinstance(path, str):
            die(f"manifest 条目缺少 path: {e!r}")
        if path in seen:
            die(f"manifest 路径重复: {path}")
        seen.add(path)
        kind = e.get("kind")
        if kind not in ("video", "file"):
            die(f"{path}: kind 必须是 video 或 file，当前 {kind!r}")
        if kind == "video":
            ext = Path(path).suffix.lstrip(".").lower()
            if ext not in VIDEO_EXTENSIONS:
                die(f"{path}: 不是受支持的视频扩展名 {sorted(VIDEO_EXTENSIONS)}")
            if e.get("corrupt") and e.get("empty"):
                die(f"{path}: corrupt 与 empty 互斥")

    def videos(self):
        return [e for e in self.entries if e["kind"] == "video"]

    def duration_of(self, e: dict) -> int:
        return e.get("duration_seconds", self.defaults.get("duration_seconds", 4))

    def resolution_of(self, e: dict) -> tuple[int, int]:
        w, h = e.get("resolution", self.defaults.get("resolution", [320, 180]))
        return int(w), int(h)


def load_manifest(path: Path) -> Manifest:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        die(f"manifest 不存在: {path}")
    except json.JSONDecodeError as err:
        die(f"manifest 不是合法 JSON: {path}: {err}")
    return Manifest(data)


# ---------------------------------------------------------------------------
# 生成器
# ---------------------------------------------------------------------------

def find_ffmpeg(explicit: str | None) -> str | None:
    if explicit:
        return explicit if Path(explicit).exists() else die(f"指定的 ffmpeg 不存在: {explicit}")
    ff = shutil.which("ffmpeg")
    if ff:
        return ff
    # 不在 dev shell 里时，从本仓库 flake（与 flake.lock 同一个 pin）里找，
    # 避免走 registry 的未锁定 nixpkgs。与 agent-env.sh 旧实现一致。
    if (REPO_ROOT / "flake.nix").exists() and shutil.which("nix"):
        try:
            res = subprocess.run(
                ["nix", "develop", str(REPO_ROOT), "-c", "bash", "-c", "command -v ffmpeg"],
                capture_output=True, text=True, timeout=600,
            )
            ff = res.stdout.strip().splitlines()[0] if res.stdout.strip() else ""
            if ff:
                return ff
        except (OSError, subprocess.TimeoutExpired):
            pass
    return None


def nfo_xml(meta: dict) -> str:
    def tag(name: str, value) -> None:
        # None / 空串不输出该元素：quick-xml 反序列化端对 "None" 文本会失败
        if value is None or value == "":
            return
        lines.append(f"  <{name}>{escape(str(value))}</{name}>")

    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<movie>"]
    tag("title", meta.get("title"))
    tag("year", meta.get("year"))
    tag("rating", meta.get("rating"))
    tag("plot", meta.get("plot"))
    for genre in meta.get("genres") or []:
        tag("genre", genre)
    tag("director", meta.get("director"))
    for actor in meta.get("actors") or []:
        lines.append("  <actor>")
        lines.append(f"    <name>{escape(str(actor))}</name>")
        lines.append("  </actor>")
    lines.append("</movie>")
    return "\n".join(lines) + "\n"


def write_if_changed(path: Path, data: bytes, stats: dict, key: str, force: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not force and path.exists() and path.read_bytes() == data:
        return
    path.write_bytes(data)
    stats[key] += 1


def poster_color(seed: str) -> str:
    """按名字确定性取一个不过暗/不过亮的纯色，肉眼能区分不同海报。"""
    hue = int(hashlib.sha1(seed.encode("utf-8")).hexdigest(), 16) % 360 / 360
    r, g, b = colorsys.hls_to_rgb(hue, 0.45, 0.55)
    return f"0x{round(r*255):02x}{round(g*255):02x}{round(b*255):02x}"


def video_codec_args(ext: str) -> list[str]:
    # 容器差异：webm 只收 vp8/vp9 + vorbis/opus；wmv 收 wmv2/wmav2；
    # 其余（mp4/m4v/mkv/avi/mov/flv）都能装 h264/aac。
    if ext == "webm":
        return ["-c:v", "libvpx", "-b:v", "512k", "-c:a", "libvorbis"]
    if ext == "wmv":
        return ["-c:v", "wmv2", "-c:a", "wmav2"]
    return ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"]


def gen_video_real(ff: str, dest: Path, duration: int, size: tuple[int, int], ext: str) -> None:
    w, h = size
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [ff, "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", f"testsrc=duration={duration}:size={w}x{h}:rate=24",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
         *video_codec_args(ext), "-shortest", str(dest)],
        check=True,
    )


def gen_video_remux(ff: str, dest: Path) -> bool:
    """把内置 sample.mp4 用 `-c copy` 秒级重封装成 dest 扩展名对应的真实容器
    （内容保持 320x180 / 4s 不重编码）。返回 False 表示该容器装不下 sample 的
    h264/aac 流（webm/wmv），调用方回退 gen_video_real。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    res = subprocess.run(
        [ff, "-loglevel", "error", "-y", "-i", str(BLOB_VIDEO), "-c", "copy", str(dest)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        # ffmpeg 失败时可能留下半截输出文件，别让幂等跳过把它当完好样本
        dest.unlink(missing_ok=True)
        return False
    return True


def gen_poster_real(ff: str, dest: Path, seed: str) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [ff, "-loglevel", "error", "-y",
           "-f", "lavfi", "-i", f"color=c={poster_color(seed)}:s=240x360",
           "-frames:v", "1"]
    if dest.suffix.lower() in (".jpg", ".jpeg"):
        cmd += ["-q:v", "4"]
    cmd.append(str(dest))
    subprocess.run(cmd, check=True)


def materialize(manifest: Manifest, out_root: Path, mode: str, ff: str | None,
                force: bool, prune: bool) -> None:
    stats = {"video": 0, "nfo": 0, "poster": 0, "junk": 0}
    seen_paths = set()

    for entry in manifest.entries:
        rel = entry["path"]
        seen_paths.add(rel)
        dest = out_root / rel
        is_video = entry["kind"] == "video"

        # ---- 视频本体 ----
        if is_video:
            if entry.get("empty"):
                write_if_changed(dest, b"", stats, "video", force)
            elif entry.get("corrupt"):
                write_if_changed(dest, CORRUPT_BYTES, stats, "video", force)
            elif mode == "fast":
                write_if_changed(dest, BLOB_VIDEO.read_bytes(), stats, "video", force)
            elif mode == "remux":
                # mp4/m4v 容器本就正确，直接复制；其余扩展名 remux 出真实容器
                if not force and dest.exists() and dest.stat().st_size >= 4096:
                    pass
                elif Path(rel).suffix.lstrip(".").lower() in ("mp4", "m4v"):
                    write_if_changed(dest, BLOB_VIDEO.read_bytes(), stats, "video", force)
                else:
                    ext = Path(rel).suffix.lstrip(".").lower()
                    if not gen_video_remux(ff, dest):
                        gen_video_real(ff, dest, manifest.duration_of(entry),
                                       manifest.resolution_of(entry), ext)
                    stats["video"] += 1
            else:
                # real：已有完好的就跳过（上次失败残留的 0 字节/截断文件重生成）
                if not force and dest.exists() and dest.stat().st_size >= 4096:
                    pass
                else:
                    ext = Path(rel).suffix.lstrip(".").lower()
                    gen_video_real(ff, dest, manifest.duration_of(entry),
                                   manifest.resolution_of(entry), ext)
                    stats["video"] += 1

        # ---- NFO：视频条目写在旁边（同名 stem.nfo / movie.nfo）；
        #      file 条目直接写在自身路径 ----
        meta = entry.get("nfo")
        if meta:
            if is_video:
                stem = Path(rel).stem
                nfo_name = "movie.nfo" if meta.get("as") == "movie" else f"{stem}.nfo"
                nfo_dest = dest.parent / nfo_name
            else:
                nfo_dest = dest
            seen_paths.add(nfo_dest.relative_to(out_root).as_posix())
            write_if_changed(nfo_dest, nfo_xml(meta).encode("utf-8"), stats, "nfo", force)

        # ---- 海报（只有视频条目有）----
        for poster in entry.get("posters") or []:
            poster_dest = dest.parent / poster
            seen_paths.add(poster_dest.relative_to(out_root).as_posix())
            if mode == "fast":
                blob = IMAGE_BLOBS.get(Path(poster).suffix.lower())
                if blob is None:
                    die(f"{rel}: 海报 {poster} 扩展名没有内置 blob，fast 模式无法生成")
                write_if_changed(poster_dest, blob.read_bytes(), stats, "poster", force)
            else:
                if not force and poster_dest.exists() and poster_dest.stat().st_size >= 512:
                    continue
                gen_poster_real(ff, poster_dest, seed=rel)
                stats["poster"] += 1

        # ---- 普通干扰文件 ----
        if not is_video and not meta:
            write_if_changed(dest, entry.get("content", DEFAULT_JUNK_CONTENT).encode("utf-8"),
                             stats, "junk", force)

    if prune:
        removed = 0
        for path in sorted(out_root.rglob("*")):
            if not path.is_file():
                continue
            if path.relative_to(out_root).as_posix() not in seen_paths:
                path.unlink()
                removed += 1
                log(f"--prune 删除多余文件: {path.relative_to(out_root)}")
        if removed:
            log(f"--prune 共删除 {removed} 个不在 manifest 里的文件")

    log(f"数据集 '{manifest.name}' 已生成 → {out_root}")
    log(f"模式={mode} 视频={stats['video']} NFO={stats['nfo']} "
        f"海报={stats['poster']} 干扰文件={stats['junk']}（仅统计本次写入，跳过的不计）")


def print_summary(manifest: Manifest) -> None:
    videos = manifest.videos()
    junk = [e for e in manifest.entries if e["kind"] == "file"]
    groups: dict[str, list[int]] = {}
    for e in videos:
        exp = e.get("expect", {})
        if "group" in exp:
            groups.setdefault(exp["group"], []).append(exp.get("part", 0))
    nfo_count = sum(1 for e in manifest.entries if e.get("nfo"))
    poster_count = sum(len(e.get("posters") or []) for e in manifest.entries)
    corrupt = sum(1 for e in videos if e.get("corrupt") or e.get("empty"))

    log(f"数据集 '{manifest.name}'：{len(videos)} 个视频 / {nfo_count} 个 NFO / "
        f"{poster_count} 张海报 / {len(junk)} 个干扰文件 / {corrupt} 个损坏或空文件")
    for name in sorted(groups):
        log(f"  系列 '{name}': {len(groups[name])} 集 (parts {sorted(groups[name])})")
    top_dirs = sorted({e["path"].split("/", 1)[0] for e in manifest.entries})
    log(f"  顶层目录: {', '.join(top_dirs)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="物化 Reelfs 测试媒体库（testdata/manifest.json）")
    parser.add_argument("--out", help="输出目录（生成模式必填）")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST,
                        help=f"manifest 路径（默认 {DEFAULT_MANIFEST}）")
    parser.add_argument("--mode", choices=["auto", "fast", "remux", "real"], default="auto",
                        help="auto: 有 ffmpeg 用 real，否则 fast（默认）；"
                             "remux: -c copy 秒级重封装出各扩展名的真实容器")
    parser.add_argument("--ffmpeg", help="显式指定 ffmpeg 路径")
    parser.add_argument("--force", action="store_true", help="忽略幂等跳过，全部重写")
    parser.add_argument("--prune", action="store_true",
                        help="删除输出目录里不在 manifest 中的文件（谨慎：会删自建样本）")
    parser.add_argument("--list", action="store_true", help="只打印数据集摘要，不生成")
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)

    if args.list:
        print_summary(manifest)
        return

    if not args.out:
        parser.error("生成时必须提供 --out（只看摘要用 --list）")

    mode = args.mode
    ff = None
    if mode in ("auto", "remux", "real"):
        ff = find_ffmpeg(args.ffmpeg)
        if ff is None:
            if mode in ("remux", "real"):
                die(f"未找到 ffmpeg（PATH 和 nix develop 都没有），{mode} 模式不可用")
            mode = "fast"
            log("未找到 ffmpeg，auto 回退到 fast 模式（内置微型样本，无音轨差异）")
    if mode == "fast":
        for blob in (BLOB_VIDEO, BLOB_JPEG, BLOB_PNG):
            if not blob.exists():
                die(f"fast 模式依赖内置 blob，但缺失: {blob}")

    materialize(manifest, Path(args.out).resolve(), mode, ff, args.force, args.prune)


if __name__ == "__main__":
    main()
