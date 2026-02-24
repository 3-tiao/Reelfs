// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod database;
mod indexer;
mod models;
mod player;
mod thumbnail;
mod watcher;

use database::Database;
use models::{AppConfig, Movie, PlayHistory, ScanStatus, Stats};
use std::sync::{Arc, Mutex};
use std::fs;
use std::path::Path;
use log::{info, debug, warn, error};

struct AppState {
    db: Arc<Mutex<Database>>,
    config: Arc<Mutex<AppConfig>>,
    scan_status: Arc<Mutex<ScanStatus>>,
}

#[tauri::command]
async fn get_movies(
    state: tauri::State<'_, AppState>,
    offset: i32,
    limit: i32,
) -> Result<Vec<Movie>, String> {
    info!("[API] get_movies 调用: offset={}, limit={}", offset, limit);
    
    let db = state.db.lock().unwrap();
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
    let db = state.db.lock().unwrap();
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
) -> Result<Vec<Movie>, String> {
    let db = state.db.lock().unwrap();
    db.search_movies(&query)
        .map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
async fn start_initial_scan(
    state: tauri::State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    info!("[目录扫描] 开始全量扫描");
    
    let config = state.config.lock().unwrap().clone();
    let db = Arc::clone(&state.db);
    let scan_status = Arc::clone(&state.scan_status);
    let cache_dir = config.cache_dir.clone();
    
    if config.nas_paths.is_empty() {
        error!("[目录扫描] 扫描失败: 未配置NAS路径");
        return Err("No NAS paths configured".to_string());
    }
    
    let is_scanning = scan_status.lock().unwrap().is_scanning;
    if is_scanning {
        warn!("[目录扫描] 扫描已在进行中");
        return Err("Scan already in progress".to_string());
    }
    
    let scan_start_time = std::time::Instant::now();
    let total_paths = config.nas_paths.len();
    info!("[目录扫描] 准备扫描 {} 个路径", total_paths);
    
    std::thread::spawn(move || {
        {
            let mut status = scan_status.lock().unwrap();
            status.is_scanning = true;
            status.total_files = 0;
            status.scanned_files = 0;
        }
        
        let mut total_files = 0;
        
        for (path_index, nas_path) in config.nas_paths.iter().enumerate() {
            info!("[目录扫描] 扫描路径 ({}/{}): {}", path_index + 1, total_paths, nas_path);
            
            let results = indexer::scan_directory(nas_path);
            
            {
                let mut status = scan_status.lock().unwrap();
                status.total_files += results.len();
            }
            
            total_files += results.len();
            
            let mut batch = Vec::new();
            
            for (i, (video_path, metadata)) in results.iter().enumerate() {
                let title = if let Some(meta) = metadata {
                    meta.title.clone()
                } else {
                    indexer::extract_title_from_filename(video_path)
                };
                
                let year = metadata.as_ref().and_then(|m| m.year);
                let plot = metadata.as_ref().and_then(|m| m.plot.clone());
                let rating = metadata.as_ref().and_then(|m| m.rating);
                let genres = metadata.as_ref().and_then(|m| m.genres.clone());
                let director = metadata.as_ref().and_then(|m| m.director.clone());
                let actors = metadata.as_ref().and_then(|m| m.actors.clone());
                let poster = metadata.as_ref().and_then(|m| m.poster.clone());
                let fanart = metadata.as_ref().and_then(|m| m.fanart.clone());
                let file_size = indexer::get_file_size(video_path);
                let duration_seconds = None;
                
                batch.push((
                    video_path.to_string_lossy().to_string(),
                    title,
                    year,
                    plot,
                    rating,
                    genres,
                    director,
                    actors,
                    poster,
                    fanart,
                    file_size,
                    duration_seconds,
                ));
                
                if batch.len() >= 100 || i == results.len() - 1 {
                    let db = db.lock().unwrap();
                    if let Err(e) = db.batch_insert_movies(&batch) {
                        error!("[目录扫描] 批量插入失败: {}", e);
                    } else {
                        debug!("[目录扫描] 批量插入成功: {} 条记录", batch.len());
                    }
                    batch.clear();
                }
                
                {
                    let mut status = scan_status.lock().unwrap();
                    status.scanned_files += 1;
                    status.current_file = Some(video_path.to_string_lossy().to_string());
                }
                
                let _ = window.emit("scan-progress", scan_status.lock().unwrap().clone());
            }
        }
        
        {
            let mut status = scan_status.lock().unwrap();
            status.is_scanning = false;
            status.current_file = None;
        }
        
        let elapsed = scan_start_time.elapsed();
        info!("[目录扫描] 扫描完成: {} 个文件，耗时: {}ms", total_files, elapsed.as_millis());
        
        // 自动生成缩略图
        info!("[缩略图生成] 开始自动生成缩略图");
        let thumbnail_start_time = std::time::Instant::now();
        
        let movies_with_posters: Vec<(i64, String, String)> = {
            let db = db.lock().unwrap();
            let all_movies = db.get_movies(0, 1000);
            drop(db);
            
            all_movies.unwrap_or_default()
                .into_iter()
                .filter(|m| m.poster_path.is_some() && m.thumbnail_path.is_none())
                .map(|m| (m.id, m.title, m.poster_path.unwrap()))
                .collect()
        };
        
        let mut thumbnail_count = 0;
        
        for (movie_id, title, poster) in &movies_with_posters {
            let thumbnail_path = thumbnail::get_thumbnail_path(&cache_dir, *movie_id);
            
            debug!("[缩略图生成] 处理电影: id={}, title={}, poster={}", 
                   movie_id, title, poster);
            
            match thumbnail::generate_thumbnail(poster, &thumbnail_path) {
                Ok(_) => {
                    let db = db.lock().unwrap();
                    let _ = db.update_thumbnail_path(*movie_id, &thumbnail_path);
                    thumbnail_count += 1;
                    debug!("[缩略图生成] 成功: id={}", movie_id);
                }
                Err(e) => {
                    error!("[缩略图生成] 失败: id={}, error={}", movie_id, e);
                }
            }
        }
        
        let thumbnail_elapsed = thumbnail_start_time.elapsed();
        info!("[缩略图生成] 自动生成完成: {}/{} 个缩略图，耗时: {}ms", 
               thumbnail_count, movies_with_posters.len(), thumbnail_elapsed.as_millis());
        
        let _ = window.emit("scan-complete", ());
    });
    
    Ok("Scan started".to_string())
}

#[tauri::command]
async fn get_scan_status(state: tauri::State<'_, AppState>) -> Result<ScanStatus, String> {
    Ok(state.scan_status.lock().unwrap().clone())
}

#[tauri::command]
async fn play_movie(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    info!("[播放器] 开始播放: movie_id={}", id);
    
    let db = state.db.lock().unwrap();
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
    
    let db = state.db.lock().unwrap();
    db.update_play_history(id, position)
        .map_err(|e| {
            error!("[播放器] 更新播放进度失败: {}", e);
            format!("Database error: {}", e)
        })
}

#[tauri::command]
async fn get_stats(state: tauri::State<'_, AppState>) -> Result<Stats, String> {
    debug!("[数据查询] 获取统计信息");
    
    let db = state.db.lock().unwrap();
    let config = state.config.lock().unwrap();
    
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
    Ok(state.config.lock().unwrap().clone())
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
    
    *state.config.lock().unwrap() = config;
    
    info!("[设置] 配置更新成功");
    
    Ok(())
}

#[tauri::command]
async fn generate_thumbnail(
    state: tauri::State<'_, AppState>,
    movie_id: i64,
) -> Result<String, String> {
    info!("[缩略图生成] 开始生成缩略图: movie_id={}", movie_id);
    
    let db = state.db.lock().unwrap();
    let config = state.config.lock().unwrap();
    
    let movie = db.get_movie_by_id(movie_id)
        .map_err(|e| {
            error!("[缩略图生成] 获取电影信息失败: {}", e);
            format!("Movie not found: {}", e)
        })?;
    
    if let Some(thumbnail) = &movie.thumbnail_path {
        if Path::new(thumbnail).exists() {
            debug!("[缩略图生成] 使用缓存: {}", thumbnail);
            return Ok(thumbnail.clone());
        }
    }
    
    if let Some(poster) = &movie.poster_path {
        let thumbnail_path = thumbnail::get_thumbnail_path(&config.cache_dir, movie_id);
        
        debug!("[缩略图生成] 源文件: {}", poster);
        debug!("[缩略图生成] 目标文件: {}", thumbnail_path);
        
        thumbnail::generate_thumbnail(poster, &thumbnail_path)
            .map_err(|e| {
                error!("[缩略图生成] 生成缩略图失败: {}", e);
                format!("Failed to generate thumbnail: {}", e)
            })?;
        
        db.update_thumbnail_path(movie_id, &thumbnail_path)
            .map_err(|e| {
                error!("[缩略图生成] 更新缩略图路径失败: {}", e);
                format!("Failed to update thumbnail path: {}", e)
            })?;
        
        info!("[缩略图生成] 缩略图生成成功: {}", thumbnail_path);
        
        return Ok(thumbnail_path);
    }
    
    warn!("[缩略图生成] 无海报可用，无法生成缩略图");
    
    Err("No poster available for thumbnail generation".to_string())
}

#[tauri::command]
async fn clear_cache(state: tauri::State<'_, AppState>) -> Result<(), String> {
    info!("[设置] 开始清理缓存");
    
    let config = state.config.lock().unwrap();
    thumbnail::clear_cache(&config.cache_dir)
        .map_err(|e| {
            error!("[设置] 清理缓存失败: {}", e);
            format!("Failed to clear cache: {}", e)
        })?;
    
    info!("[设置] 缓存清理完成");
    
    Ok(())
}

#[tauri::command]
async fn update_thumbnail_path(
    state: tauri::State<'_, AppState>,
    movie_id: i64,
    thumbnail_path: String,
) -> Result<(), String> {
    info!("[缩略图生成] 更新缩略图路径: movie_id={}, path={}", movie_id, thumbnail_path);
    
    let db = state.db.lock().unwrap();
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
    
    let db = state.db.lock().unwrap();
    db.set_movie_rating(movie_id, rating)
        .map_err(|e| {
            error!("[API] 设置电影评级失败: {}", e);
            format!("Failed to set movie rating: {}", e)
        })?;
    
    info!("[API] 电影评级设置成功: movie_id={}, rating={:?}", movie_id, rating);
    
    Ok(())
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

fn main() {
    let start_time = std::time::Instant::now();
    
    // 初始化日志系统
    env_logger::Builder::from_default_env()
        .format_timestamp_secs()
        .filter_level(log::LevelFilter::Info)
        .init();
    
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
        let _ = watcher::start_watcher(config.nas_paths.clone(), config.db_path.clone());
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
                total_files: 0,
                scanned_files: 0,
                current_file: None,
            })),
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
            clear_cache,
            update_thumbnail_path,
            set_movie_rating,
            show_in_file_manager,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
