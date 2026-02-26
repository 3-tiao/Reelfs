use std::sync::{Arc, Mutex};
use tauri::Window;
use log::{info, debug, warn, error};
use crate::database::Database;
use crate::models::{AppConfig, ScanStatus, ImportStage};
use crate::indexer;
use crate::thumbnail;

pub struct ImportManager {
    db: Arc<Mutex<Database>>,
    config: AppConfig,
    scan_status: Arc<Mutex<ScanStatus>>,
    window: Window,
    scan_mode: String,
    delete_invalid: bool,
}

impl ImportManager {
    pub fn new(
        db: Arc<Mutex<Database>>,
        config: AppConfig,
        scan_status: Arc<Mutex<ScanStatus>>,
        window: Window,
        scan_mode: String,
        delete_invalid: bool,
    ) -> Self {
        Self {
            db,
            config,
            scan_status,
            window,
            scan_mode,
            delete_invalid,
        }
    }

    pub fn start_import(&self) -> Result<(), String> {
        if self.config.nas_paths.is_empty() {
            error!("[导入管理器] 导入失败: 未配置NAS路径");
            return Err("No NAS paths configured".to_string());
        }

        let is_scanning = self.scan_status.lock().unwrap().is_scanning;
        if is_scanning {
            warn!("[导入管理器] 导入已在进行中");
            return Err("Import already in progress".to_string());
        }

        info!("[导入管理器] 开始扫描: mode={}, delete_invalid={}", self.scan_mode, self.delete_invalid);
        
        self.set_stage(ImportStage::Scanning, "扫描目录中...");
        self.reset_progress();
        
        let db = Arc::clone(&self.db);
        let scan_status = Arc::clone(&self.scan_status);
        let config = self.config.clone();
        let window = self.window.clone();
        let cache_dir = config.cache_dir.clone();
        let scan_mode = self.scan_mode.clone();
        let delete_invalid = self.delete_invalid;
        
        let _ = window.emit("scan-progress", scan_status.lock().unwrap().clone());
        
        std::thread::spawn(move || {
            let manager = ImportManager::new(db, config, scan_status, window, scan_mode, delete_invalid);
            
            if let Err(e) = manager.run_import_process(&cache_dir) {
                error!("[导入管理器] 导入过程失败: {}", e);
                manager.set_error_state();
            }
        });

        Ok(())
    }

    fn run_import_process(&self, cache_dir: &str) -> Result<(), String> {
        let scan_start_time = std::time::Instant::now();
        let total_paths = self.config.nas_paths.len();
        info!("[导入管理器] 准备导入 {} 个路径", total_paths);

        let new_file_ids = self.scan_directories()?;

        if self.delete_invalid {
            self.delete_invalid_records()?;
        }

        if !new_file_ids.is_empty() {
            self.set_stage(ImportStage::Importing, "导入文件信息中...");
            self.import_files()?;

            self.set_stage(ImportStage::GeneratingThumbnails, "生成缩略图中...");
            self.generate_thumbnails(cache_dir, &new_file_ids)?;
        } else {
            info!("[导入管理器] 没有新文件需要导入");
            if self.scan_mode == "incremental" {
                self.set_stage(ImportStage::Importing, "没有新文件需要导入");
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }

        self.set_complete_state();

        let elapsed = scan_start_time.elapsed();
        info!("[导入管理器] 导入完成: {} 个文件，耗时: {}ms", new_file_ids.len(), elapsed.as_millis());

        Ok(())
    }

    fn scan_directories(&self) -> Result<Vec<i64>, String> {
        let mut new_file_ids = Vec::new();
        let total_paths = self.config.nas_paths.len();
        let is_incremental = self.scan_mode == "incremental";

        for (path_index, nas_path) in self.config.nas_paths.iter().enumerate() {
            info!("[导入管理器] 扫描路径 ({}/{}): {}", path_index + 1, total_paths, nas_path);

            let results = indexer::scan_directory(nas_path);

            {
                let mut status = self.scan_status.lock().unwrap();
                status.total_files += results.len();
                let _ = self.window.emit("scan-progress", status.clone());
            }

            let mut batch = Vec::new();

            for (i, (video_path, metadata)) in results.iter().enumerate() {
                let file_path_str = video_path.to_string_lossy().to_string();
                
                if is_incremental {
                    let db = self.db.lock().unwrap();
                    if let Ok(Some(_)) = db.get_movie_by_path(&file_path_str) {
                        debug!("[导入管理器] 跳过已存在文件: {}", file_path_str);
                        continue;
                    }
                }

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
                let file_size = indexer::get_file_size(video_path);
                let (duration_seconds, width, height) = indexer::get_video_info(video_path)
                    .map(|(d, w, h)| (Some(d), Some(w), Some(h)))
                    .unwrap_or((None, None, None));

                batch.push((
                    file_path_str.clone(),
                    title,
                    year,
                    plot,
                    rating,
                    genres,
                    director,
                    actors,
                    file_size,
                    duration_seconds,
                    width,
                    height,
                ));

                if batch.len() >= 100 || i == results.len() - 1 {
                    let db = self.db.lock().unwrap();
                    if let Err(e) = db.batch_insert_movies(&batch) {
                        error!("[导入管理器] 批量插入失败: {}", e);
                    } else {
                        debug!("[导入管理器] 批量插入成功: {} 条记录", batch.len());
                        
                        for (file_path, _, _, _, _, _, _, _, _, _, _, _) in &batch {
                            if let Ok(Some(movie)) = db.get_movie_by_path(file_path) {
                                new_file_ids.push(movie.id);
                            }
                        }
                    }
                    batch.clear();
                }

                {
                    let mut status = self.scan_status.lock().unwrap();
                    status.scanned_files += 1;
                    status.current_file = Some(file_path_str);
                }

                let _ = self.window.emit("scan-progress", self.scan_status.lock().unwrap().clone());
            }
        }

        Ok(new_file_ids)
    }

    fn import_files(&self) -> Result<(), String> {
        info!("[导入管理器] 导入文件信息");
        Ok(())
    }

    fn delete_invalid_records(&self) -> Result<usize, String> {
        info!("[导入管理器] 开始删除失效记录");
        
        let db = self.db.lock().unwrap();
        db.delete_invalid_records().map_err(|e| format!("删除失效记录失败: {}", e))
    }

    fn generate_thumbnails(&self, cache_dir: &str, new_file_ids: &[i64]) -> Result<(), String> {
        info!("[导入管理器] 开始生成缩略图");
        let thumbnail_start_time = std::time::Instant::now();

        let movies_without_thumbnails: Vec<(i64, String, String)> = {
            let db = self.db.lock().unwrap();
            
            if self.scan_mode == "incremental" && !new_file_ids.is_empty() {
                info!("[导入管理器] 增量扫描模式，只为新文件生成缩略图");
                new_file_ids.iter()
                    .filter_map(|&id| {
                        if let Ok(movie) = db.get_movie_by_id(id) {
                            if movie.thumbnail_path.is_none() {
                                Some((movie.id, movie.title, movie.file_path))
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    })
                    .collect()
            } else if self.scan_mode == "full" {
                info!("[导入管理器] 完全重新校验模式，为所有文件生成缩略图");
                let all_movies = db.get_movies(0, 1000);
                drop(db);

                all_movies.unwrap_or_default()
                    .into_iter()
                    .filter(|m| m.thumbnail_path.is_none())
                    .map(|m| (m.id, m.title, m.file_path))
                    .collect()
            } else {
                info!("[导入管理器] 增量扫描模式，没有新文件需要生成缩略图");
                Vec::new()
            }
        };

        let total_thumbnails = movies_without_thumbnails.len();
        let mut thumbnail_count = 0;

        for (movie_id, title, file_path) in &movies_without_thumbnails {
            let video_path = std::path::Path::new(file_path);
            let poster = crate::indexer::get_poster_path(video_path);
            
            if let Some(poster) = poster {
                let thumbnail_path = thumbnail::get_thumbnail_path(cache_dir, *movie_id);

                debug!("[导入管理器] 处理缩略图: id={}, title={}", movie_id, title);

                match thumbnail::generate_thumbnail(&poster, &thumbnail_path) {
                    Ok(_) => {
                        let db = self.db.lock().unwrap();
                        let _ = db.update_thumbnail_path(*movie_id, &thumbnail_path);
                        thumbnail_count += 1;
                        debug!("[导入管理器] 缩略图成功: id={}", movie_id);

                        {
                            let mut status = self.scan_status.lock().unwrap();
                            status.scanned_files = thumbnail_count;
                            status.current_file = Some(format!("生成缩略图: {}", title));
                        }

                        let _ = self.window.emit("scan-progress", self.scan_status.lock().unwrap().clone());
                    }
                    Err(e) => {
                        error!("[导入管理器] 缩略图失败: id={}, error={}", movie_id, e);
                    }
                }
            }
        }

        let thumbnail_elapsed = thumbnail_start_time.elapsed();
        info!("[导入管理器] 缩略图生成完成: {}/{} 个，耗时: {}ms",
               thumbnail_count, total_thumbnails, thumbnail_elapsed.as_millis());

        Ok(())
    }

    fn set_stage(&self, stage: ImportStage, message: &str) {
        let mut status = self.scan_status.lock().unwrap();
        status.stage = stage;
        status.stage_message = message.to_string();
        let _ = self.window.emit("scan-progress", status.clone());
    }

    fn reset_progress(&self) {
        let mut status = self.scan_status.lock().unwrap();
        status.is_scanning = true;
        status.total_files = 0;
        status.scanned_files = 0;
        status.current_file = None;
    }

    fn set_complete_state(&self) {
        let mut status = self.scan_status.lock().unwrap();
        status.is_scanning = false;
        status.current_file = None;
        let _ = self.window.emit("scan-complete", ());
    }

    fn set_error_state(&self) {
        let mut status = self.scan_status.lock().unwrap();
        status.is_scanning = false;
        status.current_file = None;
        let _ = self.window.emit("scan-complete", ());
    }
}
