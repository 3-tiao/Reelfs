use notify::{Watcher, RecursiveMode, Event, EventKind, event::*};
use std::sync::mpsc::channel;
use std::path::Path;
use std::time::Duration;
use crate::indexer::{is_video_file, find_nfo_for_video, parse_nfo_file, extract_title_from_filename};
use crate::database::Database;

pub fn start_watcher(
    paths: Vec<String>,
    db_path: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, rx) = channel();
    
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    })?;
    
    for path in &paths {
        if Path::new(path).exists() {
            watcher.watch(Path::new(path), RecursiveMode::Recursive)?;
        }
    }
    
    std::thread::spawn(move || {
        let db = match Database::new(&db_path) {
            Ok(db) => db,
            Err(e) => {
                eprintln!("Failed to open database in watcher: {}", e);
                return;
            }
        };
        
        loop {
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(event) => {
                    handle_fs_event(&db, event);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
    
    std::mem::forget(watcher);
    
    Ok(())
}

fn handle_fs_event(db: &Database, event: Event) {
    match event.kind {
        EventKind::Create(CreateKind::File) | EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            for path in event.paths {
                if is_video_file(&path) {
                    let metadata = find_nfo_for_video(&path)
                        .and_then(|nfo_path| parse_nfo_file(&nfo_path));
                    
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
                        eprintln!("Failed to insert movie {}: {}", file_path, e);
                    } else {
                        println!("Added new movie: {}", title);
                    }
                }
            }
        }
        EventKind::Remove(RemoveKind::File) => {
            for path in event.paths {
                if is_video_file(&path) {
                    let file_path = path.to_string_lossy().to_string();
                    if let Err(e) = db.delete_movie_by_path(&file_path) {
                        eprintln!("Failed to delete movie {}: {}", file_path, e);
                    } else {
                        println!("Removed movie: {}", file_path);
                    }
                }
            }
        }
        _ => {}
    }
}
