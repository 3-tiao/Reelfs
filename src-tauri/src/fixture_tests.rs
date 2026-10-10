//! 基于共享测试数据集的管线级测试。
//!
//! 数据集由 `testdata/manifest.json` 声明、`scripts/gen-testdata.py --fast`
//! 物化到临时目录（内置微型真实 mp4，无 ffmpeg 依赖；个别 probe 断言仍会
//! 调 ffprobe，按 AGENTS.md 走 nix dev shell 时一定有）。测试覆盖完整链路：
//! 目录扫描 → 文件名标题提取 → NFO 元数据 → 海报优先级 → 视频信息探针 →
//! 系列识别 → 数据库写入/搜索/聚合。
//!
//! 同一份数据集也喂给 agent 沙盒（`just dev`，real 模式），所以这里的
//! 文件名形态就是 UI 手测时看到的形态。schema 见 testdata/README.md。

use crate::database::Database;
use crate::indexer::{
    extract_title_from_filename, find_nfo_for_video, get_poster_path, get_video_info,
    normalize_nfo_rating, parse_nfo_file, scan_directory_with_stop_flag,
};
use crate::models::Movie;
use crate::video_group_detector::detect_video_groups;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri 的上级就是仓库根")
        .to_path_buf()
}

fn manifest() -> Value {
    let path = repo_root().join("testdata/manifest.json");
    serde_json::from_str(
        &std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("读 manifest 失败: {e}")),
    )
    .expect("manifest 必须是合法 JSON")
}

/// manifest 里所有 kind == video 的条目。
fn manifest_videos() -> Vec<Value> {
    manifest()["files"]
        .as_array()
        .expect("files 必须是数组")
        .iter()
        .filter(|e| e.get("kind").and_then(|k| k.as_str()) == Some("video"))
        .cloned()
        .collect()
}

/// 把数据集物化到临时目录（整个进程只生成一次，所有测试共用）。
fn fixture_root() -> &'static PathBuf {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    ROOT.get_or_init(|| {
        let out = std::env::temp_dir().join(format!("reelfs_fixture_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&out);
        let script = repo_root().join("scripts/gen-testdata.py");
        let result = Command::new("python3")
            .arg(&script)
            .arg("--out")
            .arg(&out)
            .arg("--mode")
            .arg("fast")
            .output()
            .expect("启动 python3 失败（生成测试数据集需要它）");
        assert!(
            result.status.success(),
            "gen-testdata.py --fast 生成数据集失败\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        out
    })
}

fn rel_path(entry: &Value) -> PathBuf {
    PathBuf::from(entry["path"].as_str().expect("video 条目必须有 path"))
}

fn abs_path(entry: &Value) -> PathBuf {
    fixture_root().join(rel_path(entry))
}

fn expect_str<'a>(entry: &'a Value, key: &str) -> Option<&'a str> {
    entry["expect"].get(key).and_then(|v| v.as_str())
}

/// 用 manifest 期望标题（无则用文件名 stem）构造一个最小 Movie，
/// 模拟扫描管线落库后的形态，供系列识别使用。
fn movie_from_entry(entry: &Value, id: i64) -> Movie {
    let file_path = abs_path(entry);
    let title = expect_str(entry, "title")
        .map(str::to_string)
        .unwrap_or_else(|| {
            file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string()
        });
    Movie {
        id,
        file_path: file_path.to_string_lossy().into_owned(),
        title,
        year: None,
        plot: None,
        rating: None,
        genres: None,
        director: None,
        actors: None,
        thumbnail_path: None,
        file_size: None,
        duration_seconds: None,
        width: None,
        height: None,
        added_at: String::new(),
        updated_at: String::new(),
        last_accessed: None,
        last_checked_at: None,
        scan_state: None,
        is_watched: None,
        group_id: None,
        play_count: 0,
    }
}

#[test]
fn scan_finds_exactly_the_manifest_videos() {
    let root = fixture_root();
    let found = scan_directory_with_stop_flag(root.to_str().unwrap(), None, None);

    let found_rel: HashSet<PathBuf> = found
        .iter()
        .map(|p| {
            p.strip_prefix(root)
                .expect("扫描结果必须仍在根目录下")
                .to_path_buf()
        })
        .collect();
    let expected: HashSet<PathBuf> = manifest_videos().iter().map(rel_path).collect();

    assert_eq!(
        found_rel, expected,
        "扫描结果必须与 manifest 的视频集合完全一致：干扰文件全忽略、\
         大写扩展名可识别、深嵌套递归、8 种扩展名全覆盖"
    );
}

#[test]
fn extracted_titles_match_manifest_expectations() {
    for entry in manifest_videos() {
        if let Some(want) = expect_str(&entry, "title") {
            assert_eq!(
                extract_title_from_filename(&abs_path(&entry)),
                want,
                "path = {}",
                entry["path"].as_str().unwrap()
            );
        }
    }
}

#[test]
fn nfo_metadata_parses_and_same_stem_wins_over_movie_nfo() {
    // 有 nfo_title 期望的条目：NFO 必须能找到并解析出期望标题
    for entry in manifest_videos() {
        if let Some(want) = expect_str(&entry, "nfo_title") {
            let video = abs_path(&entry);
            let nfo = find_nfo_for_video(&video)
                .unwrap_or_else(|| panic!("应能找到 NFO: {}", video.display()));
            let meta =
                parse_nfo_file(&nfo).unwrap_or_else(|| panic!("NFO 应可解析: {}", nfo.display()));
            assert_eq!(meta.title, want, "path = {}", video.display());
        }
    }

    // 双重 NFO：同名 NFO 必须胜过 movie.nfo
    let dual = fixture_root().join("Kodi 式单片/双重NFO (2001)/双重NFO (2001).mkv");
    let chosen = find_nfo_for_video(&dual).expect("双重 NFO 场景必有 NFO");
    assert_eq!(
        chosen.file_name().and_then(|s| s.to_str()),
        Some("双重NFO (2001).nfo")
    );

    // 全字段解析（Kodi 式 movie.nfo）
    let inception = fixture_root().join("Kodi 式单片/Inception (2010)/Inception (2010).mp4");
    let meta = parse_nfo_file(&find_nfo_for_video(&inception).unwrap()).expect("应可解析");
    assert_eq!(meta.title, "Inception");
    assert_eq!(meta.year, Some(2010));
    // NFO 10 分制评分在解析边界换算为应用 5 分制（manifest 8.8 → 4.4）
    assert_eq!(meta.rating, Some(4.4));
    assert_eq!(meta.genres.as_deref(), Some("Sci-Fi, Action"));
    assert_eq!(meta.director.as_deref(), Some("Christopher Nolan"));
    assert_eq!(
        meta.actors.as_deref(),
        Some("Leonardo DiCaprio, Elliot Page")
    );

    // 盗梦空间（manifest rating 8.9）同样换算（→ 4.5）
    let dd_video = fixture_root().join("Kodi 式单片/盗梦空间 (2010)/盗梦空间 (2010).mp4");
    let dd_meta =
        parse_nfo_file(&find_nfo_for_video(&dd_video).unwrap()).expect("盗梦空间 NFO 应可解析");
    assert_eq!(dd_meta.rating, Some(4.5));
}

#[test]
fn poster_priority_follows_manifest_pins() {
    for entry in manifest_videos() {
        if let Some(want) = expect_str(&entry, "poster") {
            let video = abs_path(&entry);
            let got =
                get_poster_path(&video).unwrap_or_else(|| panic!("应有海报: {}", video.display()));
            assert_eq!(
                Path::new(&got).file_name().and_then(|s| s.to_str()),
                Some(want),
                "海报优先级不符: {}",
                video.display()
            );
        }
    }
    // 「海报全家福」文件夹放了全部 6 种候选，必须选中优先级最高的 poster.jpg
    let hoarder = fixture_root().join("Kodi 式单片/海报全家福 (1998)/海报全家福 (1998).avi");
    let got = get_poster_path(&hoarder).expect("六种候选必有胜者");
    assert!(got.ends_with("poster.jpg"), "胜者应是 poster.jpg: {got}");
}

/// fast 模式所有正常视频是同一个真实 mp4（ffprobe 按容器内容读，不看扩展名），
/// 所以 .mp4（mp4 crate 路径）和 .mkv（ffprobe 路径）都应探出信息；
/// 损坏/空文件必须返回 None 而不是 panic。
#[test]
fn probe_succeeds_for_real_videos_and_fails_for_corrupt_ones() {
    let mp4_path = fixture_root().join("Kodi 式单片/Inception (2010)/Inception (2010).mp4");
    assert!(get_video_info(&mp4_path).is_some(), "mp4 crate 路径应成功");

    let mkv_path = fixture_root().join("平铺电影/The.Matrix.1999.mkv");
    assert!(
        get_video_info(&mkv_path).is_some(),
        "ffprobe 路径应成功（内容是真实 mp4）"
    );

    let corrupt = fixture_root().join("平铺电影/损坏文件.mp4");
    assert!(get_video_info(&corrupt).is_none(), "损坏文件探针应为 None");

    let empty = fixture_root().join("平铺电影/空文件.mp4");
    assert!(get_video_info(&empty).is_none(), "空文件探针应为 None");
}

#[test]
fn group_detection_matches_manifest_groups() {
    let videos = manifest_videos();
    let movies: Vec<Movie> = videos
        .iter()
        .enumerate()
        .map(|(i, e)| movie_from_entry(e, i as i64 + 1))
        .collect();
    let id_by_path: HashMap<&str, i64> = movies
        .iter()
        .map(|m| (m.file_path.as_str(), m.id))
        .collect();

    // manifest 期望：组名 → part 列表
    let mut expected: BTreeMap<String, Vec<i32>> = BTreeMap::new();
    for entry in &videos {
        if let Some(group) = expect_str(entry, "group") {
            let part = entry["expect"]["part"].as_i64().expect("group 必配 part") as i32;
            expected.entry(group.to_string()).or_default().push(part);
        }
    }
    for parts in expected.values_mut() {
        parts.sort_unstable();
    }

    let mut got: BTreeMap<String, Vec<i32>> = BTreeMap::new();
    for group in detect_video_groups(&movies) {
        got.insert(
            group.title.clone(),
            group.movies.iter().map(|m| m.part_number).collect(),
        );
    }
    // detect 返回的 parts 已按 part_number 升序（与 expected 排序后一致）
    assert_eq!(got, expected, "系列识别结果必须与 manifest 声明一致");

    // 标记 no_group 的条目（如孤独的单部 CD1）不得混入任何组
    let grouped_ids: HashSet<i64> = detect_video_groups(&movies)
        .iter()
        .flat_map(|g| g.movies.iter().map(|m| m.movie.id))
        .collect();
    for entry in &videos {
        if entry["expect"].get("no_group").is_some() {
            let id = id_by_path[abs_path(entry).to_string_lossy().as_ref()];
            assert!(
                !grouped_ids.contains(&id),
                "单部匹配不应成组: {}",
                entry["path"].as_str().unwrap()
            );
        }
    }
}

/// 数据库往返：manifest 全量落库 → 计数、FTS 搜索、演员/类型聚合、观看状态。
/// 这条测试同时钉住 movies 表 schema 与扫描产物形态的兼容性。
#[test]
fn database_roundtrip_from_fixture() {
    let db_path = std::env::temp_dir().join(format!("reelfs_fixture_db_{}.db", std::process::id()));
    let _ = std::fs::remove_file(&db_path);
    let db = Database::new(db_path.to_str().unwrap()).expect("建库失败");

    let videos = manifest_videos();
    for entry in &videos {
        let video = abs_path(entry);
        let file_size = std::fs::metadata(&video).map(|m| m.len() as i64).ok();

        let (title, year, plot, rating, genres, director, actors) =
            if let Some(nfo) = entry.get("nfo") {
                // 与扫描管线一致：有 NFO 时元数据以 NFO 为准
                let genres = nfo["genres"].as_array().map(|gs| {
                    gs.iter()
                        .filter_map(|g| g.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                });
                let actors = nfo["actors"].as_array().map(|as_| {
                    as_.iter()
                        .filter_map(|a| a.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                });
                (
                    nfo["title"].as_str().unwrap_or("Unknown").to_string(),
                    nfo["year"].as_i64().map(|y| y as i32),
                    nfo["plot"].as_str().map(str::to_string),
                    // 与扫描管线一致：10 分制经 normalize_nfo_rating 换算
                    normalize_nfo_rating(nfo["rating"].as_f64()),
                    genres,
                    nfo["director"].as_str().map(str::to_string),
                    actors,
                )
            } else {
                (
                    extract_title_from_filename(&video),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                )
            };

        db.insert_movie(
            &video.to_string_lossy(),
            &title,
            year,
            plot.as_deref(),
            rating,
            genres.as_deref(),
            director.as_deref(),
            actors.as_deref(),
            file_size,
            None,
            None,
            None,
        )
        .expect("插入失败");
    }

    let all = db.get_all_movies().unwrap();
    assert_eq!(all.len(), videos.len(), "入库数量应与 manifest 视频数一致");

    // NFO 10 分制评分换算 5 分制后落库（8.8→4.4、8.9→4.5），
    // 不再被 sanitize_rating 的 0.0..=5.0 窗口清 NULL
    let rating_of = |sub: &str| {
        all.iter()
            .find(|m| m.file_path.contains(sub))
            .unwrap_or_else(|| panic!("库中应有 {sub}"))
            .rating
    };
    assert_eq!(rating_of("Inception (2010).mp4"), Some(4.4));
    assert_eq!(rating_of("盗梦空间 (2010).mp4"), Some(4.5));

    // FTS 搜索（触发器在 insert 时已维护 movie_fts）
    let hits = db.search_movies("Matrix", 0, 50).unwrap();
    assert!(
        hits.iter().any(|m| m.title == "The Matrix"),
        "搜索 Matrix 应命中 NFO 标题: {:?}",
        hits.iter().map(|m| m.title.as_str()).collect::<Vec<_>>()
    );

    // 演员/类型聚合吃的是 NFO 的逗号拼接串
    let actors = db.get_unique_actors().unwrap();
    assert!(
        actors.contains(&"Keanu Reeves".to_string()),
        "actors: {actors:?}"
    );
    assert!(
        actors.contains(&"莱昂纳多·迪卡普里奥".to_string()),
        "actors: {actors:?}"
    );
    let genres = db.get_unique_genres().unwrap();
    assert!(genres.contains(&"科幻".to_string()), "genres: {genres:?}");

    // 观看状态往返
    let inception_path = fixture_root()
        .join("Kodi 式单片/Inception (2010)/Inception (2010).mp4")
        .to_string_lossy()
        .into_owned();
    let m = db
        .get_movie_by_path(&inception_path)
        .expect("查询失败")
        .expect("Inception 应已入库");
    db.set_watched_status(m.id, true).unwrap();
    assert_eq!(db.get_movie_by_id(m.id).unwrap().is_watched, Some(1));
}
