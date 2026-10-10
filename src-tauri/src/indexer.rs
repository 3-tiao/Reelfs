use crate::models::MovieMetadata;
use crate::path_utils::resolve_fs_path;
use log::{debug, info, warn};
use quick_xml::de::from_str;
use serde::Deserialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: [&str; 8] = ["mkv", "mp4", "avi", "mov", "wmv", "flv", "webm", "m4v"];

pub fn get_poster_path(video_path: &Path) -> Option<String> {
    let resolved = resolve_fs_path(video_path);
    let parent = resolved.parent()?;

    let poster_names = vec![
        "poster.jpg",
        "poster.png",
        "folder.jpg",
        "cover.jpg",
        "fanart.jpg",
        "fanart.png",
    ];

    for name in poster_names {
        let poster_path = parent.join(name);
        if poster_path.exists() {
            return Some(poster_path.to_string_lossy().to_string());
        }
    }

    None
}

#[derive(Debug, Deserialize)]
struct NfoMovie {
    title: Option<String>,
    year: Option<i32>,
    plot: Option<String>,
    rating: Option<f64>,
    genre: Option<Vec<String>>,
    director: Option<String>,
    actor: Option<Vec<NfoActor>>,
}

#[derive(Debug, Deserialize)]
struct NfoActor {
    name: Option<String>,
}

pub fn is_video_file(path: &Path) -> bool {
    if let Some(ext) = path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        let is_video = VIDEO_EXTENSIONS.contains(&ext_str.as_str());
        debug!("[目录扫描] 文件类型检查: {:?} -> {}", path, is_video);
        is_video
    } else {
        debug!("[目录扫描] 无扩展名文件: {:?}", path);
        false
    }
}

pub fn find_nfo_for_video(video_path: &Path) -> Option<PathBuf> {
    let resolved = resolve_fs_path(video_path);
    let parent = resolved.parent()?;
    let stem = resolved.file_stem()?;

    let nfo_path = parent.join(format!("{}.nfo", stem.to_string_lossy()));
    if nfo_path.exists() {
        return Some(nfo_path);
    }

    let movie_nfo = parent.join("movie.nfo");
    if movie_nfo.exists() {
        return Some(movie_nfo);
    }

    None
}

/// NFO 的 rating 是 Kodi 惯例的 10 分制，而应用全链路（UI 星级、评分过滤、
/// DB 层 sanitize_rating 的 0.0..=5.0 窗口）是 5 分制。在 NFO 解析边界统一换算：
/// - (5.0, 10.0]：÷2 后四舍五入到 0.1（8.8→4.4、8.9→4.5、7.5→3.8）
/// - 0.0..=5.0：视为已是 5 分制，原样保留（兼容现状）
/// - NaN / 负数 / >10.0：无法解释的值一律丢弃
pub fn normalize_nfo_rating(rating: Option<f64>) -> Option<f64> {
    let value = rating?;
    if value > 5.0 && value <= 10.0 {
        Some(((value / 2.0) * 10.0).round() / 10.0)
    } else if (0.0..=5.0).contains(&value) {
        Some(value)
    } else {
        None
    }
}

pub fn parse_nfo_file(nfo_path: &Path) -> Option<MovieMetadata> {
    let nfo_path = resolve_fs_path(nfo_path);
    let nfo_path = nfo_path.as_path();
    debug!("[文件解析] 开始解析NFO文件: {:?}", nfo_path);

    let content = fs::read_to_string(nfo_path).ok()?;

    let nfo: NfoMovie = from_str(&content).ok()?;

    debug!(
        "[文件解析] NFO解析结果: title={:?}, year={:?}, rating={:?}",
        nfo.title, nfo.year, nfo.rating
    );

    let genres = nfo.genre.map(|g| g.join(", "));

    let actors = nfo.actor.map(|actors| {
        actors
            .iter()
            .filter_map(|a| a.name.clone())
            .collect::<Vec<_>>()
            .join(", ")
    });

    let metadata = MovieMetadata {
        title: nfo.title.unwrap_or_else(|| "Unknown".to_string()),
        year: nfo.year,
        plot: nfo.plot,
        rating: normalize_nfo_rating(nfo.rating),
        genres,
        director: nfo.director,
        actors,
    };

    info!(
        "[文件解析] NFO解析完成: title={}, year={:?}",
        metadata.title, metadata.year
    );

    Some(metadata)
}

pub fn scan_directory_with_stop_flag(
    path: &str,
    stop_flag: Option<Arc<AtomicBool>>,
    progress_callback: Option<Arc<dyn Fn(usize) + Send + Sync>>,
) -> Vec<PathBuf> {
    info!("[目录扫描] 开始扫描目标路径: {}", path);
    debug!("[目录扫描] 视频文件扩展名: {:?}", VIDEO_EXTENSIONS);

    let mut results = Vec::new();
    let mut video_count = 0;

    for entry in WalkDir::new(path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if let Some(ref flag) = stop_flag {
            if flag.load(Ordering::Relaxed) {
                info!("[目录扫描] 扫描已停止");
                return results;
            }
        }

        let path = entry.path();

        if !is_video_file(path) {
            debug!("[目录扫描] 跳过非视频文件: {:?}", path);
            continue;
        }

        video_count += 1;
        debug!("[目录扫描] 发现视频文件: {:?}", path);

        // 调用进度回调
        if let Some(ref callback) = progress_callback {
            callback(video_count);
        }

        results.push(path.to_path_buf());
    }

    info!("[目录扫描] 扫描完成，共发现 {} 个视频文件", video_count);

    results
}

pub fn get_file_size(path: &Path) -> Option<i64> {
    let resolved = resolve_fs_path(path);
    fs::metadata(&resolved).ok().map(|m| m.len() as i64)
}

pub fn extract_title_from_filename(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| {
            s.replace(['.', '_'], " ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_else(|| "Unknown".to_string())
}

pub fn get_video_info(path: &Path) -> Option<(i64, i32, i32)> {
    let resolved = resolve_fs_path(path);
    let path = resolved.as_path();

    info!("[视频信息] 尝试读取视频信息: {:?}", path);

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if extension == "mp4" || extension == "m4v" {
        info!("[视频信息] 使用 mp4 crate 读取: {:?}", path);
        if let Some(result) = get_video_info_mp4(path) {
            info!(
                "[视频信息] mp4 crate 读取成功: duration={}, width={}, height={}",
                result.0, result.1, result.2
            );
            return Some(result);
        }
    }

    info!("[视频信息] 使用 ffprobe 读取: {:?}", path);
    if let Some(result) = get_video_info_ffprobe(path) {
        info!(
            "[视频信息] ffprobe 读取成功: duration={}, width={}, height={}",
            result.0, result.1, result.2
        );
        return Some(result);
    }

    info!("[视频信息] 无法读取视频信息: {:?}", path);
    None
}

fn get_video_info_mp4(path: &Path) -> Option<(i64, i32, i32)> {
    use mp4::Mp4Reader;
    use std::fs::File;

    let f = File::open(path).ok()?;
    let size = f.metadata().ok()?.len();
    let reader = std::io::BufReader::new(f);
    let mp4 = Mp4Reader::read_header(reader, size).ok()?;

    let duration = mp4.duration().as_secs() as i64;

    let mut width = 0i32;
    let mut height = 0i32;

    for track in mp4.tracks().values() {
        if let Ok(mp4::TrackType::Video) = track.track_type() {
            width = track.width() as i32;
            height = track.height() as i32;
            break;
        }
    }

    if duration > 0 && width > 0 && height > 0 {
        Some((duration, width, height))
    } else if duration > 0 {
        Some((duration, 0, 0))
    } else {
        None
    }
}

/// Hard cap on one ffprobe run: a stalled NAS mount must not pin a rayon
/// worker forever — the scan stop flag is only checked between files, so a
/// blocked probe would make "stop scanning" wait on the stuck thread.
const FFPROBE_TIMEOUT: Duration = Duration::from_secs(30);

/// Warn once per process: when ffprobe is missing every probe fails the same
/// way and a per-file warning would flood the log during a full scan.
static FFPROBE_SPAWN_WARNED: AtomicBool = AtomicBool::new(false);

fn get_video_info_ffprobe(path: &Path) -> Option<(i64, i32, i32)> {
    let mut child = match Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=duration,width,height")
        // default writer 输出 key=value 行。之前用 csv=s=x 再按逗号切分，
        // 但 csv 的字段顺序随 ffprobe 版本/容器变化，且 s=x 的输出根本不含
        // 逗号——解析永远失败，ffprobe 路径形同虚设。
        .arg("-of")
        .arg("default=noprint_wrappers=1")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            if !FFPROBE_SPAWN_WARNED.swap(true, Ordering::Relaxed) {
                warn!(
                    "[视频信息] ffprobe 启动失败（请确认 ffmpeg/ffprobe 已安装，且从 GUI 启动时能找到它）: {} — 后续同类失败不再逐条记录",
                    e
                );
            }
            return None;
        }
    };

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if start.elapsed() >= FFPROBE_TIMEOUT {
                    warn!(
                        "[视频信息] ffprobe 超过 {}s 未退出（疑似网络挂载卡死），已终止: {}",
                        FFPROBE_TIMEOUT.as_secs(),
                        path.display()
                    );
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                warn!(
                    "[视频信息] 等待 ffprobe 退出失败: {} — {}",
                    path.display(),
                    e
                );
                let _ = child.kill();
                break None;
            }
        }
    };

    let status = status?;
    if !status.success() {
        // Non-zero exit is normal for non-media files; debug keeps it
        // diagnosable without flooding info-level logs during scans.
        debug!(
            "[视频信息] ffprobe 非零退出（{}）: {}",
            status,
            path.display()
        );
        return None;
    }

    // ffprobe prints a single short CSV line here, well under the pipe
    // buffer, so reading after exit cannot deadlock.
    let mut stdout = String::new();
    if let Some(mut pipe) = child.stdout.take() {
        if let Err(e) = pipe.read_to_string(&mut stdout) {
            debug!(
                "[视频信息] 读取 ffprobe 输出失败: {} — {}",
                path.display(),
                e
            );
            return None;
        }
    }

    // 输出形如（顺序不定，个别字段可能缺失或为 N/A）：
    //   width=320
    //   height=180
    //   duration=4.000000
    let mut duration: Option<i64> = None;
    let mut width = 0i32;
    let mut height = 0i32;
    for line in stdout.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key.trim() {
            "duration" => {
                if let Ok(secs) = value.trim().parse::<f64>() {
                    duration = Some(secs as i64);
                }
            }
            "width" => {
                if let Ok(w) = value.trim().parse() {
                    width = w;
                }
            }
            "height" => {
                if let Ok(h) = value.trim().parse() {
                    height = h;
                }
            }
            _ => {}
        }
    }

    // 与 mp4 crate 路径同一套缺省语义：时长有效才算探针成功，宽高缺失记 0。
    let duration = duration.unwrap_or(0);
    if duration > 0 && width > 0 && height > 0 {
        Some((duration, width, height))
    } else if duration > 0 {
        Some((duration, 0, 0))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Unique writable directory per test.
    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("reelfs_indexer_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn is_video_file_is_case_insensitive_and_strict() {
        assert!(is_video_file(Path::new("/nas/movie.mkv")));
        assert!(is_video_file(Path::new("/nas/movie.MKV")));
        assert!(is_video_file(Path::new("/nas/home.Mp4")));
        assert!(is_video_file(Path::new("/nas/clip.webm")));
        assert!(!is_video_file(Path::new("/nas/movie.txt")));
        assert!(!is_video_file(Path::new("/nas/movie.nfo")));
        assert!(!is_video_file(Path::new("/nas/poster.jpg")));
        assert!(!is_video_file(Path::new("/nas/noextension")));
    }

    #[test]
    fn find_nfo_prefers_same_stem_then_movie_nfo() {
        let dir = temp_dir("nfo_priority");
        let video = dir.join("film.mkv");
        std::fs::write(&video, b"x").unwrap();

        assert_eq!(find_nfo_for_video(&video), None, "no NFO anywhere");

        let movie_nfo = dir.join("movie.nfo");
        std::fs::write(&movie_nfo, b"generic").unwrap();
        assert_eq!(
            find_nfo_for_video(&video).as_deref(),
            Some(movie_nfo.as_path()),
            "movie.nfo is the fallback"
        );

        let own_nfo = dir.join("film.nfo");
        std::fs::write(&own_nfo, b"specific").unwrap();
        assert_eq!(
            find_nfo_for_video(&video).as_deref(),
            Some(own_nfo.as_path()),
            "same-stem NFO must win over movie.nfo"
        );
    }

    #[test]
    fn parse_nfo_joins_genres_and_filters_nameless_actors() {
        let dir = temp_dir("nfo_parse");
        let nfo = dir.join("film.nfo");
        std::fs::write(
            &nfo,
            "<movie>\
                <title>The Film</title>\
                <year>1999</year>\
                <rating>7.5</rating>\
                <plot>Synopsis here</plot>\
                <genre>Action</genre>\
                <genre>Sci-Fi</genre>\
                <director>Someone</director>\
                <actor><name>Named Actor</name></actor>\
                <actor><role>Cameo</role></actor>\
                <actor><name>Other Actor</name></actor>\
             </movie>",
        )
        .unwrap();

        let meta = parse_nfo_file(&nfo).expect("well-formed NFO must parse");
        assert_eq!(meta.title, "The Film");
        assert_eq!(meta.year, Some(1999));
        // 10 分制 7.5 在解析边界换算为 5 分制 3.8
        assert_eq!(meta.rating, Some(3.8));
        assert_eq!(meta.genres.as_deref(), Some("Action, Sci-Fi"));
        assert_eq!(meta.actors.as_deref(), Some("Named Actor, Other Actor"));
    }

    #[test]
    fn normalize_nfo_rating_converts_10_point_scale_and_drops_unreadable() {
        // (5.0, 10.0]：÷2 后四舍五入到 0.1
        assert_eq!(normalize_nfo_rating(Some(8.8)), Some(4.4));
        assert_eq!(normalize_nfo_rating(Some(8.9)), Some(4.5));
        assert_eq!(normalize_nfo_rating(Some(7.5)), Some(3.8));
        assert_eq!(normalize_nfo_rating(Some(10.0)), Some(5.0));
        // 0.0..=5.0：视为已是 5 分制，原样保留
        assert_eq!(normalize_nfo_rating(Some(5.0)), Some(5.0));
        assert_eq!(normalize_nfo_rating(Some(3.7)), Some(3.7));
        assert_eq!(normalize_nfo_rating(Some(0.0)), Some(0.0));
        // NaN / 负数 / >10.0 / 缺失：无法解释，丢弃
        assert_eq!(normalize_nfo_rating(Some(f64::NAN)), None);
        assert_eq!(normalize_nfo_rating(Some(-1.0)), None);
        assert_eq!(normalize_nfo_rating(Some(10.1)), None);
        assert_eq!(normalize_nfo_rating(None), None);
    }

    #[test]
    fn parse_nfo_returns_none_for_malformed_or_missing_files() {
        let dir = temp_dir("nfo_bad");
        let bad = dir.join("bad.nfo");
        std::fs::write(&bad, "<movie><title>unclosed").unwrap();
        assert!(
            parse_nfo_file(&bad).is_none(),
            "malformed XML must yield None"
        );

        assert!(
            parse_nfo_file(&dir.join("missing.nfo")).is_none(),
            "unreadable file must yield None"
        );

        // An NFO without any recognized payload still parses to defaults.
        let empty = dir.join("empty.nfo");
        std::fs::write(&empty, "<movie></movie>").unwrap();
        let meta = parse_nfo_file(&empty).unwrap();
        assert_eq!(meta.title, "Unknown");
    }

    #[test]
    fn extract_title_replaces_separators_and_collapses_space() {
        assert_eq!(
            extract_title_from_filename(Path::new("/nas/The.Matrix.1999.mkv")),
            "The Matrix 1999"
        );
        assert_eq!(
            extract_title_from_filename(Path::new("/nas/some_movie_name.mp4")),
            "some movie name"
        );
        assert_eq!(
            extract_title_from_filename(Path::new("/nas/dots..and___mix.mkv")),
            "dots and mix"
        );
        assert_eq!(
            extract_title_from_filename(Path::new("/nas/keeps-dash.mkv")),
            "keeps-dash"
        );
    }

    #[test]
    fn extract_title_falls_back_to_unknown_without_stem() {
        // A root path has no file stem.
        assert_eq!(extract_title_from_filename(Path::new("/")), "Unknown");
    }

    #[test]
    fn poster_priority_follows_documented_order() {
        let dir = temp_dir("poster_priority");
        let video = dir.join("film.mkv");
        std::fs::write(&video, b"x").unwrap();

        // Add candidates bottom-up and check the winner upgrades each time.
        let fanart = dir.join("fanart.png");
        std::fs::write(&fanart, b"1").unwrap();
        assert_eq!(
            get_poster_path(&video).as_deref(),
            Some(fanart.to_str().unwrap())
        );

        let cover = dir.join("cover.jpg");
        std::fs::write(&cover, b"2").unwrap();
        assert_eq!(
            get_poster_path(&video).as_deref(),
            Some(cover.to_str().unwrap())
        );

        let folder = dir.join("folder.jpg");
        std::fs::write(&folder, b"3").unwrap();
        assert_eq!(
            get_poster_path(&video).as_deref(),
            Some(folder.to_str().unwrap())
        );

        let poster_png = dir.join("poster.png");
        std::fs::write(&poster_png, b"4").unwrap();
        assert_eq!(
            get_poster_path(&video).as_deref(),
            Some(poster_png.to_str().unwrap())
        );

        let poster_jpg = dir.join("poster.jpg");
        std::fs::write(&poster_jpg, b"5").unwrap();
        assert_eq!(
            get_poster_path(&video).as_deref(),
            Some(poster_jpg.to_str().unwrap())
        );
    }

    #[test]
    fn scan_collects_videos_recursively_with_progress() {
        let dir = temp_dir("scan_full");
        std::fs::write(dir.join("a.mkv"), b"x").unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        let sub = dir.join("nested");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("b.MP4"), b"x").unwrap();
        std::fs::write(sub.join("c.jpg"), b"x").unwrap();

        let seen: Arc<Mutex<Vec<usize>>> = Arc::new(Mutex::new(Vec::new()));
        let seen_clone = Arc::clone(&seen);
        let results = scan_directory_with_stop_flag(
            dir.to_str().unwrap(),
            None,
            Some(Arc::new(move |count| {
                seen_clone.lock().unwrap().push(count)
            })),
        );

        assert_eq!(
            results.len(),
            2,
            "only video files, case-insensitive, recursive"
        );
        let counts = seen.lock().unwrap().clone();
        assert_eq!(
            counts.last(),
            Some(&2),
            "progress callback receives a 1-based running count"
        );
        assert_eq!(counts.len(), 2, "callback fires once per video");
    }

    #[test]
    fn scan_stops_early_when_flag_is_set() {
        let dir = temp_dir("scan_stop");
        for i in 0..5 {
            std::fs::write(dir.join(format!("v{}.mkv", i)), b"x").unwrap();
        }

        let stop_flag = Arc::new(AtomicBool::new(false));
        let flag_clone = Arc::clone(&stop_flag);
        let results = scan_directory_with_stop_flag(
            dir.to_str().unwrap(),
            Some(Arc::clone(&stop_flag)),
            Some(Arc::new(move |count| {
                if count >= 2 {
                    flag_clone.store(true, Ordering::Relaxed);
                }
            })),
        );

        assert_eq!(
            results.len(),
            2,
            "setting the flag inside the callback must halt the walk right after that entry"
        );
    }

    #[test]
    fn get_file_size_reports_none_for_missing_files() {
        let dir = temp_dir("file_size");
        let file = dir.join("sized.bin");
        std::fs::write(&file, vec![0u8; 1234]).unwrap();
        assert_eq!(get_file_size(&file), Some(1234));
        assert_eq!(get_file_size(&dir.join("ghost.bin")), None);
    }
}
