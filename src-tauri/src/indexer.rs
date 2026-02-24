use crate::models::MovieMetadata;
use quick_xml::de::from_str;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;
use log::{info, debug};

const VIDEO_EXTENSIONS: [&str; 8] = ["mkv", "mp4", "avi", "mov", "wmv", "flv", "webm", "m4v"];

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
        let is_video = VIDEO_EXTENSIONS.contains(&ext_str.as_str());
        debug!("[目录扫描] 文件类型检查: {:?} -> {}", path, is_video);
        is_video
    } else {
        debug!("[目录扫描] 无扩展名文件: {:?}", path);
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
    debug!("[文件解析] 开始解析NFO文件: {:?}", nfo_path);
    
    let content = fs::read_to_string(nfo_path).ok()?;
    
    let nfo: NfoMovie = from_str(&content).ok()?;
    
    debug!("[文件解析] NFO解析结果: title={:?}, year={:?}, rating={:?}", 
           nfo.title, nfo.year, nfo.rating);
    
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
    
    let metadata = MovieMetadata {
        title: nfo.title.unwrap_or_else(|| "Unknown".to_string()),
        year: nfo.year,
        plot: nfo.plot,
        rating: nfo.rating,
        genres,
        director: nfo.director,
        actors,
        poster,
        fanart,
    };
    
    info!("[文件解析] NFO解析完成: title={}, year={:?}", metadata.title, metadata.year);
    
    Some(metadata)
}

pub fn scan_directory(path: &str) -> Vec<(PathBuf, Option<MovieMetadata>)> {
    info!("[目录扫描] 开始扫描目标路径: {}", path);
    debug!("[目录扫描] 视频文件扩展名: {:?}", VIDEO_EXTENSIONS);
    
    let mut results = Vec::new();
    let mut video_count = 0;
    
    for entry in WalkDir::new(path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        
        if !is_video_file(path) {
            debug!("[目录扫描] 跳过非视频文件: {:?}", path);
            continue;
        }
        
        video_count += 1;
        info!("[目录扫描] 发现视频文件: {:?}", path);
        
        let mut metadata = find_nfo_for_video(path)
            .and_then(|nfo_path| {
                info!("[目录扫描] 找到NFO文件: {:?}", nfo_path);
                parse_nfo_file(&nfo_path)
            });
        
        // Auto-discover poster if not in NFO
        if let Some(ref mut meta) = metadata {
            if meta.poster.is_none() {
                meta.poster = find_poster_for_video(path);
            }
            if meta.fanart.is_none() {
                meta.fanart = find_fanart_for_video(path);
            }
        } else {
            // No NFO file, try to find poster anyway
            let poster = find_poster_for_video(path);
            let fanart = find_fanart_for_video(path);
            if poster.is_some() || fanart.is_some() {
                if metadata.is_none() {
                    metadata = Some(MovieMetadata {
                        title: extract_title_from_filename(path),
                        year: None,
                        plot: None,
                        rating: None,
                        genres: None,
                        director: None,
                        actors: None,
                        poster,
                        fanart,
                    });
                }
            }
        }
        
        results.push((path.to_path_buf(), metadata));
    }
    
    info!("[目录扫描] 扫描完成，共发现 {} 个视频文件", video_count);
    debug!("[目录扫描] 扫描结果: {:?}", results);
    
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

pub fn find_poster_for_video(video_path: &Path) -> Option<String> {
    let parent = video_path.parent()?;
    
    // Common poster filenames
    let poster_names = vec!["poster.jpg", "poster.png", "folder.jpg", "cover.jpg"];
    
    for name in poster_names {
        let poster_path = parent.join(name);
        if poster_path.exists() {
            return Some(poster_path.to_string_lossy().to_string());
        }
    }
    
    None
}

pub fn find_fanart_for_video(video_path: &Path) -> Option<String> {
    let parent = video_path.parent()?;
    
    // Common fanart filenames
    let fanart_names = vec!["fanart.jpg", "fanart.png", "backdrop.jpg", "background.jpg"];
    
    for name in fanart_names {
        let fanart_path = parent.join(name);
        if fanart_path.exists() {
            return Some(fanart_path.to_string_lossy().to_string());
        }
    }
    
    None
}

pub fn get_video_info(path: &Path) -> Option<(i64, i32, i32)> {
    info!("[视频信息] 尝试读取视频信息: {:?}", path);
    
    let extension = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    
    if extension == "mp4" || extension == "m4v" {
        info!("[视频信息] 使用 mp4 crate 读取: {:?}", path);
        if let Some(result) = get_video_info_mp4(path) {
            info!("[视频信息] mp4 crate 读取成功: duration={}, width={}, height={}", result.0, result.1, result.2);
            return Some(result);
        }
    }
    
    info!("[视频信息] 使用 ffprobe 读取: {:?}", path);
    if let Some(result) = get_video_info_ffprobe(path) {
        info!("[视频信息] ffprobe 读取成功: duration={}, width={}, height={}", result.0, result.1, result.2);
        return Some(result);
    }
    
    info!("[视频信息] 无法读取视频信息: {:?}", path);
    None
}

fn get_video_info_mp4(path: &Path) -> Option<(i64, i32, i32)> {
    use mp4::Mp4Reader;
    use std::fs::File;
    
    let f = File::open(path).ok()?;
    let size = f.metadata().ok()?.len();
    let reader = std::io::BufReader::new(f);
    let mp4 = Mp4Reader::read_header(reader, size).ok()?;
    
    let mut duration = 0i64;
    let mut width = 0i32;
    let mut height = 0i32;
    
    for track in mp4.tracks().values() {
        if track.track_type() == mp4::TrackType::Video {
            let track_duration = track.duration();
            let timescale = track.timescale();
            duration = (track_duration as f64 / timescale as f64) as i64;
            
            if let Some(avc1) = track.avc1_config() {
                width = avc1.width as i32;
                height = avc1.height as i32;
            }
        }
    }
    
    if duration > 0 && width > 0 && height > 0 {
        Some((duration, width, height))
    } else {
        None
    }
}

fn get_video_info_ffprobe(path: &Path) -> Option<(i64, i32, i32)> {
    let output = Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=duration,width,height")
        .arg("-of")
        .arg("csv=s=x:p=0")
        .arg(path)
        .output()
        .ok()?;
    
    if !output.status.success() {
        return None;
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.trim().split(',').collect();
    
    if parts.len() >= 3 {
        let duration = parts[0].parse::<f64>().ok()? as i64;
        let width = parts[1].parse::<i32>().ok()?;
        let height = parts[2].parse::<i32>().ok()?;
        Some((duration, width, height))
    } else {
        None
    }
}
