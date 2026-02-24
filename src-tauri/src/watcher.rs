use notify::{Watcher, RecursiveMode, Event, EventKind, event::*};
use std::sync::mpsc::channel;
use std::path::Path;
use std::time::Duration;
use crate::indexer::{is_video_file, find_nfo_for_video, parse_nfo_file, extract_title_from_filename};
use crate::database::Database;
use log::{info, debug, warn, error};

pub fn start_watcher(
    paths: Vec<String>,
    db_path: String,
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
        
        loop {
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(event) => {
                    handle_fs_event(&db, event);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    warn!("[文件监听] 监听通道断开");
                    break;
                }
            }
        }
    });
    
    std::mem::forget(watcher);
    
    Ok(())
}

fn handle_fs_event(db: &Database, event: Event) {
    debug!("[文件监听] 检测到文件系统事件: {:?}", event.kind);
    
    match event.kind {
        EventKind::Create(CreateKind::File) | EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            for path in event.paths {
                if is_video_file(&path) {
                    debug!("[文件监听] 检测到新视频文件: {:?}", path);
                    
                    let metadata = find_nfo_for_video(&path)
                        .and_then(|nfo_path| {
                            debug!("[文件监听] 找到NFO文件: {:?}", nfo_path);
                            parse_nfo_file(&nfo_path)
                        });
                    
                    let title = if let Some(ref meta) = metadata {
                        meta.title.clone()
                    } else {
                        extract_title_from_filename(&path)
                    };
                    
                    let year = metadata.as_ref().and_then(|m| m.year);
                    let plot = metadata.as_ref().and_then(|m| m.plot.as_deref());
                    let rating = metadata.as_ref().and_then(|m| m.rating);
                    let genres = metadata.as_ref().and_then(|m| m.genres.as_deref());
                    let director = metadata.as_ref().and_then(|m| m.director.as_deref());
                    let actors = metadata.as_ref().and_then(|m| m.actors.as_deref());
                    let poster = metadata.as_ref().and_then(|m| m.poster.as_deref());
                    let fanart = metadata.as_ref().and_then(|m| m.fanart.as_deref());
                    
                    let file_path = path.to_string_lossy().to_string();
                    
                    if let Err(e) = db.insert_movie(
                        &file_path,
                        &title,
                        year,
                        plot,
                        rating,
                        genres,
                        director,
                        actors,
                        poster,
                        fanart,
                    ) {
                        error!("[文件监听] 新增电影失败: {} - {}", file_path, e);
                    } else {
                        info!("[文件监听] 新增电影: {}", title);
                    }
                }
            }
        }
        EventKind::Remove(RemoveKind::File) => {
            for path in event.paths {
                if is_video_file(&path) {
                    debug!("[文件监听] 检测到视频文件删除: {:?}", path);
                    
                    let file_path = path.to_string_lossy().to_string();
                    if let Err(e) = db.delete_movie_by_path(&file_path) {
                        error!("[文件监听] 删除电影失败: {} - {}", file_path, e);
                    } else {
                        info!("[文件监听] 删除电影: {}", file_path);
                    }
                }
            }
        }
        _ => {
            debug!("[文件监听] 忽略事件: {:?}", event.kind);
        }
    }
}
