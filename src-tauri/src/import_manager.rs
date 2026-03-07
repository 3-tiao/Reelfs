use std::sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}};
use tauri::Window;
use log::{info, debug, warn, error};
use rayon::prelude::*;
use crate::database::Database;
use crate::models::{AppConfig, ScanStatus, ImportStage, ScanResult};
use crate::indexer;
use crate::thumbnail;
use crate::video_group_detector::detect_video_groups;
use crate::video_group::VideoGroupManager;

pub struct ImportManager {
    db: Arc<Mutex<Database>>,
    config: AppConfig,
    scan_status: Arc<Mutex<ScanStatus>>,
    stop_scan_flag: Arc<Mutex<bool>>,
    window: Window,
    scan_mode: String,
    delete_invalid: bool,
}

impl ImportManager {
    pub fn new(
        db: Arc<Mutex<Database>>,
        config: AppConfig,
        scan_status: Arc<Mutex<ScanStatus>>,
        stop_scan_flag: Arc<Mutex<bool>>,
        window: Window,
        scan_mode: String,
        delete_invalid: bool,
    ) -> Self {
        Self {
            db,
            config,
            scan_status,
            stop_scan_flag,
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

        // 重置停止标志
        {
            let mut flag = self.stop_scan_flag.lock().unwrap();
            *flag = false;
        }

        info!("[导入管理器] 开始扫描: mode={}, delete_invalid={}", self.scan_mode, self.delete_invalid);
        
        self.set_stage(ImportStage::Scanning, "扫描目录中...");
        self.reset_progress();
        
        let db = Arc::clone(&self.db);
        let scan_status = Arc::clone(&self.scan_status);
        let stop_scan_flag = Arc::clone(&self.stop_scan_flag);
        let config = self.config.clone();
        let window = self.window.clone();
        let cache_dir = config.cache_dir.clone();
        let scan_mode = self.scan_mode.clone();
        let delete_invalid = self.delete_invalid;
        
        let _ = window.emit("scan-progress", scan_status.lock().unwrap().clone());
        
        std::thread::spawn(move || {
            let manager = ImportManager::new(db, config, scan_status, stop_scan_flag, window, scan_mode, delete_invalid);
            
            if let Err(e) = manager.run_import_process(&cache_dir) {
                error!("[导入管理器] 导入过程失败: {}", e);
                manager.set_error_state();
            }
        });

        Ok(())
    }

    fn run_import_process(&self, cache_dir: &str) -> Result<ScanResult, String> {
        let scan_start_time = std::time::Instant::now();
        let total_paths = self.config.nas_paths.len();
        info!("[导入管理器] 准备导入 {} 个路径", total_paths);

        // 如果是完全重新校验模式，先清空数据库
        let deleted_count = if self.scan_mode == "full" {
            info!("[导入管理器] 完全重新校验模式，清空数据库");
            let db = self.db.lock().unwrap();
            let count = db.get_total_count().unwrap_or(0);
            db.clear_all_movies().map_err(|e| format!("清空数据库失败: {}", e))?;
            info!("[导入管理器] 已删除 {} 条旧记录", count);
            count as usize
        } else if self.delete_invalid {
            self.delete_invalid_records()?
        } else {
            0
        };

        let new_file_ids = self.scan_directories()?;

        if !new_file_ids.is_empty() {
            self.set_stage(ImportStage::Importing, "导入文件信息中...");
            self.import_files()?;

            let db = Arc::clone(&self.db);
            let scan_status = Arc::clone(&self.scan_status);
            let window = self.window.clone();
            let cache_dir = cache_dir.to_string();
            let scan_mode = self.scan_mode.clone();
            let new_file_ids_clone = new_file_ids.clone();
            
            std::thread::spawn(move || {
                info!("[后台任务] 开始生成缩略图");
                
                let movies_without_thumbnails: Vec<(i64, String, String)> = {
                    let db = db.lock().unwrap();
                    
                    if scan_mode == "incremental" && !new_file_ids_clone.is_empty() {
                        info!("[后台任务] 增量扫描模式，只为新文件生成缩略图");
                        new_file_ids_clone.iter()
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
                    } else if scan_mode == "full" {
                        info!("[后台任务] 完全重新校验模式，为所有文件生成缩略图");
                        let all_movies = db.get_movies(0, 1000);
                        drop(db);

                        all_movies.unwrap_or_default()
                            .into_iter()
                            .filter(|m| m.thumbnail_path.is_none())
                            .map(|m| (m.id, m.title, m.file_path))
                            .collect()
                    } else {
                        info!("[后台任务] 增量扫描模式，没有新文件需要生成缩略图");
                        Vec::new()
                    }
                };

                let total_thumbnails = movies_without_thumbnails.len();
                let mut thumbnail_count = 0;

                for (movie_id, title, file_path) in &movies_without_thumbnails {
                    let video_path = std::path::Path::new(file_path);
                    let poster = crate::indexer::get_poster_path(video_path);
                    
                    if let Some(poster) = poster {
                        let thumbnail_path = thumbnail::get_thumbnail_path(&cache_dir, *movie_id);

                        debug!("[后台任务] 处理缩略图: id={}, title={}", movie_id, title);

                        match thumbnail::generate_thumbnail(&poster, &thumbnail_path) {
                            Ok(_) => {
                                let db = db.lock().unwrap();
                                let _ = db.update_thumbnail_path(*movie_id, &thumbnail_path);
                                thumbnail_count += 1;
                                debug!("[后台任务] 缩略图成功: id={}", movie_id);

                                {
                                    let mut status = scan_status.lock().unwrap();
                                    status.stage = ImportStage::GeneratingThumbnails;
                                    status.stage_message = format!("生成缩略图中... ({}/{})", thumbnail_count, total_thumbnails);
                                    status.current_file = Some(format!("生成缩略图: {}", title));
                                }

                                let _ = window.emit("scan-progress", scan_status.lock().unwrap().clone());
                            }
                            Err(e) => {
                                error!("[后台任务] 缩略图失败: id={}, error={}", movie_id, e);
                            }
                        }
                    }
                }

                info!("[后台任务] 缩略图生成完成: {}/{} 个", thumbnail_count, total_thumbnails);
            });
        } else {
            info!("[导入管理器] 没有新文件需要导入");
            if self.scan_mode == "incremental" {
                self.set_stage(ImportStage::Importing, "没有新文件需要导入");
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }

        let total_movies = {
            let db = self.db.lock().unwrap();
            db.get_total_count().unwrap_or(0)
        };

        info!("[导入管理器] 开始自动检测视频组");
        self.auto_detect_and_create_video_groups()?;

        let result = ScanResult {
            new_movies: new_file_ids.len() as i64,
            deleted_movies: deleted_count as i64,
            total_movies,
        };

        self.set_complete_state(&result);

        let elapsed = scan_start_time.elapsed();
        info!("[导入管理器] 导入完成: {} 个文件，耗时: {}ms", new_file_ids.len(), elapsed.as_millis());

        Ok(result)
    }

    fn scan_directories(&self) -> Result<Vec<i64>, String> {
        let mut new_file_ids = Vec::new();
        let _total_paths = self.config.nas_paths.len();
        let is_incremental = self.scan_mode == "incremental";

        // 收集所有文件路径，同时更新进度
        let mut all_video_paths = Vec::new();
        for (path_index, nas_path) in self.config.nas_paths.iter().enumerate() {
            info!("[导入管理器] 扫描路径 ({}/{}): {}", path_index + 1, self.config.nas_paths.len(), nas_path);
            
            // 更新阶段信息
            {
                let mut status = self.scan_status.lock().unwrap();
                status.stage_message = format!("扫描目录中 ({}/{})...", path_index + 1, self.config.nas_paths.len());
                let _ = self.window.emit("scan-progress", status.clone());
            }
            
            // 创建进度回调
            let scan_status = Arc::clone(&self.scan_status);
            let window = self.window.clone();
            let progress_callback = Arc::new(move |count: usize| {
                let mut status = scan_status.lock().unwrap();
                status.scanned_files = count;
                status.stage_message = format!("扫描目录中... 已发现 {} 个文件", count);
                let _ = window.emit("scan-progress", status.clone());
            });
            
            let video_paths = indexer::scan_directory_with_stop_flag(
                nas_path, 
                Some(Arc::clone(&self.stop_scan_flag)),
                Some(progress_callback),
            );
            
            // 检查是否已停止
            {
                let flag = self.stop_scan_flag.lock().unwrap();
                if *flag {
                    info!("[导入管理器] 扫描已停止");
                    let result = ScanResult {
                        new_movies: new_file_ids.len() as i64,
                        deleted_movies: 0,
                        total_movies: 0,
                    };
                    self.set_complete_state(&result);
                    return Ok(new_file_ids);
                }
            }
            
            all_video_paths.extend(video_paths);
        }
        
        let total_files = all_video_paths.len();
        
        // 更新总文件数，重置已扫描文件数
        {
            let mut status = self.scan_status.lock().unwrap();
            status.total_files = total_files;
            status.scanned_files = 0;
            status.stage_message = format!("处理 {} 个文件中...", total_files);
            let _ = self.window.emit("scan-progress", status.clone());
        }

        // 使用 rayon 并行处理文件
        let processed_counter = Arc::new(AtomicUsize::new(0));
        let scan_status = Arc::clone(&self.scan_status);
        let window = self.window.clone();
        
        let processed_files: Vec<_> = all_video_paths
            .par_iter()
            .enumerate()
            .filter_map(|(i, video_path)| {
                // 检查是否需要停止
                {
                    let flag = self.stop_scan_flag.lock().unwrap();
                    if *flag {
                        return None;
                    }
                }
                
                let file_path_str = video_path.to_string_lossy().to_string();
                    
                if is_incremental {
                    let db = self.db.lock().unwrap();
                    if let Ok(Some(_)) = db.get_movie_by_path(&file_path_str) {
                        debug!("[导入管理器] 跳过已存在文件: {}", file_path_str);
                        return None;
                    }
                }

                // 在处理阶段解析 NFO 文件
                let metadata = indexer::find_nfo_for_video(video_path)
                    .and_then(|nfo_path| {
                        debug!("[导入管理器] 找到NFO文件: {:?}", nfo_path);
                        indexer::parse_nfo_file(&nfo_path)
                    });

                let title = if let Some(ref meta) = metadata {
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
                // 视频信息延迟到详情页获取
                let duration_seconds = None;
                let width = None;
                let height = None;

                // 更新进度
                let count = processed_counter.fetch_add(1, Ordering::SeqCst) + 1;
                if count % 10 == 0 || count == total_files {
                    let mut status = scan_status.lock().unwrap();
                    status.scanned_files = count;
                    status.stage_message = "处理文件中...".to_string();
                    let _ = window.emit("scan-progress", status.clone());
                }

                Some((i, file_path_str, title, year, plot, rating, genres, director, actors, file_size, duration_seconds, width, height))
            })
            .collect();

        // 检查是否已停止
        {
            let flag = self.stop_scan_flag.lock().unwrap();
            if *flag {
                info!("[导入管理器] 扫描已停止");
                let result = ScanResult {
                    new_movies: new_file_ids.len() as i64,
                    deleted_movies: 0,
                    total_movies: 0,
                };
                self.set_complete_state(&result);
                return Ok(new_file_ids);
            }
        }

        // 串行插入数据库和更新进度
        let mut batch = Vec::new();
        for (i, file_path_str, title, year, plot, rating, genres, director, actors, file_size, duration_seconds, width, height) in processed_files {
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

            if batch.len() >= 100 || i == all_video_paths.len() - 1 {
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

    fn set_stage(&self, stage: ImportStage, message: &str) {
        let mut status = self.scan_status.lock().unwrap();
        status.stage = stage;
        status.stage_message = message.to_string();
        let _ = self.window.emit("scan-progress", status.clone());
    }

    fn auto_detect_and_create_video_groups(&self) -> Result<(), String> {
        info!("[视频组检测] 开始自动检测");
        
        let movies = {
            let db = self.db.lock().unwrap();
            db.get_movies(0, 10000).map_err(|e| format!("获取电影列表失败: {}", e))?
        };
        
        info!("[视频组检测] 共 {} 个电影需要检测", movies.len());
        
        let candidates = detect_video_groups(&movies);
        
        info!("[视频组检测] 检测到 {} 个候选视频组", candidates.len());
        
        if candidates.is_empty() {
            return Ok(());
        }
        
        let db = self.db.lock().unwrap();
        let conn = db.get_connection();
        let group_manager = VideoGroupManager::new(conn);
        
        info!("[视频组检测] 开始执行批量检测插入");
        match group_manager.create_video_groups_batch(&candidates) {
            Ok(count) => {
                info!("[视频组检测] 批量创建视频组成功: {}/{}", count, candidates.len());
            }
            Err(e) => {
                error!("[视频组检测] 批量创建视频组失败: {}", e);
            }
        }
        
        Ok(())
    }

    fn reset_progress(&self) {
        let mut status = self.scan_status.lock().unwrap();
        status.is_scanning = true;
        status.total_files = 0;
        status.scanned_files = 0;
        status.current_file = None;
    }

    fn set_complete_state(&self, result: &ScanResult) {
        let mut status = self.scan_status.lock().unwrap();
        status.is_scanning = false;
        status.current_file = None;
        let _ = self.window.emit("scan-complete", result);
    }

    fn set_error_state(&self) {
        let mut status = self.scan_status.lock().unwrap();
        status.is_scanning = false;
        status.current_file = None;
        let _ = self.window.emit("scan-complete", ());
    }
}
