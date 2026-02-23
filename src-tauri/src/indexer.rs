use crate::models::MovieMetadata;
use quick_xml::de::from_str;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &["mkv", "mp4", "avi", "mov", "wmv", "flv", "webm", "m4v"];

#[derive(Debug, Deserialize)]
struct NfoMovie {
    title: Option<String>,
    year: Option<i32>,
    plot: Option<String>,
    rating: Option<f64>,
    genre: Option<Vec<String>>,
    director: Option<String>,
    actor: Option<Vec<NfoActor>>,
    thumb: Option<Vec<NfoThumb>>,
    fanart: Option<NfoFanart>,
}

#[derive(Debug, Deserialize)]
struct NfoActor {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NfoThumb {
    #[serde(rename = "$value")]
    value: Option<String>,
    aspect: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NfoFanart {
    thumb: Option<Vec<NfoThumb>>,
}

pub fn is_video_file(path: &Path) -> bool {
    if let Some(ext) = path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        VIDEO_EXTENSIONS.contains(&ext_str.as_str())
    } else {
        false
    }
}

pub fn find_nfo_for_video(video_path: &Path) -> Option<PathBuf> {
    let parent = video_path.parent()?;
    let stem = video_path.file_stem()?;
    
    let nfo_path = parent.join(format!("{}.nfo", stem.to_string_lossy()));
    if nfo_path.exists() {
        return Some(nfo_path);
    }
    
    let movie_nfo = parent.join("movie.nfo");
    if movie_nfo.exists() {
        return Some(movie_nfo);
    }
    
    None
}

pub fn parse_nfo_file(nfo_path: &Path) -> Option<MovieMetadata> {
    let content = fs::read_to_string(nfo_path).ok()?;
    
    let nfo: NfoMovie = from_str(&content).ok()?;
    
    let genres = nfo.genre
        .map(|g| g.join(", "));
    
    let actors = nfo.actor
        .map(|actors| {
            actors.iter()
                .filter_map(|a| a.name.clone())
                .collect::<Vec<_>>()
                .join(", ")
        });
    
    let poster = nfo.thumb
        .and_then(|thumbs| {
            thumbs.iter()
                .find(|t| t.aspect.as_deref() == Some("poster"))
                .or_else(|| thumbs.first())
                .and_then(|t| t.value.clone())
        });
    
    let fanart = nfo.fanart
        .and_then(|fa| {
            fa.thumb
                .and_then(|thumbs| thumbs.first().and_then(|t| t.value.clone()))
        });
    
    Some(MovieMetadata {
        title: nfo.title.unwrap_or_else(|| "Unknown".to_string()),
        year: nfo.year,
        plot: nfo.plot,
        rating: nfo.rating,
        genres,
        director: nfo.director,
        actors,
        poster,
        fanart,
    })
}

pub fn scan_directory(path: &str) -> Vec<(PathBuf, Option<MovieMetadata>)> {
    let mut results = Vec::new();
    
    for entry in WalkDir::new(path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        
        if !is_video_file(path) {
            continue;
        }
        
        let metadata = find_nfo_for_video(path)
            .and_then(|nfo_path| parse_nfo_file(&nfo_path));
        
        results.push((path.to_path_buf(), metadata));
    }
    
    results
}

pub fn get_file_size(path: &Path) -> Option<i64> {
    fs::metadata(path).ok().map(|m| m.len() as i64)
}

pub fn extract_title_from_filename(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| {
            s.replace('.', " ")
                .replace('_', " ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_else(|| "Unknown".to_string())
}
