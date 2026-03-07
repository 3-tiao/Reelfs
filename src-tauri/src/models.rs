use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Movie {
    pub id: i64,
    pub file_path: String,
    pub title: String,
    pub year: Option<i32>,
    pub plot: Option<String>,
    pub rating: Option<f64>,
    pub genres: Option<String>,
    pub director: Option<String>,
    pub actors: Option<String>,
    pub thumbnail_path: Option<String>,
    pub file_size: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub added_at: String,
    pub updated_at: String,
    pub last_accessed: Option<String>,
    pub last_checked_at: Option<String>,
    pub scan_state: Option<String>,
    pub is_watched: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovieMetadata {
    pub title: String,
    pub year: Option<i32>,
    pub plot: Option<String>,
    pub rating: Option<f64>,
    pub genres: Option<String>,
    pub director: Option<String>,
    pub actors: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayHistory {
    pub id: i64,
    pub movie_id: i64,
    pub last_position: f64,
    pub last_played: String,
    pub play_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ImportStage {
    Scanning,
    Importing,
    GeneratingThumbnails,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanStatus {
    pub is_scanning: bool,
    pub stage: ImportStage,
    pub stage_message: String,
    pub total_files: usize,
    pub scanned_files: usize,
    pub current_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub new_movies: i64,
    pub deleted_movies: i64,
    pub total_movies: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stats {
    pub total_movies: i64,
    pub total_size: i64,
    pub db_size: i64,
    pub cache_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub nas_paths: Vec<String>,
    pub cache_dir: String,
    pub db_path: String,
    pub scan_on_startup: bool,
    pub auto_generate_thumbnails: bool,
    pub theme: String,
    pub default_player: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| String::from("."));
        
        Self {
            nas_paths: vec![],
            cache_dir: format!("{}/.reelfs/cache", home),
            db_path: format!("{}/.reelfs/movies.db", home),
            scan_on_startup: false,
            auto_generate_thumbnails: true,
            theme: "dark".to_string(),
            default_player: "system".to_string(),
        }
    }
}
