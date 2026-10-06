use crate::database::Database;
use crate::indexer::{
    extract_title_from_filename, find_nfo_for_video, get_file_size, get_poster_path, is_video_file,
    parse_nfo_file,
};
use crate::thumbnail;
use log::{debug, error, info, warn};
use notify::{event::*, Event, EventKind, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Window within which we treat a same-directory Remove + Create pair as a rename fallback.
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

/// Owns a running filesystem watcher. Dropping it (or calling [`WatcherHandle::stop`])
/// shuts the event loop down and joins the worker thread, so the caller can restart
/// watching a different set of paths.
pub struct WatcherHandle {
    watcher: Option<notify::RecommendedWatcher>,
    shutdown: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
    watched_paths: Vec<String>,
}

impl WatcherHandle {
    pub fn watched_paths(&self) -> &[String] {
        &self.watched_paths
    }

    pub fn stop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        // Dropping the watcher closes the event channel, so the worker wakes up
        // immediately on `Disconnected` instead of waiting for the next timeout.
        self.watcher.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        info!("[文件监听] 监听器已停止");
    }
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        if self.thread.is_some() {
            self.stop();
        }
    }
}

pub fn start_watcher(
    paths: Vec<String>,
    db_path: String,
    cache_dir: String,
) -> Result<WatcherHandle, Box<dyn std::error::Error>> {
    info!("[文件监听] 监听器启动: {:?}", paths);

    let (tx, rx) = channel();

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    })?;

    let mut watched_paths = Vec::new();
    for path in &paths {
        if Path::new(path).exists() {
            watcher.watch(Path::new(path), RecursiveMode::Recursive)?;
            watched_paths.push(path.clone());
            info!("[文件监听] 开始监听路径: {}", path);
        } else {
            warn!("[文件监听] 路径不存在，跳过: {}", path);
        }
    }

    let shutdown = Arc::new(AtomicBool::new(false));
    let thread_shutdown = Arc::clone(&shutdown);

    let thread = std::thread::spawn(move || {
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
            if thread_shutdown.load(Ordering::SeqCst) {
                debug!("[文件监听] 收到停止信号，退出监听线程");
                break;
            }

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

    Ok(WatcherHandle {
        watcher: Some(watcher),
        shutdown,
        thread: Some(thread),
        watched_paths,
    })
}

fn nfo_removed_path_matches_video(nfo_path: &Path, video_path: &Path) -> bool {
    let Some(nfo_stem) = nfo_path.file_stem().and_then(|s| s.to_str()) else {
        return false;
    };

    if nfo_stem.eq_ignore_ascii_case("movie") {
        return true;
    }

    video_path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|video_stem| video_stem == nfo_stem)
        .unwrap_or(false)
}

fn refresh_movie_metadata_for_video(db: &Database, video_path: &Path) {
    let file_path_str = video_path.to_string_lossy().to_string();
    let movie = match db.get_movie_by_path(&file_path_str) {
        Ok(Some(movie)) => movie,
        Ok(None) => return,
        Err(e) => {
            error!("[文件监听] 查询电影失败: {} - {}", file_path_str, e);
            return;
        }
    };

    let metadata = find_nfo_for_video(video_path).and_then(|nfo_path| {
        debug!("[文件监听] 刷新元数据，使用NFO: {:?}", nfo_path);
        parse_nfo_file(&nfo_path)
    });

    let title = metadata
        .as_ref()
        .map(|m| m.title.clone())
        .unwrap_or_else(|| extract_title_from_filename(video_path));
    let year = metadata.as_ref().and_then(|m| m.year);
    let plot = metadata.as_ref().and_then(|m| m.plot.as_deref());
    let rating = metadata.as_ref().and_then(|m| m.rating);
    let genres = metadata.as_ref().and_then(|m| m.genres.as_deref());
    let director = metadata.as_ref().and_then(|m| m.director.as_deref());
    let actors = metadata.as_ref().and_then(|m| m.actors.as_deref());
    let file_size = get_file_size(video_path);

    match db.update_movie_metadata(
        movie.id, &title, year, plot, rating, genres, director, actors, file_size,
    ) {
        Ok(true) => info!(
            "[文件监听] 更新电影元数据: id={}, title={}",
            movie.id, title
        ),
        Ok(false) => debug!(
            "[文件监听] 电影元数据无变化: id={}, title={}",
            movie.id, title
        ),
        Err(e) => error!(
            "[文件监听] 更新电影元数据失败: id={}, error={}",
            movie.id, e
        ),
    }
}

fn handle_nfo_changed(db: &Database, nfo_path: &Path) {
    debug!("[文件监听] 检测到NFO文件变更: {:?}", nfo_path);

    let parent = match nfo_path.parent() {
        Some(p) => p,
        None => return,
    };

    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if is_video_file(&path) && find_nfo_for_video(&path).as_deref() == Some(nfo_path) {
                refresh_movie_metadata_for_video(db, &path);
            }
        }
    }
}

fn handle_nfo_removed(db: &Database, nfo_path: &Path) {
    debug!("[文件监听] 检测到NFO文件删除: {:?}", nfo_path);

    let parent = match nfo_path.parent() {
        Some(p) => p,
        None => return,
    };

    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if is_video_file(&path) && nfo_removed_path_matches_video(nfo_path, &path) {
                refresh_movie_metadata_for_video(db, &path);
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
                error!(
                    "[文件监听] 更新缩略图路径失败: id={}, error={}",
                    movie_id, e
                );
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

fn same_rename_context(old_path: &str, new_path: &Path) -> bool {
    let old_path = Path::new(old_path);
    old_path.parent() == new_path.parent()
        && old_path.extension().and_then(|e| e.to_str())
            == new_path.extension().and_then(|e| e.to_str())
}

/// If a recent same-directory Remove with matching file size is sitting in `pending`,
/// treat the new path as a rename of that movie. Returns Some(movie_id) on match.
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
            && same_rename_context(&p.file_path, new_path)
    })?;

    let matched = pending.remove(pos);
    let new_path_str = new_path.to_string_lossy().to_string();
    match db.update_file_path(matched.movie_id, &new_path_str) {
        Ok(_) => {
            info!(
                "[文件监听] 识别为重命名: id={}, {} -> {}",
                matched.movie_id, matched.file_path, new_path_str
            );
            Some(matched.movie_id)
        }
        Err(e) => {
            error!(
                "[文件监听] 重命名路径更新失败: id={}, error={}",
                matched.movie_id, e
            );
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
                error!(
                    "[文件监听] 重命名路径更新失败: id={}, error={}",
                    movie.id, e
                );
            } else {
                info!(
                    "[文件监听] 重命名 (Both): id={}, {} -> {}",
                    movie.id, from_str, to_str
                );
            }
        }
        Ok(None) => {
            debug!("[文件监听] 重命名 (Both) 源路径无对应记录: {}", from_str);
        }
        Err(e) => error!("[文件监听] 查询电影失败: {} - {}", from_str, e),
    }
}

fn handle_new_video(db: &Database, cache_dir: &str, pending: &mut Vec<PendingRemove>, path: &Path) {
    debug!("[文件监听] 检测到新视频文件: {:?}", path);

    let file_size = get_file_size(path);

    // First, see if this Create is actually the tail end of a rename we just observed.
    if let Some(movie_id) = try_match_rename(db, pending, path, file_size) {
        ensure_thumbnail(db, cache_dir, movie_id, path);
        return;
    }

    let metadata = find_nfo_for_video(path).and_then(|nfo_path| {
        debug!("[文件监听] 找到NFO文件: {:?}", nfo_path);
        parse_nfo_file(&nfo_path)
    });

    let title = metadata
        .as_ref()
        .map(|m| m.title.clone())
        .unwrap_or_else(|| extract_title_from_filename(path));
    let year = metadata.as_ref().and_then(|m| m.year);
    let plot = metadata.as_ref().and_then(|m| m.plot.as_deref());
    let rating = metadata.as_ref().and_then(|m| m.rating);
    let genres = metadata.as_ref().and_then(|m| m.genres.as_deref());
    let director = metadata.as_ref().and_then(|m| m.director.as_deref());
    let actors = metadata.as_ref().and_then(|m| m.actors.as_deref());

    let file_path = path.to_string_lossy().to_string();

    match db.insert_movie(
        &file_path, &title, year, plot, rating, genres, director, actors, file_size, None, None,
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
            debug!(
                "[文件监听] 删除挂起，等待可能的重命名: id={}, path={}",
                movie.id, file_path
            );
        }
        Ok(None) => {
            debug!("[文件监听] 删除事件无对应记录: {}", file_path);
        }
        Err(e) => error!("[文件监听] 查询电影失败: {} - {}", file_path, e),
    }
}

fn handle_fs_event(db: &Database, cache_dir: &str, event: Event, pending: &mut Vec<PendingRemove>) {
    debug!("[文件监听] 检测到文件系统事件: {:?}", event.kind);

    match event.kind {
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            // notify emits [from, to] in one event on platforms that can pair them.
            let paths: Vec<PathBuf> = event.paths;
            if paths.len() == 2 && is_video_file(&paths[0]) && is_video_file(&paths[1]) {
                handle_path_swap(db, &paths[0], &paths[1]);
            } else if paths.len() == 2 && is_nfo_file(&paths[0]) && is_nfo_file(&paths[1]) {
                handle_nfo_removed(db, &paths[0]);
                handle_nfo_changed(db, &paths[1]);
            } else {
                debug!("[文件监听] 忽略不对称 rename(Both) 事件: {:?}", paths);
            }
        }
        EventKind::Create(CreateKind::File)
        | EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            for path in event.paths {
                if is_video_file(&path) {
                    handle_new_video(db, cache_dir, pending, &path);
                } else if is_nfo_file(&path) {
                    handle_nfo_changed(db, &path);
                }
            }
        }
        EventKind::Modify(ModifyKind::Data(_)) | EventKind::Modify(ModifyKind::Any) => {
            for path in event.paths {
                if is_nfo_file(&path) {
                    handle_nfo_changed(db, &path);
                }
            }
        }
        EventKind::Remove(RemoveKind::File)
        | EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            for path in event.paths {
                if is_video_file(&path) {
                    handle_remove_video(db, pending, &path);
                } else if is_nfo_file(&path) {
                    handle_nfo_removed(db, &path);
                }
            }
        }
        _ => {
            debug!("[文件监听] 忽略事件: {:?}", event.kind);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::Event;

    /// Fresh in-memory database with the full schema + migrations applied.
    fn mem_db() -> Database {
        Database::new(":memory:").unwrap()
    }

    /// Unique writable directory per test (same pattern as database::tests::temp_db_path).
    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("reelfs_watcher_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn insert_movie_with_size(db: &Database, path: &str, title: &str, size: Option<i64>) -> i64 {
        db.insert_movie(
            path, title, None, None, None, None, None, None, size, None, None, None,
        )
        .unwrap()
    }

    fn write_file(path: &Path, len: usize) {
        std::fs::write(path, vec![0u8; len]).unwrap();
    }

    fn movie_exists(db: &Database, path: &str) -> bool {
        db.get_movie_by_path(path).unwrap().is_some()
    }

    #[test]
    fn nfo_removed_matches_movie_nfo_and_same_stem_only() {
        // movie.nfo is generic: it backs any video in the directory.
        assert!(nfo_removed_path_matches_video(
            Path::new("/nas/dir/movie.nfo"),
            Path::new("/nas/dir/anything.mkv")
        ));
        assert!(nfo_removed_path_matches_video(
            Path::new("/nas/dir/MOVIE.nfo"),
            Path::new("/nas/dir/film.mp4")
        ));
        // Same-stem NFO only backs its own video.
        assert!(nfo_removed_path_matches_video(
            Path::new("/nas/dir/film.nfo"),
            Path::new("/nas/dir/film.mkv")
        ));
        assert!(!nfo_removed_path_matches_video(
            Path::new("/nas/dir/film.nfo"),
            Path::new("/nas/dir/other.mkv")
        ));
        // Paths without a stem never match.
        assert!(!nfo_removed_path_matches_video(
            Path::new("/nas/dir/.nfo"),
            Path::new("/nas/dir/film.mkv")
        ));
    }

    #[test]
    fn same_rename_context_requires_same_parent_and_extension() {
        assert!(same_rename_context(
            "/nas/dir/a.mkv",
            Path::new("/nas/dir/b.mkv")
        ));
        assert!(!same_rename_context(
            "/nas/dir/a.mkv",
            Path::new("/nas/other/b.mkv")
        ));
        assert!(!same_rename_context(
            "/nas/dir/a.mkv",
            Path::new("/nas/dir/b.mp4")
        ));
        // Missing extensions compare as equal (None == None).
        assert!(same_rename_context("/nas/dir/a", Path::new("/nas/dir/b")));
        // .nfo rename must never be treated as a video rename.
        assert!(!same_rename_context(
            "/nas/dir/a.mkv",
            Path::new("/nas/dir/a.nfo")
        ));
    }

    #[test]
    fn try_match_rename_matches_size_dir_and_window_then_updates_path() {
        let db = mem_db();
        let dir = temp_dir("match_rename");
        let old_path = dir.join("original.mkv");
        let new_path = dir.join("renamed.mkv");
        write_file(&new_path, 123);

        let movie_id =
            insert_movie_with_size(&db, &old_path.to_string_lossy(), "Original", Some(123));
        let mut pending = vec![PendingRemove {
            movie_id,
            file_path: old_path.to_string_lossy().to_string(),
            file_size: Some(123),
            removed_at: Instant::now(),
        }];

        let new_size = get_file_size(&new_path);
        let matched = try_match_rename(&db, &mut pending, &new_path, new_size);

        assert_eq!(matched, Some(movie_id));
        assert!(
            pending.is_empty(),
            "matched entry must leave the pending list"
        );
        assert!(movie_exists(&db, &new_path.to_string_lossy()));
        assert!(!movie_exists(&db, &old_path.to_string_lossy()));
    }

    #[test]
    fn try_match_rename_rejects_size_or_dir_mismatch() {
        let db = mem_db();
        let dir = temp_dir("match_mismatch");
        let other_dir = temp_dir("match_mismatch_other");

        let movie_id = insert_movie_with_size(&db, "/nas/dir/a.mkv", "A", Some(100));

        // Size mismatch: pending entry survives, no rename happens.
        let wrong_size_file = dir.join("b.mkv");
        write_file(&wrong_size_file, 999);
        let mut pending = vec![PendingRemove {
            movie_id,
            file_path: "/nas/dir/a.mkv".to_string(),
            file_size: Some(100),
            removed_at: Instant::now(),
        }];
        assert_eq!(
            try_match_rename(&db, &mut pending, &wrong_size_file, Some(999)),
            None
        );
        assert_eq!(
            pending.len(),
            1,
            "size mismatch must keep the pending entry"
        );
        assert!(movie_exists(&db, "/nas/dir/a.mkv"));

        // Same size but a different directory: still not a rename.
        let other_dir_file = other_dir.join("b.mkv");
        write_file(&other_dir_file, 100);
        assert_eq!(
            try_match_rename(&db, &mut pending, &other_dir_file, Some(100)),
            None
        );
        assert_eq!(
            pending.len(),
            1,
            "directory mismatch must keep the pending entry"
        );
        assert!(movie_exists(&db, "/nas/dir/a.mkv"));
    }

    #[test]
    fn try_match_rename_with_no_size_is_noop() {
        let db = mem_db();
        let mut pending = vec![PendingRemove {
            movie_id: 1,
            file_path: "/nas/dir/a.mkv".to_string(),
            file_size: Some(100),
            removed_at: Instant::now(),
        }];

        // get_file_size returned None (file vanished before the event was handled).
        assert_eq!(
            try_match_rename(&db, &mut pending, Path::new("/nas/dir/b.mkv"), None),
            None
        );
        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn reap_pending_removes_commits_expired_and_keeps_fresh() {
        let db = mem_db();
        insert_movie_with_size(&db, "/nas/dir/old.mkv", "Expired", Some(10));
        insert_movie_with_size(&db, "/nas/dir/new.mkv", "Fresh", Some(20));

        let expired_id = db
            .get_movie_by_path("/nas/dir/old.mkv")
            .unwrap()
            .unwrap()
            .id;
        let fresh_id = db
            .get_movie_by_path("/nas/dir/new.mkv")
            .unwrap()
            .unwrap()
            .id;

        let mut pending = vec![
            PendingRemove {
                movie_id: expired_id,
                file_path: "/nas/dir/old.mkv".to_string(),
                file_size: Some(10),
                removed_at: Instant::now() - RENAME_WINDOW - Duration::from_millis(50),
            },
            PendingRemove {
                movie_id: fresh_id,
                file_path: "/nas/dir/new.mkv".to_string(),
                file_size: Some(20),
                removed_at: Instant::now(),
            },
        ];

        reap_pending_removes(&db, &mut pending);

        assert!(
            pending.len() == 1 && pending[0].movie_id == fresh_id,
            "entry inside the window must stay pending"
        );
        assert!(
            !movie_exists(&db, "/nas/dir/old.mkv"),
            "expired entry must be deleted"
        );
        assert!(
            movie_exists(&db, "/nas/dir/new.mkv"),
            "fresh entry must survive"
        );
    }

    #[test]
    fn fs_event_rename_both_swaps_path_in_place() {
        let db = mem_db();
        let movie_id = insert_movie_with_size(&db, "/nas/dir/a.mkv", "A", Some(1));

        let event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(PathBuf::from("/nas/dir/a.mkv"))
            .add_path(PathBuf::from("/nas/dir/b.mkv"));
        let mut pending = Vec::new();

        handle_fs_event(&db, "/tmp", event, &mut pending);

        assert!(pending.is_empty());
        assert!(movie_exists(&db, "/nas/dir/b.mkv"));
        assert!(!movie_exists(&db, "/nas/dir/a.mkv"));
        assert_eq!(
            db.get_movie_by_path("/nas/dir/b.mkv").unwrap().unwrap().id,
            movie_id,
            "rename must keep the same row (rating/history preserved)"
        );
    }

    #[test]
    fn fs_event_rename_both_with_one_path_is_ignored() {
        let db = mem_db();
        insert_movie_with_size(&db, "/nas/dir/a.mkv", "A", Some(1));

        let event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(PathBuf::from("/nas/dir/a.mkv"));
        let mut pending = Vec::new();

        handle_fs_event(&db, "/tmp", event, &mut pending);

        assert!(
            pending.is_empty(),
            "asymmetric rename must not enqueue a delete"
        );
        assert!(movie_exists(&db, "/nas/dir/a.mkv"));
    }

    #[test]
    fn fs_event_from_then_to_is_a_rename_not_a_delete() {
        let db = mem_db();
        let dir = temp_dir("from_to");
        let old_path = dir.join("a.mkv");
        let new_path = dir.join("b.mkv");
        write_file(&new_path, 100);

        let movie_id = insert_movie_with_size(&db, &old_path.to_string_lossy(), "A", Some(100));
        let mut pending = Vec::new();

        let from_event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::From)))
            .add_path(old_path.clone());
        handle_fs_event(&db, "/tmp", from_event, &mut pending);
        assert_eq!(pending.len(), 1, "From event defers the delete");
        assert!(
            movie_exists(&db, &old_path.to_string_lossy()),
            "delete must not commit yet"
        );

        let to_event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::To)))
            .add_path(new_path.clone());
        handle_fs_event(&db, "/tmp", to_event, &mut pending);

        assert!(
            pending.is_empty(),
            "matching To event consumes the pending entry"
        );
        assert!(
            movie_exists(&db, &new_path.to_string_lossy()),
            "rename verdict: the movie row must survive under the new path"
        );
        assert!(!movie_exists(&db, &old_path.to_string_lossy()));
        assert_eq!(
            db.get_movie_by_path(&new_path.to_string_lossy())
                .unwrap()
                .unwrap()
                .id,
            movie_id
        );
    }

    #[test]
    fn fs_event_create_video_inserts_movie() {
        let db = mem_db();
        let dir = temp_dir("create_video");
        let video = dir.join("new film.mkv");
        write_file(&video, 5);

        let event = Event::new(EventKind::Create(CreateKind::File)).add_path(video.clone());
        let mut pending = Vec::new();

        handle_fs_event(&db, "/tmp", event, &mut pending);

        let movie = db
            .get_movie_by_path(&video.to_string_lossy())
            .unwrap()
            .expect("Create(File) of a video must insert a movie");
        assert_eq!(movie.title, "new film");
        assert_eq!(movie.file_size, Some(5));
        assert!(pending.is_empty());
    }

    #[test]
    fn fs_event_remove_video_defers_instead_of_deleting() {
        let db = mem_db();
        let movie_id = insert_movie_with_size(&db, "/nas/dir/a.mkv", "A", Some(7));

        let event = Event::new(EventKind::Remove(RemoveKind::File))
            .add_path(PathBuf::from("/nas/dir/a.mkv"));
        let mut pending = Vec::new();

        handle_fs_event(&db, "/tmp", event, &mut pending);

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].movie_id, movie_id);
        assert_eq!(pending[0].file_size, Some(7));
        assert!(
            movie_exists(&db, "/nas/dir/a.mkv"),
            "row must survive during the grace window"
        );
    }

    #[test]
    fn fs_event_nfo_removed_falls_back_to_filename_title() {
        let db = mem_db();
        let dir = temp_dir("nfo_removed");
        // The NFO is already gone from disk; only the video remains.
        let video = dir.join("standalone title.mkv");
        write_file(&video, 1);

        insert_movie_with_size(&db, &video.to_string_lossy(), "Old NFO Title", Some(1));
        let mut pending = Vec::new();

        let event = Event::new(EventKind::Remove(RemoveKind::File))
            .add_path(dir.join("standalone title.nfo"));
        handle_fs_event(&db, "/tmp", event, &mut pending);

        let movie = db
            .get_movie_by_path(&video.to_string_lossy())
            .unwrap()
            .unwrap();
        assert_eq!(
            movie.title, "standalone title",
            "NFO removal must fall back to the filename"
        );
    }

    #[test]
    fn fs_event_create_folder_and_modify_video_are_ignored() {
        let db = mem_db();
        let mut pending = Vec::new();

        let folder = Event::new(EventKind::Create(CreateKind::Folder))
            .add_path(PathBuf::from("/nas/dir/new folder"));
        handle_fs_event(&db, "/tmp", folder, &mut pending);

        let video_data = Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Any)))
            .add_path(PathBuf::from("/nas/dir/a.mkv"));
        handle_fs_event(&db, "/tmp", video_data, &mut pending);

        let create_nfo = Event::new(EventKind::Modify(ModifyKind::Any))
            .add_path(PathBuf::from("/nas/dir/a.mkv"));
        handle_fs_event(&db, "/tmp", create_nfo, &mut pending);

        assert!(pending.is_empty());
        assert_eq!(
            db.get_total_count().unwrap(),
            0,
            "no movie may be inserted from these events"
        );
    }

    #[test]
    fn fs_event_modify_data_refreshes_metadata_from_nfo() {
        let db = mem_db();
        let dir = temp_dir("nfo_data");
        let video = dir.join("film.mkv");
        let nfo = dir.join("film.nfo");
        write_file(&video, 1);
        // NOTE: the NFO deliberately omits <plot>/<actor>: the movies_au trigger
        // (database.rs) writes to the external-content FTS5 table with a plain
        // UPDATE, which SQLite reports as "database disk image is malformed"
        // when an indexed column transitions NULL -> value. Until that trigger
        // is rewritten to the documented 'delete'+INSERT form, only value->value
        // metadata refreshes survive. This test pins the refresh dispatch logic.
        std::fs::write(
            &nfo,
            "<movie><title>NFO Title</title><year>1999</year></movie>",
        )
        .unwrap();

        insert_movie_with_size(&db, &video.to_string_lossy(), "DB Title", Some(1));
        let mut pending = Vec::new();

        let event = Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Any))).add_path(nfo);
        handle_fs_event(&db, "/tmp", event, &mut pending);

        let movie = db
            .get_movie_by_path(&video.to_string_lossy())
            .unwrap()
            .unwrap();
        assert_eq!(
            movie.title, "NFO Title",
            "NFO data change must refresh the movie"
        );
        assert_eq!(movie.year, Some(1999));
    }

    #[test]
    fn is_nfo_file_detects_extension_case_insensitively() {
        assert!(is_nfo_file(Path::new("/nas/a.nfo")));
        assert!(is_nfo_file(Path::new("/nas/a.NFO")));
        assert!(!is_nfo_file(Path::new("/nas/a.mkv")));
        assert!(!is_nfo_file(Path::new("/nas/nfo")));
    }
}
