use crate::database::{Database, MovieBatchRow};
use crate::indexer;
use crate::models::{AppConfig, ImportStage, ScanCompletion, ScanResult, ScanStatus};
use crate::path_utils::normalize_path;
use crate::thumbnail;
use crate::video_group::VideoGroupManager;
use crate::video_group_detector::detect_video_groups;
use log::{debug, error, info, warn};
use rayon::prelude::*;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex, MutexGuard,
};
use std::time::{Duration, Instant};
use tauri::Window;

trait LockExt<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> LockExt<T> for Mutex<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| {
            warn!("[导入管理器] 互斥锁被污染，恢复内部数据继续运行");
            poisoned.into_inner()
        })
    }
}

const PROGRESS_EMIT_INTERVAL_MS: u64 = 150;

type VideoProbe = (i64, Option<i64>, Option<i32>, Option<i32>);

pub struct ImportManager {
    db: Arc<Mutex<Database>>,
    config: AppConfig,
    scan_status: Arc<Mutex<ScanStatus>>,
    stop_scan_flag: Arc<AtomicBool>,
    window: Window,
    scan_mode: String,
    delete_invalid: bool,
    last_emit_at: Arc<Mutex<Instant>>,
}

impl ImportManager {
    pub fn new(
        db: Arc<Mutex<Database>>,
        config: AppConfig,
        scan_status: Arc<Mutex<ScanStatus>>,
        stop_scan_flag: Arc<AtomicBool>,
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
            last_emit_at: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(1))),
        }
    }

    /// Emit immediately and reset the throttle clock. Use at stage boundaries.
    fn emit_progress_force(&self) {
        let snapshot = self.scan_status.lock_recover().clone();
        let _ = self.window.emit("scan-progress", snapshot);
        *self.last_emit_at.lock_recover() = Instant::now();
    }

    /// Emit only if PROGRESS_EMIT_INTERVAL_MS has passed since the last emit.
    fn emit_progress_throttled(&self) {
        let mut last = self.last_emit_at.lock_recover();
        if last.elapsed() < Duration::from_millis(PROGRESS_EMIT_INTERVAL_MS) {
            return;
        }
        *last = Instant::now();
        drop(last);
        let snapshot = self.scan_status.lock_recover().clone();
        let _ = self.window.emit("scan-progress", snapshot);
    }

    pub fn start_import(&self) -> Result<(), String> {
        if self.config.nas_paths.is_empty() {
            error!("[导入管理器] 导入失败: 未配置NAS路径");
            return Err("No NAS paths configured".to_string());
        }

        let is_scanning = self.scan_status.lock_recover().is_scanning;
        if is_scanning {
            warn!("[导入管理器] 导入已在进行中");
            return Err("Import already in progress".to_string());
        }

        self.stop_scan_flag.store(false, Ordering::SeqCst);

        info!(
            "[导入管理器] 开始扫描: mode={}, delete_invalid={}",
            self.scan_mode, self.delete_invalid
        );

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

        let _ = window.emit("scan-progress", scan_status.lock_recover().clone());

        std::thread::spawn(move || {
            let manager = ImportManager::new(
                db,
                config,
                scan_status,
                stop_scan_flag,
                window,
                scan_mode,
                delete_invalid,
            );

            if let Err(e) = manager.run_import_process(&cache_dir) {
                error!("[导入管理器] 导入过程失败: {}", e);
                manager.set_error_state(&e);
            }
        });

        Ok(())
    }

    fn run_import_process(&self, cache_dir: &str) -> Result<ScanResult, String> {
        let scan_start_time = std::time::Instant::now();
        let total_paths = self.config.nas_paths.len();
        info!("[导入管理器] 准备导入 {} 个路径", total_paths);

        let is_full = self.scan_mode == "full";

        // Phase 1: Delete invalid records (files no longer on disk)
        let deleted_count = if is_full || self.delete_invalid {
            self.delete_invalid_records()?
        } else {
            0
        };

        if self.stop_requested() {
            let result = ScanResult {
                new_movies: 0,
                updated_movies: 0,
                deleted_movies: deleted_count as i64,
                total_movies: 0,
            };
            self.set_cancelled_state(&result, "扫描已停止");
            return Ok(result);
        }

        // Phase 2: Scan directories and collect all video paths
        let all_video_paths = self.scan_directories_collect()?;

        if self.stop_requested() {
            let result = ScanResult {
                new_movies: 0,
                updated_movies: 0,
                deleted_movies: deleted_count as i64,
                total_movies: 0,
            };
            self.set_cancelled_state(&result, "扫描已停止");
            return Ok(result);
        }

        // Phase 3: Classify files into new / existing (for update check in full mode)
        let (new_ids, updated_count) = self.process_and_import_files(&all_video_paths, is_full)?;

        if self.stop_requested() {
            let result = ScanResult {
                new_movies: new_ids.len() as i64,
                updated_movies: updated_count,
                deleted_movies: deleted_count as i64,
                total_movies: 0,
            };
            self.set_cancelled_state(&result, "扫描已停止");
            return Ok(result);
        }

        if !new_ids.is_empty() || is_full {
            self.set_stage(ImportStage::Importing, "导入文件信息中...");

            // Probe duration/width/height for newly imported movies.
            // (Skip in full mode to avoid re-probing the whole library every time.)
            if !new_ids.is_empty() {
                self.probe_and_update_video_info(&new_ids)?;

                if self.stop_requested() {
                    let result = ScanResult {
                        new_movies: new_ids.len() as i64,
                        updated_movies: updated_count,
                        deleted_movies: deleted_count as i64,
                        total_movies: 0,
                    };
                    self.set_cancelled_state(&result, "扫描已停止");
                    return Ok(result);
                }
            }

            if is_full {
                // Full mode: generate thumbnails for ALL movies missing thumbnails
                self.generate_thumbnails_full(cache_dir)?;
            } else {
                // Incremental mode: only generate for newly imported movies
                self.generate_thumbnails(cache_dir, &new_ids)?;
            }
        } else {
            info!("[导入管理器] 没有新文件需要导入");
            if self.scan_mode == "incremental" {
                self.set_stage(ImportStage::Importing, "没有新文件需要导入");
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }

        if self.stop_requested() {
            let result = ScanResult {
                new_movies: new_ids.len() as i64,
                updated_movies: updated_count,
                deleted_movies: deleted_count as i64,
                total_movies: 0,
            };
            self.set_cancelled_state(&result, "扫描已停止");
            return Ok(result);
        }

        let had_changes = !new_ids.is_empty() || updated_count > 0 || deleted_count > 0;
        if had_changes {
            info!("[导入管理器] 开始自动检测视频组");
            self.auto_detect_and_create_video_groups()?;
        } else {
            debug!("[导入管理器] 无新增/更新/删除，跳过视频组检测");
        }

        let result = self.build_scan_result(new_ids.len(), updated_count, deleted_count);
        self.set_complete_state(&result);

        let elapsed = scan_start_time.elapsed();
        info!(
            "[导入管理器] 导入完成: {} 个新文件, {} 个更新, {} 个删除，耗时: {}ms",
            new_ids.len(),
            updated_count,
            deleted_count,
            elapsed.as_millis()
        );

        Ok(result)
    }

    /// Collect all video file paths from configured NAS paths
    fn scan_directories_collect(&self) -> Result<Vec<std::path::PathBuf>, String> {
        let mut all_video_paths = Vec::new();
        for (path_index, nas_path) in self.config.nas_paths.iter().enumerate() {
            info!(
                "[导入管理器] 扫描路径 ({}/{}): {}",
                path_index + 1,
                self.config.nas_paths.len(),
                nas_path
            );

            {
                let mut status = self.scan_status.lock_recover();
                status.stage_message = format!(
                    "扫描目录中 ({}/{})...",
                    path_index + 1,
                    self.config.nas_paths.len()
                );
            }
            self.emit_progress_force();

            let scan_status = Arc::clone(&self.scan_status);
            let last_emit_at = Arc::clone(&self.last_emit_at);
            let window = self.window.clone();
            let progress_callback = Arc::new(move |count: usize| {
                {
                    let mut status = scan_status.lock_recover();
                    status.scanned_files = count;
                    status.stage_message = format!("扫描目录中... 已发现 {} 个文件", count);
                }
                let mut last = last_emit_at.lock_recover();
                if last.elapsed() < Duration::from_millis(PROGRESS_EMIT_INTERVAL_MS) {
                    return;
                }
                *last = Instant::now();
                drop(last);
                let snapshot = scan_status.lock_recover().clone();
                let _ = window.emit("scan-progress", snapshot);
            });

            let video_paths = indexer::scan_directory_with_stop_flag(
                nas_path,
                Some(Arc::clone(&self.stop_scan_flag)),
                Some(progress_callback),
            );

            if self.stop_scan_flag.load(Ordering::Relaxed) {
                info!("[导入管理器] 扫描已停止");
                return Ok(all_video_paths);
            }

            all_video_paths.extend(video_paths);
        }

        {
            let mut status = self.scan_status.lock_recover();
            status.total_files = all_video_paths.len();
            status.scanned_files = 0;
            status.stage_message = format!("处理 {} 个文件中...", all_video_paths.len());
        }
        self.emit_progress_force();

        Ok(all_video_paths)
    }

    /// Process video files: insert new ones, and in full mode update existing ones with changed NFO
    fn process_and_import_files(
        &self,
        all_video_paths: &[std::path::PathBuf],
        is_full: bool,
    ) -> Result<(Vec<i64>, i64), String> {
        let is_incremental = !is_full;

        // Single DB scan reused for both "is this path known?" and "what's its id?"
        let path_to_id: std::collections::HashMap<String, i64> = {
            let db = self.db.lock_recover();
            let all_records = db
                .get_all_file_paths()
                .map_err(|e| format!("获取文件路径失败: {}", e))?;
            all_records
                .into_iter()
                .map(|(id, path)| (path, id))
                .collect()
        };

        let processed_counter = Arc::new(AtomicUsize::new(0));

        struct ProcessedFile {
            file_path_str: String,
            title: String,
            year: Option<i32>,
            plot: Option<String>,
            rating: Option<f64>,
            genres: Option<String>,
            director: Option<String>,
            actors: Option<String>,
            file_size: Option<i64>,
            duration_seconds: Option<i64>,
            width: Option<i32>,
            height: Option<i32>,
            is_existing: bool,
        }

        let processed_files: Vec<ProcessedFile> = all_video_paths
            .par_iter()
            .enumerate()
            .filter_map(|(_i, video_path)| {
                if self.stop_scan_flag.load(Ordering::Relaxed) {
                    return None;
                }

                let file_path_str = normalize_path(video_path);
                let is_existing = path_to_id.contains_key(&file_path_str);

                // In incremental mode, skip existing files entirely
                if is_incremental && is_existing {
                    debug!("[导入管理器] 跳过已存在文件: {}", file_path_str);
                    return None;
                }

                let metadata = indexer::find_nfo_for_video(video_path).and_then(|nfo_path| {
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
                let duration_seconds = None;
                let width = None;
                let height = None;

                let count = processed_counter.fetch_add(1, Ordering::Relaxed) + 1;
                {
                    let mut status = self.scan_status.lock_recover();
                    status.scanned_files = count;
                    status.stage_message = "处理文件中...".to_string();
                }
                self.emit_progress_throttled();

                Some(ProcessedFile {
                    file_path_str,
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
                    is_existing,
                })
            })
            .collect();

        if self.stop_scan_flag.load(Ordering::Relaxed) {
            info!("[导入管理器] 扫描已停止");
            return Ok((Vec::new(), 0));
        }

        // Separate into new files and existing files needing update
        type NewRow = MovieBatchRow;
        type UpdateRow = (
            i64,
            String,
            Option<i32>,
            Option<String>,
            Option<f64>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i64>,
        );
        let mut new_batch: Vec<NewRow> = Vec::new();
        let mut existing_updates: Vec<UpdateRow> = Vec::new();

        for file in &processed_files {
            if file.is_existing {
                // Full mode: re-parse NFO and update metadata
                if let Some(&movie_id) = path_to_id.get(&file.file_path_str) {
                    existing_updates.push((
                        movie_id,
                        file.title.clone(),
                        file.year,
                        file.plot.clone(),
                        file.rating,
                        file.genres.clone(),
                        file.director.clone(),
                        file.actors.clone(),
                        file.file_size,
                    ));
                }
            } else {
                new_batch.push((
                    file.file_path_str.clone(),
                    file.title.clone(),
                    file.year,
                    file.plot.clone(),
                    file.rating,
                    file.genres.clone(),
                    file.director.clone(),
                    file.actors.clone(),
                    file.file_size,
                    file.duration_seconds,
                    file.width,
                    file.height,
                ));
            }
        }

        // Insert new files in batches; flush + emit progress at each boundary.
        // Note: scanned_files now reflects "files imported" instead of incrementing per-iter
        // before the actual insert ran — this prevents misleading early progress.
        let mut new_file_ids = Vec::with_capacity(new_batch.len());
        let mut batch_buf: Vec<NewRow> = Vec::with_capacity(100);
        let mut imported_count: usize = 0;
        let total_to_insert = new_batch.len();

        for (i, item) in new_batch.iter().enumerate() {
            if self.stop_requested() {
                break;
            }
            batch_buf.push(item.clone());

            let is_last = i == total_to_insert - 1;
            if batch_buf.len() >= 100 || is_last {
                let batch_size = batch_buf.len();
                let last_path = batch_buf.last().map(|t| t.0.clone());

                {
                    let db = self.db.lock_recover();
                    match db.batch_insert_movies(&batch_buf) {
                        Ok(mut ids) => {
                            debug!(
                                "[导入管理器] 批量插入成功: {} 条记录, {} 个 ID",
                                batch_size,
                                ids.len()
                            );
                            new_file_ids.append(&mut ids);
                        }
                        Err(e) => error!("[导入管理器] 批量插入失败: {}", e),
                    }
                }

                batch_buf.clear();
                imported_count += batch_size;

                {
                    let mut status = self.scan_status.lock_recover();
                    status.scanned_files = imported_count;
                    status.current_file = last_path;
                }
                self.emit_progress_throttled();
            }
        }

        // Update existing files with re-parsed metadata (full mode only)
        let mut updated_count: i64 = 0;
        if !existing_updates.is_empty() {
            info!(
                "[导入管理器] 开始更新 {} 个已有文件的元数据",
                existing_updates.len()
            );
            let db = self.db.lock_recover();
            for (movie_id, title, year, plot, rating, genres, director, actors, file_size) in
                &existing_updates
            {
                match db.update_movie_metadata(
                    *movie_id,
                    title,
                    *year,
                    plot.as_deref(),
                    *rating,
                    genres.as_deref(),
                    director.as_deref(),
                    actors.as_deref(),
                    *file_size,
                ) {
                    Ok(true) => updated_count += 1,
                    Ok(false) => {}
                    Err(e) => error!(
                        "[导入管理器] 更新电影元数据失败: id={}, error={}",
                        movie_id, e
                    ),
                }
            }
            info!("[导入管理器] 元数据更新完成: {} 个文件", updated_count);
        }

        Ok((new_file_ids, updated_count))
    }

    /// Probe duration/width/height for newly imported movies and update the DB in batches.
    /// Runs ffprobe/mp4 in parallel via rayon, so this scales with CPU count.
    fn probe_and_update_video_info(&self, movie_ids: &[i64]) -> Result<(), String> {
        if movie_ids.is_empty() {
            return Ok(());
        }

        // Collect (id, file_path) pairs once under a brief DB lock.
        let targets: Vec<(i64, String)> = {
            let db = self.db.lock_recover();
            movie_ids
                .iter()
                .filter_map(|&id| db.get_movie_by_id(id).ok().map(|m| (m.id, m.file_path)))
                .collect()
        };

        let total = targets.len();
        {
            let mut status = self.scan_status.lock_recover();
            status.stage = ImportStage::ProbingVideo;
            status.stage_message = format!("检测视频信息中 (0/{})", total);
            status.total_files = total;
            status.scanned_files = 0;
            status.current_file = None;
        }
        self.emit_progress_force();

        let probed_counter = Arc::new(AtomicUsize::new(0));

        let probes: Vec<VideoProbe> = targets
            .par_iter()
            .filter_map(|(id, file_path)| {
                if self.stop_scan_flag.load(Ordering::Relaxed) {
                    return None;
                }
                let info = indexer::get_video_info(std::path::Path::new(file_path));

                let done = probed_counter.fetch_add(1, Ordering::Relaxed) + 1;
                {
                    let mut status = self.scan_status.lock_recover();
                    status.scanned_files = done;
                    status.stage_message = format!("检测视频信息中 ({}/{})", done, total);
                    status.current_file = Some(file_path.clone());
                }
                self.emit_progress_throttled();

                Some(match info {
                    Some((d, w, h)) => (*id, Some(d), Some(w), Some(h)),
                    None => (*id, None, None, None),
                })
            })
            .collect();

        // Persist in one batch — single lock acquisition, one transaction.
        let to_write: Vec<&VideoProbe> = probes
            .iter()
            .filter(|(_id, d, w, h)| d.is_some() || w.is_some() || h.is_some())
            .collect();

        if !to_write.is_empty() {
            let db = self.db.lock_recover();
            for (id, duration, width, height) in &to_write {
                if let Err(e) = db.update_video_info(*id, *duration, *width, *height) {
                    error!("[导入管理器] 更新视频信息失败: id={}, error={}", id, e);
                }
            }
        }

        info!(
            "[导入管理器] 视频信息探测完成: 写入 {} / 探测 {} / 计划 {}",
            to_write.len(),
            probes.len(),
            total
        );
        Ok(())
    }

    /// Generate thumbnails for newly imported movies only (incremental mode)
    fn generate_thumbnails(&self, cache_dir: &str, movie_ids: &[i64]) -> Result<(), String> {
        info!("[导入管理器] 开始生成缩略图（增量）");

        let movies_without_thumbnails: Vec<(i64, String, String)> = {
            let db = self.db.lock_recover();
            movie_ids
                .iter()
                .filter_map(|&id| db.get_movie_by_id(id).ok())
                .filter(|movie| movie.thumbnail_path.is_none())
                .map(|movie| (movie.id, movie.title, movie.file_path))
                .collect()
        };

        self.generate_thumbnails_for_movies(cache_dir, &movies_without_thumbnails)?;

        Ok(())
    }

    /// Generate thumbnails for ALL movies missing thumbnails (full mode)
    fn generate_thumbnails_full(&self, cache_dir: &str) -> Result<(), String> {
        info!("[导入管理器] 开始生成缩略图（全量校验）");

        let movies_without_thumbnails: Vec<(i64, String, String)> = {
            let db = self.db.lock_recover();
            let all_movies = db
                .get_all_movies()
                .map_err(|e| format!("获取电影列表失败: {}", e))?;
            all_movies
                .into_iter()
                .filter(|m| m.thumbnail_path.is_none())
                .map(|m| (m.id, m.title, m.file_path))
                .collect()
        };

        info!(
            "[导入管理器] 发现 {} 个电影缺少缩略图",
            movies_without_thumbnails.len()
        );
        self.generate_thumbnails_for_movies(cache_dir, &movies_without_thumbnails)?;

        Ok(())
    }

    /// Shared thumbnail generation logic
    fn generate_thumbnails_for_movies(
        &self,
        cache_dir: &str,
        movies: &[(i64, String, String)],
    ) -> Result<(), String> {
        let total_thumbnails = movies.len();
        let mut thumbnail_count = 0;

        {
            let mut status = self.scan_status.lock_recover();
            status.stage = ImportStage::GeneratingThumbnails;
            status.stage_message = if total_thumbnails == 0 {
                "无需生成缩略图".to_string()
            } else {
                format!("生成缩略图中... (0/{})", total_thumbnails)
            };
            status.total_files = total_thumbnails;
            status.scanned_files = 0;
            status.current_file = None;
        }
        self.emit_progress_force();

        for (movie_id, title, file_path) in movies {
            if self.stop_requested() {
                info!("[导入管理器] 缩略图生成已停止");
                break;
            }

            let video_path = std::path::Path::new(file_path);
            let poster = crate::indexer::get_poster_path(video_path);

            if let Some(poster) = poster {
                let thumbnail_path = thumbnail::get_thumbnail_path(cache_dir, *movie_id);
                debug!("[导入管理器] 处理缩略图: id={}, title={}", movie_id, title);

                match thumbnail::generate_thumbnail(&poster, &thumbnail_path) {
                    Ok(_) => {
                        {
                            let db = self.db.lock_recover();
                            let _ = db.update_thumbnail_path(*movie_id, &thumbnail_path);
                        }
                        thumbnail_count += 1;
                        debug!("[导入管理器] 缩略图成功: id={}", movie_id);

                        {
                            let mut status = self.scan_status.lock_recover();
                            status.stage_message = format!(
                                "生成缩略图中... ({}/{})",
                                thumbnail_count, total_thumbnails
                            );
                            status.scanned_files = thumbnail_count;
                            status.current_file = Some(format!("生成缩略图: {}", title));
                        }
                        self.emit_progress_throttled();
                    }
                    Err(e) => {
                        error!("[导入管理器] 缩略图失败: id={}, error={}", movie_id, e);
                    }
                }
            }
        }

        // Force a final emit so the UI lands on a clean "X/X" frame.
        {
            let mut status = self.scan_status.lock_recover();
            status.scanned_files = thumbnail_count;
            status.stage_message =
                format!("缩略图生成完成 ({}/{})", thumbnail_count, total_thumbnails);
            status.current_file = None;
        }
        self.emit_progress_force();

        info!(
            "[导入管理器] 缩略图生成完成: {}/{} 个",
            thumbnail_count, total_thumbnails
        );
        Ok(())
    }

    fn delete_invalid_records(&self) -> Result<usize, String> {
        info!("[导入管理器] 开始删除失效记录");
        let db = self.db.lock_recover();
        db.delete_invalid_records()
            .map_err(|e| format!("删除失效记录失败: {}", e))
    }

    fn set_stage(&self, stage: ImportStage, message: &str) {
        {
            let mut status = self.scan_status.lock_recover();
            status.stage = stage;
            status.stage_message = message.to_string();
            // Reset counters at stage boundaries so the UI does not show stale ratios.
            status.total_files = 0;
            status.scanned_files = 0;
            status.current_file = None;
        }
        self.emit_progress_force();
    }

    fn auto_detect_and_create_video_groups(&self) -> Result<(), String> {
        info!("[视频组检测] 开始自动检测");

        let movies = {
            let db = self.db.lock_recover();
            db.get_all_movies()
                .map_err(|e| format!("获取电影列表失败: {}", e))?
        };

        info!("[视频组检测] 共 {} 个电影需要检测", movies.len());

        let candidates = detect_video_groups(&movies);

        info!("[视频组检测] 检测到 {} 个候选视频组", candidates.len());

        if candidates.is_empty() {
            return Ok(());
        }

        let db = self.db.lock_recover();
        let conn = db.get_connection();
        let group_manager = VideoGroupManager::new(conn);

        info!("[视频组检测] 开始执行批量检测插入");
        match group_manager.create_video_groups_batch(&candidates) {
            Ok(count) => {
                info!(
                    "[视频组检测] 批量创建视频组成功: {}/{}",
                    count,
                    candidates.len()
                );
            }
            Err(e) => {
                error!("[视频组检测] 批量创建视频组失败: {}", e);
            }
        }

        Ok(())
    }

    fn reset_progress(&self) {
        let mut status = self.scan_status.lock_recover();
        status.is_scanning = true;
        status.total_files = 0;
        status.scanned_files = 0;
        status.current_file = None;
    }

    fn stop_requested(&self) -> bool {
        self.stop_scan_flag.load(Ordering::Relaxed)
    }

    fn build_scan_result(
        &self,
        new_movies: usize,
        updated_movies: i64,
        deleted_movies: usize,
    ) -> ScanResult {
        let total_movies = {
            let db = self.db.lock_recover();
            db.get_total_count().unwrap_or(0)
        };

        ScanResult {
            new_movies: new_movies as i64,
            updated_movies,
            deleted_movies: deleted_movies as i64,
            total_movies,
        }
    }

    fn emit_completion(&self, status: &str, result: Option<ScanResult>, message: Option<String>) {
        let payload = ScanCompletion {
            status: status.to_string(),
            result,
            message,
        };

        let _ = self.window.emit("scan-complete", payload);
    }

    fn set_complete_state(&self, result: &ScanResult) {
        let mut status = self.scan_status.lock_recover();
        status.is_scanning = false;
        status.current_file = None;
        self.emit_completion("success", Some(result.clone()), None);
    }

    fn set_cancelled_state(&self, result: &ScanResult, message: &str) {
        let mut status = self.scan_status.lock_recover();
        status.is_scanning = false;
        status.current_file = None;
        self.emit_completion("cancelled", Some(result.clone()), Some(message.to_string()));
    }

    fn set_error_state(&self, message: &str) {
        let mut status = self.scan_status.lock_recover();
        status.is_scanning = false;
        status.current_file = None;
        self.emit_completion("error", None, Some(message.to_string()));
    }
}
