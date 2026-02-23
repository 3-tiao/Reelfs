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
    let db = state.db.lock().unwrap();
    db.get_movies(offset, limit)
        .map_err(|e| format!("Database error: {}", e))
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
    let config = state.config.lock().unwrap().clone();
    let db = Arc::clone(&state.db);
    let scan_status = Arc::clone(&state.scan_status);
    
    if config.nas_paths.is_empty() {
        return Err("No NAS paths configured".to_string());
    }
    
    let is_scanning = scan_status.lock().unwrap().is_scanning;
    if is_scanning {
        return Err("Scan already in progress".to_string());
    }
    
    std::thread::spawn(move || {
        {
            let mut status = scan_status.lock().unwrap();
            status.is_scanning = true;
            status.total_files = 0;
            status.scanned_files = 0;
        }
        
        for nas_path in &config.nas_paths {
            println!("Scanning: {}", nas_path);
            let results = indexer::scan_directory(nas_path);
            
            {
                let mut status = scan_status.lock().unwrap();
                status.total_files += results.len();
            }
            
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
                ));
                
                if batch.len() >= 100 || i == results.len() - 1 {
                    let db = db.lock().unwrap();
                    if let Err(e) = db.batch_insert_movies(&batch) {
                        eprintln!("Failed to insert batch: {}", e);
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
        
        let _ = window.emit("scan-complete", ());
        println!("Scan complete!");
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
    let db = state.db.lock().unwrap();
    let movie = db.get_movie_by_id(id)
        .map_err(|e| format!("Movie not found: {}", e))?;
    
    let history = db.get_play_history(id)
        .map_err(|e| format!("Database error: {}", e))?;
    
    let start_position = history.map(|h| h.last_position);
    
    player::play_movie(&movie.file_path, start_position)?;
    
    Ok(())
}

#[tauri::command]
async fn update_play_progress(
    state: tauri::State<'_, AppState>,
    id: i64,
    position: f64,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.update_play_history(id, position)
        .map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
async fn get_stats(state: tauri::State<'_, AppState>) -> Result<Stats, String> {
    let db = state.db.lock().unwrap();
    let config = state.config.lock().unwrap();
    
    let total_movies = db.get_total_count()
        .map_err(|e| format!("Database error: {}", e))?;
    
    let db_path = &config.db_path;
    let db_size = fs::metadata(db_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);
    
    let cache_size = thumbnail::get_cache_size(&config.cache_dir)
        .map(|s| s as i64)
        .unwrap_or(0);
    
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
    let config_path = get_config_path();
    if let Some(parent) = Path::new(&config_path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    
    fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    
    *state.config.lock().unwrap() = config;
    
    Ok(())
}

#[tauri::command]
async fn generate_thumbnail(
    state: tauri::State<'_, AppState>,
    movie_id: i64,
) -> Result<String, String> {
    let db = state.db.lock().unwrap();
    let config = state.config.lock().unwrap();
    
    let movie = db.get_movie_by_id(movie_id)
        .map_err(|e| format!("Movie not found: {}", e))?;
    
    if let Some(thumbnail) = &movie.thumbnail_path {
        if Path::new(thumbnail).exists() {
            return Ok(thumbnail.clone());
        }
    }
    
    if let Some(poster) = &movie.poster_path {
        let thumbnail_path = thumbnail::get_thumbnail_path(&config.cache_dir, movie_id);
        
        thumbnail::generate_thumbnail(poster, &thumbnail_path)
            .map_err(|e| format!("Failed to generate thumbnail: {}", e))?;
        
        db.update_thumbnail_path(movie_id, &thumbnail_path)
            .map_err(|e| format!("Failed to update thumbnail path: {}", e))?;
        
        return Ok(thumbnail_path);
    }
    
    Err("No poster available for thumbnail generation".to_string())
}

#[tauri::command]
async fn clear_cache(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let config = state.config.lock().unwrap();
    thumbnail::clear_cache(&config.cache_dir)
        .map_err(|e| format!("Failed to clear cache: {}", e))
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
    let config = load_config();
    
    let db = Database::new(&config.db_path)
        .expect("Failed to initialize database");
    
    thumbnail::ensure_cache_dir(&config.cache_dir)
        .expect("Failed to create cache directory");
    
    if !config.nas_paths.is_empty() {
        let _ = watcher::start_watcher(config.nas_paths.clone(), config.db_path.clone());
    }
    
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
