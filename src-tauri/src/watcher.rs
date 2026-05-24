use notify::{Watcher, RecursiveMode, Event, EventKind, event::*};
use std::sync::mpsc::channel;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use crate::indexer::{is_video_file, find_nfo_for_video, parse_nfo_file, extract_title_from_filename, get_file_size, get_poster_path};
use crate::database::Database;
use crate::thumbnail;
use log::{info, debug, warn, error};

/// Window within which we treat a Remove + Create pair (matching file_size) as a rename.
const RENAME_WINDOW: Duration = Duration::from_secs(3);

struct PendingRemove {
    movie_id: i64,
    file_path: String,
    file_size: Option<i64>,
    removed_at: Instant,
}

fn is_nfo_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("nfo"))
        .unwrap_or(false)
}

pub fn start_watcher(
    paths: Vec<String>,
    db_path: String,
    cache_dir: String,
) -> Result<(), Box<dyn std::error::Error>> {
    info!("[文件监听] 监听器启动: {:?}", paths);
    
    let (tx, rx) = channel();
    
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    })?;
    
    for path in &paths {
        if Path::new(path).exists() {
            watcher.watch(Path::new(path), RecursiveMode::Recursive)?;
            info!("[文件监听] 开始监听路径: {}", path);
        } else {
            warn!("[文件监听] 路径不存在，跳过: {}", path);
        }
    }
    
    std::thread::spawn(move || {
        let _watcher = watcher;
        info!("[文件监听] 监听线程启动");

        let db = match Database::new(&db_path) {
            Ok(db) => {
                info!("[文件监听] 数据库连接成功");
                db
            }
            Err(e) => {
                error!("[文件监听] 数据库连接失败: {}", e);
                return;
            }
        };

        let mut pending_removes: Vec<PendingRemove> = Vec::new();

        loop {
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(event) => {
                    handle_fs_event(&db, &cache_dir, event, &mut pending_removes);
                    reap_pending_removes(&db, &mut pending_removes);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    reap_pending_removes(&db, &mut pending_removes);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    warn!("[文件监听] 监听通道断开");
                    break;
                }
            }
        }
    });
    
    Ok(())
}

fn handle_nfo_modified(db: &Database, nfo_path: &Path) {
    debug!("[文件监听] 检测到NFO文件修改: {:?}", nfo_path);

    let parent = match nfo_path.parent() {
        Some(p) => p,
        None => return,
    };

    // Find video files in the same directory
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if is_video_file(&path) {
                // Check if this video corresponds to this NFO
                let matched_nfo = find_nfo_for_video(&path);
                if let Some(matched) = matched_nfo {
                    if matched == nfo_path {
                        let file_path_str = path.to_string_lossy().to_string();

                        // Look up movie in DB
                        if let Ok(Some(movie)) = db.get_movie_by_path(&file_path_str) {
                            let metadata = parse_nfo_file(nfo_path);

                            let title = metadata.as_ref().map(|m| m.title.clone())
                                .unwrap_or_else(|| extract_title_from_filename(&path));
                            let year = metadata.as_ref().and_then(|m| m.year);
                            let plot = metadata.as_ref().and_then(|m| m.plot.as_deref());
                            let rating = metadata.as_ref().and_then(|m| m.rating);
                            let genres = metadata.as_ref().and_then(|m| m.genres.as_deref());
                            let director = metadata.as_ref().and_then(|m| m.director.as_deref());
                            let actors = metadata.as_ref().and_then(|m| m.actors.as_deref());
                            let file_size = get_file_size(&path);

                            if let Err(e) = db.update_movie_metadata(
                                movie.id, &title, year, plot, rating, genres, director, actors, file_size,
                            ) {
                                error!("[文件监听] 更新电影元数据失败: id={}, error={}", movie.id, e);
                            } else {
                                info!("[文件监听] 更新电影元数据: id={}, title={}", movie.id, title);
                            }
                        }
                    }
                }
            }
        }
    }
}

fn ensure_thumbnail(db: &Database, cache_dir: &str, movie_id: i64, video_path: &Path) {
    let poster = match get_poster_path(video_path) {
        Some(p) => p,
        None => {
            debug!("[文件监听] 无海报，跳过缩略图生成: id={}", movie_id);
            return;
        }
    };

    let thumb_path = thumbnail::get_thumbnail_path(cache_dir, movie_id);
    if Path::new(&thumb_path).exists() {
        let _ = db.update_thumbnail_path(movie_id, &thumb_path);
        return;
    }

    match thumbnail::generate_thumbnail(&poster, &thumb_path) {
        Ok(_) => {
            if let Err(e) = db.update_thumbnail_path(movie_id, &thumb_path) {
                error!("[文件监听] 更新缩略图路径失败: id={}, error={}", movie_id, e);
            } else {
                info!("[文件监听] 缩略图生成成功: id={}", movie_id);
            }
        }
        Err(e) => error!("[文件监听] 缩略图生成失败: id={}, error={}", movie_id, e),
    }
}

fn reap_pending_removes(db: &Database, pending: &mut Vec<PendingRemove>) {
    let now = Instant::now();
    let mut still_pending = Vec::with_capacity(pending.len());
    for p in pending.drain(..) {
        if now.duration_since(p.removed_at) > RENAME_WINDOW {
            // No matching Create within the window — commit the deletion now.
            if let Err(e) = db.delete_movie_by_path(&p.file_path) {
                error!("[文件监听] 延迟删除失败: {} - {}", p.file_path, e);
            } else {
                info!("[文件监听] 延迟删除生效: {}", p.file_path);
            }
        } else {
            still_pending.push(p);
        }
    }
    *pending = still_pending;
}

/// If a recent Remove with matching file size is sitting in `pending`, treat the new path
/// as a rename of that movie. Returns Some(movie_id) on rename match.
fn try_match_rename(
    db: &Database,
    pending: &mut Vec<PendingRemove>,
    new_path: &Path,
    new_size: Option<i64>,
) -> Option<i64> {
    let target_size = new_size?;
    let now = Instant::now();
    let pos = pending.iter().position(|p| {
        p.file_size == Some(target_size)
            && now.duration_since(p.removed_at) <= RENAME_WINDOW
    })?;

    let matched = pending.remove(pos);
    let new_path_str = new_path.to_string_lossy().to_string();
    match db.update_file_path(matched.movie_id, &new_path_str) {
        Ok(_) => {
            info!("[文件监听] 识别为重命名: id={}, {} -> {}",
                  matched.movie_id, matched.file_path, new_path_str);
            Some(matched.movie_id)
        }
        Err(e) => {
            error!("[文件监听] 重命名路径更新失败: id={}, error={}", matched.movie_id, e);
            None
        }
    }
}

fn handle_path_swap(db: &Database, from: &Path, to: &Path) {
    let from_str = from.to_string_lossy().to_string();
    let to_str = to.to_string_lossy().to_string();

    match db.get_movie_by_path(&from_str) {
        Ok(Some(movie)) => {
            if let Err(e) = db.update_file_path(movie.id, &to_str) {
                error!("[文件监听] 重命名路径更新失败: id={}, error={}", movie.id, e);
            } else {
                info!("[文件监听] 重命名 (Both): id={}, {} -> {}", movie.id, from_str, to_str);
            }
        }
        Ok(None) => {
            debug!("[文件监听] 重命名 (Both) 源路径无对应记录: {}", from_str);
        }
        Err(e) => error!("[文件监听] 查询电影失败: {} - {}", from_str, e),
    }
}

fn handle_new_video(
    db: &Database,
    cache_dir: &str,
    pending: &mut Vec<PendingRemove>,
    path: &Path,
) {
    debug!("[文件监听] 检测到新视频文件: {:?}", path);

    let file_size = get_file_size(path);

    // First, see if this Create is actually the tail end of a rename we just observed.
    if let Some(movie_id) = try_match_rename(db, pending, path, file_size) {
        ensure_thumbnail(db, cache_dir, movie_id, path);
        return;
    }

    let metadata = find_nfo_for_video(path)
        .and_then(|nfo_path| {
            debug!("[文件监听] 找到NFO文件: {:?}", nfo_path);
            parse_nfo_file(&nfo_path)
        });

    let title = metadata.as_ref().map(|m| m.title.clone())
        .unwrap_or_else(|| extract_title_from_filename(path));
    let year = metadata.as_ref().and_then(|m| m.year);
    let plot = metadata.as_ref().and_then(|m| m.plot.as_deref());
    let rating = metadata.as_ref().and_then(|m| m.rating);
    let genres = metadata.as_ref().and_then(|m| m.genres.as_deref());
    let director = metadata.as_ref().and_then(|m| m.director.as_deref());
    let actors = metadata.as_ref().and_then(|m| m.actors.as_deref());

    let file_path = path.to_string_lossy().to_string();

    match db.insert_movie(
        &file_path,
        &title,
        year,
        plot,
        rating,
        genres,
        director,
        actors,
        file_size,
        None,
        None,
        None,
    ) {
        Ok(id) => {
            info!("[文件监听] 新增电影: id={}, title={}", id, title);
            ensure_thumbnail(db, cache_dir, id, path);
        }
        Err(e) => error!("[文件监听] 新增电影失败: {} - {}", file_path, e),
    }
}

fn handle_remove_video(db: &Database, pending: &mut Vec<PendingRemove>, path: &Path) {
    debug!("[文件监听] 检测到视频文件删除: {:?}", path);

    let file_path = path.to_string_lossy().to_string();
    match db.get_movie_by_path(&file_path) {
        Ok(Some(movie)) => {
            // Defer the delete: a rename will surface as Create with matching file_size shortly.
            pending.push(PendingRemove {
                movie_id: movie.id,
                file_path: file_path.clone(),
                file_size: movie.file_size,
                removed_at: Instant::now(),
            });
            debug!("[文件监听] 删除挂起，等待可能的重命名: id={}, path={}", movie.id, file_path);
        }
        Ok(None) => {
            debug!("[文件监听] 删除事件无对应记录: {}", file_path);
        }
        Err(e) => error!("[文件监听] 查询电影失败: {} - {}", file_path, e),
    }
}

fn handle_fs_event(
    db: &Database,
    cache_dir: &str,
    event: Event,
    pending: &mut Vec<PendingRemove>,
) {
    debug!("[文件监听] 检测到文件系统事件: {:?}", event.kind);

    match event.kind {
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            // notify emits [from, to] in one event on platforms that can pair them.
            let paths: Vec<PathBuf> = event.paths.into_iter()
                .filter(|p| is_video_file(p))
                .collect();
            if paths.len() == 2 {
                handle_path_swap(db, &paths[0], &paths[1]);
            } else {
                debug!("[文件监听] 忽略不对称 rename(Both) 事件: {:?}", paths);
            }
        }
        EventKind::Create(CreateKind::File) | EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            for path in event.paths {
                if is_video_file(&path) {
                    handle_new_video(db, cache_dir, pending, &path);
                }
            }
        }
        EventKind::Modify(ModifyKind::Data(_)) | EventKind::Modify(ModifyKind::Any) => {
            for path in event.paths {
                if is_nfo_file(&path) {
                    handle_nfo_modified(db, &path);
                }
            }
        }
        EventKind::Remove(RemoveKind::File) | EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            for path in event.paths {
                if is_video_file(&path) {
                    handle_remove_video(db, pending, &path);
                }
            }
        }
        _ => {
            debug!("[文件监听] 忽略事件: {:?}", event.kind);
        }
    }
}
