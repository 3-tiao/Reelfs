// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod database;
mod indexer;
mod import_manager;
mod models;
mod path_utils;
mod player;
mod thumbnail;
mod video_group;
mod video_group_detector;
mod watcher;

use database::Database;
use models::{AppConfig, Movie, PlayHistory, ScanStatus, Stats, VideoGroup, VideoGroupWithParts};
use video_group::VideoGroupManager;
use video_group_detector::{detect_video_groups, VideoGroupCandidate};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::fs;
use std::path::Path;
use log::{info, debug, warn, error};

struct AppState {
    db: Arc<Mutex<Database>>,
    config: Arc<Mutex<AppConfig>>,
    scan_status: Arc<Mutex<ScanStatus>>,
    stop_scan_flag: Arc<AtomicBool>,
}

#[tauri::command]
async fn get_movies(
    state: tauri::State<'_, AppState>,
    offset: i32,
    limit: i32,
) -> Result<Vec<Movie>, String> {
    info!("[API] get_movies 调用: offset={}, limit={}", offset, limit);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let movies = db.get_movies(offset, limit)
        .map_err(|e| {
            error!("[API] get_movies 失败: {}", e);
            format!("Database error: {}", e)
        })?;
    
    info!("[API] get_movies 返回: {} 个电影", movies.len());
    if !movies.is_empty() {
        info!("[API] 第一个电影: id={}, title={}, thumbnail_path={:?}", 
              movies[0].id, movies[0].title, movies[0].thumbnail_path);
    }
    
    Ok(movies)
}

#[tauri::command]
async fn get_movie_detail(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(Movie, Option<PlayHistory>), String> {
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let movie = db.get_movie_by_id(id)
        .map_err(|e| format!("Database error: {}", e))?;
    let history = db.get_play_history(id)
        .map_err(|e| format!("Database error: {}", e))?;
    Ok((movie, history))
}

#[tauri::command]
async fn search_movies(
    state: tauri::State<'_, AppState>,
    query: String,
    offset: i32,
    limit: i32,
) -> Result<Vec<Movie>, String> {
    info!("[API] search_movies 调用: query='{}', offset={}, limit={}", query, offset, limit);
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let movies = db.search_movies(&query, offset, limit)
        .map_err(|e| {
            error!("[API] search_movies 失败: {}", e);
            format!("Database error: {}", e)
        })?;
    info!("[API] search_movies 返回: {} 个电影", movies.len());
    Ok(movies)
}

#[tauri::command]
async fn start_initial_scan(
    state: tauri::State<'_, AppState>,
    window: tauri::Window,
    scan_mode: String,
    delete_invalid: bool,
) -> Result<String, String> {
    info!("[导入管理器] 开始扫描: mode={}, delete_invalid={}", scan_mode, delete_invalid);
    
    let config = state.config.lock().map_err(|e| format!("Config lock error: {}", e))?.clone();
    let db = Arc::clone(&state.db);
    let scan_status = Arc::clone(&state.scan_status);
    let stop_scan_flag = Arc::clone(&state.stop_scan_flag);
    
    let manager = import_manager::ImportManager::new(db, config, scan_status, stop_scan_flag, window, scan_mode, delete_invalid);
    manager.start_import().map(|_| "Import started".to_string())
}

#[tauri::command]
async fn get_scan_status(state: tauri::State<'_, AppState>) -> Result<ScanStatus, String> {
    Ok(state.scan_status.lock().map_err(|e| format!("Status lock error: {}", e))?.clone())
}

#[tauri::command]
async fn play_movie(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    info!("[播放器] 开始播放: movie_id={}", id);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let movie = db.get_movie_by_id(id)
        .map_err(|e| {
            error!("[播放器] 获取电影信息失败: {}", e);
            format!("Movie not found: {}", e)
        })?;
    
    let history = db.get_play_history(id)
        .map_err(|e| {
            error!("[播放器] 获取播放历史失败: {}", e);
            format!("Database error: {}", e)
        })?;
    
    let start_position = history.map(|h| {
        debug!("[播放器] 播放历史: last_position={}s, play_count={}", h.last_position, h.play_count);
        h.last_position
    });
    
    // 自动标记为已观看
    if let Err(e) = db.set_watched_status(id, true) {
        warn!("[播放器] 设置观看状态失败: {}", e);
    }
    
    // 增加播放次数
    if let Err(e) = db.increment_play_count(id) {
        warn!("[播放器] 增加播放次数失败: {}", e);
    }
    
    player::play_movie(&movie.file_path, start_position)?;
    
    info!("[播放器] 播放器启动成功: {}", movie.file_path);
    
    Ok(())
}

#[tauri::command]
async fn show_in_file_manager(file_path: String) -> Result<(), String> {
    info!("[文件管理器] 在文件管理器中显示: {}", file_path);
    
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg("-R")
            .arg(&file_path)
            .spawn()
            .map_err(|e| {
                error!("[文件管理器] 打开失败: {}", e);
                format!("Failed to open in Finder: {}", e)
            })?;
    }
    
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| {
                error!("[文件管理器] 打开失败: {}", e);
                format!("Failed to open in file manager: {}", e)
            })?;
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        return Err("Unsupported platform".to_string());
    }
    
    info!("[文件管理器] 文件管理器打开成功");
    
    Ok(())
}

#[tauri::command]
async fn update_play_progress(
    state: tauri::State<'_, AppState>,
    id: i64,
    position: f64,
) -> Result<(), String> {
    debug!("[播放器] 更新播放进度: movie_id={}, position={}s", id, position);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db.update_play_history(id, position)
        .map_err(|e| {
            error!("[播放器] 更新播放进度失败: {}", e);
            format!("Database error: {}", e)
        })
}

#[tauri::command]
async fn set_watched_status(
    state: tauri::State<'_, AppState>,
    id: i64,
    is_watched: bool,
) -> Result<(), String> {
    info!("[API] 设置观看状态: id={}, is_watched={}", id, is_watched);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db.set_watched_status(id, is_watched)
        .map_err(|e| {
            error!("[API] 设置观看状态失败: {}", e);
            format!("Database error: {}", e)
        })
}

#[tauri::command]
async fn get_stats(state: tauri::State<'_, AppState>) -> Result<Stats, String> {
    debug!("[数据查询] 获取统计信息");
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let config = state.config.lock().map_err(|e| format!("Config lock error: {}", e))?;
    
    let total_movies = db.get_total_count()
        .map_err(|e| {
            error!("[数据查询] 获取电影总数失败: {}", e);
            format!("Database error: {}", e)
        })?;
    
    let db_path = &config.db_path;
    let db_size = fs::metadata(db_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);
    
    let cache_size = thumbnail::get_cache_size(&config.cache_dir)
        .map(|s| s as i64)
        .unwrap_or(0);
    
    debug!("[数据查询] 统计信息: total={}, db_size={}MB, cache_size={}MB", 
           total_movies, db_size / 1024 / 1024, cache_size / 1024 / 1024);
    
    Ok(Stats {
        total_movies,
        total_size: 0,
        db_size,
        cache_size,
    })
}

#[tauri::command]
async fn get_config(state: tauri::State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.lock().map_err(|e| format!("Config lock error: {}", e))?.clone())
}

#[tauri::command]
async fn update_config(
    state: tauri::State<'_, AppState>,
    config: AppConfig,
) -> Result<(), String> {
    info!("[设置] 更新配置: nas_paths={:?}", config.nas_paths);
    
    let config_path = get_config_path();
    if let Some(parent) = Path::new(&config_path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| {
                error!("[设置] 创建配置目录失败: {}", e);
                format!("Failed to create config directory: {}", e)
            })?;
    }
    
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| {
            error!("[设置] 序列化配置失败: {}", e);
            format!("Failed to serialize config: {}", e)
        })?;
    
    fs::write(&config_path, json)
        .map_err(|e| {
            error!("[设置] 写入配置文件失败: {}", e);
            format!("Failed to write config: {}", e)
        })?;
    
    *state.config.lock().map_err(|e| format!("Config lock error: {}", e))? = config;
    
    info!("[设置] 配置更新成功");
    
    Ok(())
}

#[tauri::command]
async fn generate_thumbnail(
    state: tauri::State<'_, AppState>,
    movie_id: i64,
) -> Result<String, String> {
    info!("[缩略图生成] 开始生成缩略图: movie_id={}", movie_id);

    // --- Phase 1: Gather required data, then immediately release locks ---
    let (file_path, existing_thumbnail, thumbnail_path) = {
        let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let config = state.config.lock().map_err(|e| format!("Config lock error: {}", e))?;

        let movie = db.get_movie_by_id(movie_id)
            .map_err(|e| {
                error!("[缩略图生成] 获取电影信息失败: {}", e);
                format!("Movie not found: {}", e)
            })?;

        let thumb_path = thumbnail::get_thumbnail_path(&config.cache_dir, movie_id);
        (movie.file_path, movie.thumbnail_path, thumb_path)
        // db and config locks are released HERE
    };

    // Return early if cached thumbnail already exists on disk
    if let Some(ref t) = existing_thumbnail {
        if Path::new(t).exists() {
            debug!("[缩略图生成] 使用缓存: {}", t);
            return Ok(t.clone());
        }
    }
    if Path::new(&thumbnail_path).exists() {
        debug!("[缩略图生成] 缩略图文件已存在: {}", thumbnail_path);
        return Ok(thumbnail_path);
    }

    // --- Phase 2: Find poster path (sync filesystem check, no lock held) ---
    let video_path = Path::new(&file_path);
    let poster = indexer::get_poster_path(video_path);

    let poster = match poster {
        Some(p) => p,
        None => {
            warn!("[缩略图生成] 无海报可用，无法生成缩略图");
            return Err("No poster available for thumbnail generation".to_string());
        }
    };

    debug!("[缩略图生成] 源文件: {}", poster);
    debug!("[缩略图生成] 目标文件: {}", thumbnail_path);

    // --- Phase 3: Do image processing in a blocking thread (no lock held) ---
    let poster_clone = poster.clone();
    let output_clone = thumbnail_path.clone();
    tokio::task::spawn_blocking(move || {
        thumbnail::generate_thumbnail(&poster_clone, &output_clone)
    })
    .await
    .map_err(|e| format!("spawn_blocking error: {}", e))?
    .map_err(|e| {
        error!("[缩略图生成] 图像处理失败: {}", e);
        format!("Failed to generate thumbnail: {}", e)
    })?;

    // --- Phase 4: Update DB (brief lock re-acquisition) ---
    {
        let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        db.update_thumbnail_path(movie_id, &thumbnail_path)
            .map_err(|e| {
                error!("[缩略图生成] 更新缩略图路径失败: {}", e);
                format!("Failed to update thumbnail path: {}", e)
            })?;
    }

    info!("[缩略图生成] 缩略图生成成功: {}", thumbnail_path);
    Ok(thumbnail_path)
}


#[tauri::command]
async fn regenerate_all_thumbnails(
    state: tauri::State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    info!("[缩略图生成] 开始重新生成所有缩略图");

    let cache_dir = state.config.lock()
        .map_err(|e| format!("Config lock error: {}", e))?
        .cache_dir
        .clone();

    let movies: Vec<(i64, String, String)> = state.db.lock()
        .map_err(|e| format!("Database lock error: {}", e))?
        .get_all_movies()
        .map_err(|e| format!("Failed to load movies: {}", e))?
        .into_iter()
        .map(|m| (m.id, m.title, m.file_path))
        .collect();

    let total_thumbnails = movies.len();
    info!("[缩略图生成] 找到 {} 个电影需要重新生成缩略图", total_thumbnails);

    let _ = window.emit("scan-progress", ScanStatus {
        is_scanning: true,
        stage: models::ImportStage::GeneratingThumbnails,
        stage_message: "重新生成缩略图中...".to_string(),
        total_files: total_thumbnails,
        scanned_files: 0,
        current_file: None,
    });

    let mut thumbnail_count = 0;

    for (movie_id, title, file_path) in &movies {
        let video_path = Path::new(file_path);
        let poster = indexer::get_poster_path(video_path);

        if let Some(poster) = poster {
            let thumbnail_path = thumbnail::get_thumbnail_path(&cache_dir, *movie_id);

            if Path::new(&thumbnail_path).exists() {
                let _ = fs::remove_file(&thumbnail_path);
            }

            debug!("[缩略图生成] 处理缩略图: id={}, title={}", movie_id, title);

            match thumbnail::generate_thumbnail(&poster, &thumbnail_path) {
                Ok(_) => {
                    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                    let _ = db.update_thumbnail_path(*movie_id, &thumbnail_path);
                    thumbnail_count += 1;
                    debug!("[缩略图生成] 缩略图成功: id={}", movie_id);

                    {
                        let status = ScanStatus {
                            is_scanning: true,
                            stage: models::ImportStage::GeneratingThumbnails,
                            stage_message: format!("重新生成缩略图: {}/{}", thumbnail_count, total_thumbnails),
                            total_files: total_thumbnails,
                            scanned_files: thumbnail_count,
                            current_file: Some(format!("生成缩略图: {}", title)),
                        };
                        let _ = window.emit("scan-progress", status);
                    }
                }
                Err(e) => {
                    error!("[缩略图生成] 缩略图失败: id={}, error={}", movie_id, e);
                }
            }
        }
    }

    info!("[缩略图生成] 重新生成缩略图完成: {}/{} 个", thumbnail_count, total_thumbnails);

    let _ = window.emit("scan-progress", ScanStatus {
        is_scanning: false,
        stage: models::ImportStage::GeneratingThumbnails,
        stage_message: "缩略图重建完成".to_string(),
        total_files: total_thumbnails,
        scanned_files: total_thumbnails,
        current_file: None,
    });

    Ok(format!("成功重新生成 {} / {} 个缩略图", thumbnail_count, total_thumbnails))
}

#[tauri::command]
async fn reset_database(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    info!("[数据库] 开始重置数据库");

    let cache_dir = state.config.lock()
        .map_err(|e| format!("Config lock error: {}", e))?
        .cache_dir
        .clone();

    {
        let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        db.clear_all_movies().map_err(|e| format!("清空数据库失败: {}", e))?;
    }

    thumbnail::clear_cache(&cache_dir)
        .map_err(|e| format!("清理缩略图缓存失败: {}", e))?;

    info!("[数据库] 数据库重置完成");

    Ok(())
}

#[tauri::command]
async fn stop_scan(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    info!("[扫描] 停止扫描");
    
    state.stop_scan_flag.store(true, Ordering::SeqCst);

    info!("[扫描] 停止标志已设置");
    
    Ok(())
}

#[tauri::command]
async fn get_and_update_video_info(
    id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<(Option<i64>, Option<i32>, Option<i32>), String> {
    info!("[视频信息] 获取视频信息: id={}", id);

    let file_path = {
        let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        match db.get_movie_by_id(id) {
            Ok(movie) => movie.file_path,
            Err(e) => return Err(format!("获取电影失败: {}", e)),
        }
    };

    let file_path_for_probe = file_path.clone();
    let (duration_seconds, width, height) = tokio::task::spawn_blocking(move || {
        indexer::get_video_info(std::path::Path::new(&file_path_for_probe))
    })
        .await
        .map_err(|e| format!("视频探测任务失败: {}", e))?
        .map(|(d, w, h)| (Some(d), Some(w), Some(h)))
        .unwrap_or((None, None, None));

    if duration_seconds.is_some() || width.is_some() || height.is_some() {
        let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        if let Err(e) = db.update_video_info(id, duration_seconds, width, height) {
            return Err(format!("更新视频信息失败: {}", e));
        }
        info!("[视频信息] 更新成功: id={}, duration={:?}, width={:?}, height={:?}", id, duration_seconds, width, height);
    }
    
    Ok((duration_seconds, width, height))
}

#[tauri::command]
async fn clear_cache(state: tauri::State<'_, AppState>) -> Result<(), String> {
    info!("[设置] 开始清理缓存");

    let cache_dir = state.config.lock()
        .map_err(|e| format!("Config lock error: {}", e))?
        .cache_dir
        .clone();

    thumbnail::clear_cache(&cache_dir)
        .map_err(|e| {
            error!("[设置] 清理缓存失败: {}", e);
            format!("Failed to clear cache: {}", e)
        })?;

    state.db.lock()
        .map_err(|e| format!("Database lock error: {}", e))?
        .clear_all_thumbnail_paths()
        .map_err(|e| format!("Failed to clear thumbnail paths: {}", e))?;

    info!("[设置] 缓存清理完成");

    Ok(())
}

#[tauri::command]
async fn delete_invalid_records(state: tauri::State<'_, AppState>) -> Result<(), String> {
    info!("[设置] 开始删除失效记录");
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let count = db.delete_invalid_records()
        .map_err(|e| {
            error!("[设置] 删除失效记录失败: {}", e);
            format!("Failed to delete invalid records: {}", e)
        })?;
    
    info!("[设置] 删除失效记录完成: {} 条", count);
    
    Ok(())
}

#[tauri::command]
async fn update_thumbnail_path(
    state: tauri::State<'_, AppState>,
    movie_id: i64,
    thumbnail_path: String,
) -> Result<(), String> {
    info!("[缩略图生成] 更新缩略图路径: movie_id={}, path={}", movie_id, thumbnail_path);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db.update_thumbnail_path(movie_id, &thumbnail_path)
        .map_err(|e| {
            error!("[缩略图生成] 更新缩略图路径失败: {}", e);
            format!("Failed to update thumbnail path: {}", e)
        })?;
    
    info!("[缩略图生成] 缩略图路径更新成功: movie_id={}", movie_id);
    
    Ok(())
}

#[tauri::command]
async fn set_movie_rating(
    state: tauri::State<'_, AppState>,
    movie_id: i64,
    rating: Option<f64>,
) -> Result<(), String> {
    info!("[API] set_movie_rating 调用: movie_id={}, rating={:?}", movie_id, rating);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db.set_movie_rating(movie_id, rating)
        .map_err(|e| {
            error!("[API] 设置电影评级失败: {}", e);
            format!("Failed to set movie rating: {}", e)
        })?;
    
    info!("[API] 电影评级设置成功: movie_id={}, rating={:?}", movie_id, rating);
    
    Ok(())
}

#[tauri::command]
async fn get_movies_filtered(
    state: tauri::State<'_, AppState>,
    offset: i32,
    limit: i32,
    search_query: Option<String>,
    min_year: Option<i32>,
    max_year: Option<i32>,
    min_rating: Option<f64>,
    max_rating: Option<f64>,
    actors: Option<String>,
    genres: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    is_watched: Option<bool>,
) -> Result<Vec<Movie>, String> {
    info!("[API] get_movies_filtered 调用: offset={}, limit={}, query={:?}, filters={:?}, sort={:?} {:?}",
           offset, limit, &search_query, (min_year, max_year, min_rating, max_rating, &actors, &genres, is_watched), sort_by, sort_order);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let movies = db.get_movies_with_filters(offset, limit, search_query, min_year, max_year, min_rating, max_rating, actors, genres, sort_by, sort_order, is_watched)
        .map_err(|e| {
            error!("[API] get_movies_filtered 失败: {}", e);
            format!("Database error: {}", e)
        })?;
    
    info!("[API] get_movies_filtered 返回: {} 个电影", movies.len());
    
    Ok(movies)
}

#[tauri::command]
async fn get_unique_genres(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    info!("[API] get_unique_genres 调用");
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let genres = db.get_unique_genres()
        .map_err(|e| {
            error!("[API] get_unique_genres 失败: {}", e);
            format!("Database error: {}", e)
        })?;
    
    info!("[API] get_unique_genres 返回: {} 个类型", genres.len());
    
    Ok(genres)
}

#[tauri::command]
async fn get_unique_actors(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    info!("[API] get_unique_actors 调用");
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let actors = db.get_unique_actors()
        .map_err(|e| {
            error!("[API] get_unique_actors 失败: {}", e);
            format!("Database error: {}", e)
        })?;
    
    info!("[API] get_unique_actors 返回: {} 个演员", actors.len());
    
    Ok(actors)
}

#[tauri::command]
async fn get_actors_with_counts(state: tauri::State<'_, AppState>) -> Result<Vec<models::ActorInfo>, String> {
    info!("[API] get_actors_with_counts 调用");
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let actors = db.get_actors_with_counts()
        .map_err(|e| {
            error!("[API] get_actors_with_counts 失败: {}", e);
            format!("Database error: {}", e)
        })?;
    
    info!("[API] get_actors_with_counts 返回: {} 个演员", actors.len());
    
    Ok(actors)
}

fn get_config_path() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| String::from("."));
    format!("{}/.reelfs/config.json", home)
}

fn load_config() -> AppConfig {
    let config_path = get_config_path();
    
    if let Ok(content) = fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str(&content) {
            return config;
        }
    }
    
    AppConfig::default()
}

#[tauri::command]
async fn get_video_groups(
    state: tauri::State<'_, AppState>,
    offset: i32,
    limit: i32,
) -> Result<Vec<VideoGroup>, String> {
    info!("[API] get_video_groups 调用: offset={}, limit={}", offset, limit);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let manager = VideoGroupManager::new(db.get_connection());
    
    let groups = manager.get_all_video_groups(offset, limit)
        .map_err(|e| {
            error!("[API] get_video_groups 失败: {}", e);
            format!("Database error: {}", e)
        })?;
    
    info!("[API] get_video_groups 返回: {} 个视频组", groups.len());
    Ok(groups)
}

#[tauri::command]
async fn get_video_group_detail(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<VideoGroupWithParts, String> {
    info!("[API] get_video_group_detail 调用: id={}", id);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let manager = VideoGroupManager::new(db.get_connection());
    
    let group = manager.get_video_group_with_parts(id)
        .map_err(|e| {
            error!("[API] get_video_group_detail 失败: {}", e);
            format!("Database error: {}", e)
        })?
        .ok_or_else(|| format!("Video group not found: {}", id))?;
    
    info!("[API] get_video_group_detail 返回: {} 个片段", group.parts.len());
    Ok(group)
}

#[tauri::command]
async fn create_video_group(
    state: tauri::State<'_, AppState>,
    title: String,
    year: Option<i32>,
    plot: Option<String>,
    rating: Option<f64>,
    genres: Option<String>,
    director: Option<String>,
    actors: Option<String>,
    poster_path: Option<String>,
) -> Result<i64, String> {
    info!("[API] create_video_group 调用: title={}", title);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let manager = VideoGroupManager::new(db.get_connection());
    
    let id = manager.create_video_group(
        &title,
        year,
        plot.as_deref(),
        rating,
        genres.as_deref(),
        director.as_deref(),
        actors.as_deref(),
        poster_path.as_deref(),
    ).map_err(|e| {
        error!("[API] create_video_group 失败: {}", e);
        format!("Database error: {}", e)
    })?;
    
    info!("[API] create_video_group 成功: id={}", id);
    Ok(id)
}

#[tauri::command]
async fn add_video_part(
    state: tauri::State<'_, AppState>,
    group_id: i64,
    movie_id: i64,
    part_number: i32,
    part_title: Option<String>,
) -> Result<i64, String> {
    info!("[API] add_video_part 调用: group_id={}, movie_id={}, part_number={}", 
          group_id, movie_id, part_number);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let manager = VideoGroupManager::new(db.get_connection());
    
    let id = manager.add_video_part(
        group_id,
        movie_id,
        part_number,
        part_title.as_deref(),
    ).map_err(|e| {
        error!("[API] add_video_part 失败: {}", e);
        format!("Database error: {}", e)
    })?;
    
    info!("[API] add_video_part 成功: part_id={}", id);
    Ok(id)
}

#[tauri::command]
async fn delete_video_group(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    info!("[API] delete_video_group 调用: id={}", id);
    
    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let manager = VideoGroupManager::new(db.get_connection());
    
    manager.delete_video_group(id).map_err(|e| {
        error!("[API] delete_video_group 失败: {}", e);
        format!("Database error: {}", e)
    })?;
    
    info!("[API] delete_video_group 成功");
    Ok(())
}

#[tauri::command]
async fn auto_detect_video_groups(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<VideoGroupCandidate>, String> {
    info!("[API] auto_detect_video_groups 调用");

    let db = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let movies = db.get_all_movies()
        .map_err(|e| format!("Database error: {}", e))?;

    let candidates = detect_video_groups(&movies);
    
    info!("[API] auto_detect_video_groups 返回: {} 个候选组", candidates.len());
    Ok(candidates)
}

#[tauri::command]
async fn check_file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
async fn frontend_log(level: String, message: String) -> Result<(), String> {
    match level.as_str() {
        "error" => error!("[前端] {}", message),
        "warn"  => warn!("[前端] {}", message),
        "info"  => info!("[前端] {}", message),
        "debug" => debug!("[前端] {}", message),
        "trace" => log::trace!("[前端] {}", message),
        _       => info!("[前端] {}", message),
    }
    Ok(())
}

use log4rs::{
    append::{
        console::{ConsoleAppender, Target},
        rolling_file::{
            policy::compound::{
                roll::fixed_window::FixedWindowRoller, trigger::size::SizeTrigger, CompoundPolicy,
            },
            RollingFileAppender,
        },
    },
    config::{Appender, Config as LogConfig, Root},
    encode::pattern::PatternEncoder,
};

fn init_logger() {
    let home = std::env::var("HOME").unwrap_or_else(|_| String::from("."));
    let log_dir = format!("{}/.reelfs/logs", home);
    let log_file = format!("{}/reelfs.log", log_dir);
    
    // Ensure log directory exists
    let _ = fs::create_dir_all(&log_dir);

    let pattern = "{d(%Y-%m-%d %H:%M:%S)} {l} {t} - {m}{n}";

    // Console appender
    let stdout = ConsoleAppender::builder()
        .target(Target::Stdout)
        .encoder(Box::new(PatternEncoder::new(pattern)))
        .build();

    // 10MB per file, keep 5 old files max
    let window_size = 5;
    let fixed_window_roller = FixedWindowRoller::builder()
        .build(&format!("{}/reelfs.{{}}.log", log_dir), window_size)
        .unwrap();

    let size_trigger = SizeTrigger::new(10 * 1024 * 1024); // 10 MB

    let compound_policy = CompoundPolicy::new(Box::new(size_trigger), Box::new(fixed_window_roller));

    let file_appender = RollingFileAppender::builder()
        .encoder(Box::new(PatternEncoder::new(pattern)))
        .build(log_file, Box::new(compound_policy))
        .unwrap();

    let config = LogConfig::builder()
        .appender(Appender::builder().build("stdout", Box::new(stdout)))
        .appender(Appender::builder().build("file", Box::new(file_appender)))
        .build(
            Root::builder()
                .appender("stdout")
                .appender("file")
                .build(log::LevelFilter::Info),
        )
        .unwrap();

    let _ = log4rs::init_config(config);
}

fn main() {
    let start_time = std::time::Instant::now();
    
    // 初始化日志系统 (Rolling File + Console)
    init_logger();
    
    info!("[应用启动] 开始初始化应用");
    
    let config = load_config();
    
    info!("[应用启动] 配置文件加载完成: db_path={}, cache_dir={}", config.db_path, config.cache_dir);
    info!("[应用启动] NAS路径配置: {:?}", config.nas_paths);
    
    let db = Database::new(&config.db_path)
        .expect("Failed to initialize database");
    
    info!("[应用启动] 数据库初始化完成: {}", config.db_path);
    
    thumbnail::ensure_cache_dir(&config.cache_dir)
        .expect("Failed to create cache directory");
    
    info!("[应用启动] 缓存目录创建完成: {}/thumbnails", config.cache_dir);
    
    if !config.nas_paths.is_empty() {
        let _ = watcher::start_watcher(
            config.nas_paths.clone(),
            config.db_path.clone(),
            config.cache_dir.clone(),
        );
        info!("[应用启动] 文件监听器启动成功: {:?}", config.nas_paths);
    }
    
    let elapsed = start_time.elapsed();
    info!("[应用启动] 应用初始化完成，耗时: {}ms", elapsed.as_millis());
    
    tauri::Builder::default()
        .manage(AppState {
            db: Arc::new(Mutex::new(db)),
            config: Arc::new(Mutex::new(config)),
            scan_status: Arc::new(Mutex::new(ScanStatus {
                is_scanning: false,
                stage: models::ImportStage::Scanning,
                stage_message: String::new(),
                total_files: 0,
                scanned_files: 0,
                current_file: None,
            })),
            stop_scan_flag: Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            get_movies,
            get_movie_detail,
            search_movies,
            start_initial_scan,
            get_scan_status,
            play_movie,
            update_play_progress,
            get_stats,
            get_config,
            update_config,
            generate_thumbnail,
            regenerate_all_thumbnails,
            clear_cache,
            update_thumbnail_path,
            set_movie_rating,
            show_in_file_manager,
            delete_invalid_records,
            get_movies_filtered,
            get_unique_genres,
            get_unique_actors,
            reset_database,
            stop_scan,
            get_and_update_video_info,
            set_watched_status,
            get_video_groups,
            get_video_group_detail,
            create_video_group,
            add_video_part,
            delete_video_group,
            auto_detect_video_groups,
            frontend_log,
            check_file_exists,
            get_actors_with_counts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
