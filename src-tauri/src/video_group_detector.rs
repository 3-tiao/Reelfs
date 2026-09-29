use crate::models::Movie;
use log::info;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoGroupCandidate {
    pub title: String,
    pub movies: Vec<MovieWithPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovieWithPart {
    pub movie: Movie,
    pub part_number: i32,
    pub part_title: String,
}

pub fn detect_video_groups(movies: &[Movie]) -> Vec<VideoGroupCandidate> {
    info!("[视频组检测] 开始检测，共 {} 个电影", movies.len());
    let mut groups: HashMap<String, Vec<MovieWithPart>> = HashMap::new();

    let patterns = vec![
        r"(.+?)[\s\-_\.\[]([上中下])\s*[集部]?[\s\-_\.\]]?$",
        r"(.+?)[\s\-_\.]CD\s*(\d+)$",
        r"(.+?)[\s\-_\.]Part\s*(\d+)$",
        r"(.+?)[\s\-_\.]Disc\s*(\d+)$",
        r"(.+?)[\s\-_\.]EP?\s*(\d+)$",
        r"(.+?)[\s\-_\.\[]([上中下])\s*[集部]?[\s\-_\.\]]",
        r"(.+?)[\s\-_\.\[]CD\s*(\d+)[\s\-_\.\]]",
        r"(.+?)[\s\-_\.\[]Part\s*(\d+)[\s\-_\.\]]",
        r"(.+?)[\s\-_\.\[]Disc\s*(\d+)[\s\-_\.\]]",
        r"(.+?)[\s\-_\.\[]EP?\s*(\d+)[\s\-_\.\]]",
        r"(.+?)[\s\-_\.]第\s*(\d+)\s*[集部]$",
        r"(.+?)[\s\-_\[]第\s*(\d+)\s*[集部][\s\-_\]]",
        r"(.+?)[\s\-_\.](\d+)\s*\/\s*\d+",
    ];

    info!("[视频组检测] 使用 {} 个正则模式", patterns.len());

    for movie in movies {
        let file_name = std::path::Path::new(&movie.file_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&movie.title);

        info!(
            "[视频组检测] 检查电影: title='{}', file='{}'",
            movie.title, file_name
        );

        for (idx, pattern_str) in patterns.iter().enumerate() {
            if let Ok(re) = Regex::new(pattern_str) {
                if let Some(caps) = re.captures(file_name) {
                    if let Some(base_title) = caps.get(1) {
                        let base_title = clean_title(base_title.as_str());
                        let part_info = caps.get(2).map(|m| m.as_str()).unwrap_or("");

                        info!(
                            "[视频组检测] 模式[{}] 匹配成功: base='{}', part='{}'",
                            idx, base_title, part_info
                        );

                        let (part_number, part_title) = parse_part_info(part_info);

                        if part_number > 0 {
                            info!(
                                "[视频组检测] 电影 '{}' 匹配成功 -> 组 '{}', 第{}部分 ({})",
                                movie.title, base_title, part_number, part_title
                            );
                            let entry = groups.entry(base_title.clone()).or_default();
                            entry.push(MovieWithPart {
                                movie: movie.clone(),
                                part_number,
                                part_title,
                            });
                            break;
                        }
                    }
                }
            }
        }
    }

    info!("[视频组检测] 找到 {} 个候选组", groups.len());
    for (title, movies) in &groups {
        info!("[视频组检测] 候选组 '{}': {} 个视频", title, movies.len());
    }

    let mut result: Vec<VideoGroupCandidate> = groups
        .into_iter()
        .filter(|(_, movies)| movies.len() > 1)
        .map(|(title, mut movies)| {
            movies.sort_by_key(|m| m.part_number);
            VideoGroupCandidate { title, movies }
        })
        .collect();

    result.sort_by(|a, b| a.title.cmp(&b.title));

    info!("[视频组检测] 最终返回 {} 个有效视频组", result.len());
    result
}

fn parse_part_info(part_str: &str) -> (i32, String) {
    let part_str = part_str.trim();
    info!("[视频组检测] 解析部分信息: '{}'", part_str);

    if part_str.contains("上") {
        return (1, "上集".to_string());
    }
    if part_str.contains("中") {
        return (2, "中集".to_string());
    }
    if part_str.contains("下") {
        return (3, "下集".to_string());
    }

    if let Ok(num) = part_str.parse::<i32>() {
        let part_title = format!("第{}部分", num);
        info!(
            "[视频组检测] 解析结果(纯数字): num={}, title='{}'",
            num, part_title
        );
        return (num, part_title);
    }

    let cd_patterns = [
        (r"CD\s*(\d+)", "CD"),
        (r"Part\s*(\d+)", "Part"),
        (r"Disc\s*(\d+)", "Disc"),
        (r"(\d+)\s*\/\s*\d+", ""),
    ];

    for (pattern, prefix) in &cd_patterns {
        if let Ok(re) = Regex::new(pattern) {
            if let Some(caps) = re.captures(part_str) {
                if let Some(num_str) = caps.get(1) {
                    if let Ok(num) = num_str.as_str().parse::<i32>() {
                        let part_title = if prefix.is_empty() {
                            format!("第{}部分", num)
                        } else {
                            format!("{}{}", prefix, num)
                        };
                        info!("[视频组检测] 解析结果: num={}, title='{}'", num, part_title);
                        return (num, part_title);
                    }
                }
            }
        }
    }

    let episode_patterns = [r"第\s*(\d+)\s*集", r"第\s*(\d+)\s*部"];

    for pattern in &episode_patterns {
        if let Ok(re) = Regex::new(pattern) {
            if let Some(caps) = re.captures(part_str) {
                if let Some(num_str) = caps.get(1) {
                    if let Ok(num) = num_str.as_str().parse::<i32>() {
                        info!("[视频组检测] 解析结果(集): num={}", num);
                        return (num, format!("第{}集", num));
                    }
                }
            }
        }
    }

    info!("[视频组检测] 解析失败: '{}'", part_str);
    (0, part_str.to_string())
}

fn clean_title(title: &str) -> String {
    let title = title.trim();

    let suffixes_to_remove = ["-", "_", " ", "."];
    let mut cleaned = title.to_string();

    for suffix in &suffixes_to_remove {
        if cleaned.ends_with(suffix) {
            cleaned = cleaned[..cleaned.len() - suffix.len()].to_string();
        }
    }

    cleaned.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_groups() {
        let movies = vec![
            Movie {
                id: 1,
                file_path: "/path/to/电影名称 [上集].mp4".to_string(),
                title: "电影名称 [上集]".to_string(),
                year: None,
                plot: None,
                rating: None,
                genres: None,
                director: None,
                actors: None,
                thumbnail_path: None,
                file_size: None,
                duration_seconds: None,
                width: None,
                height: None,
                added_at: "".to_string(),
                updated_at: "".to_string(),
                last_accessed: None,
                last_checked_at: None,
                scan_state: None,
                is_watched: None,
                group_id: None,
                play_count: 0,
            },
            Movie {
                id: 2,
                file_path: "/path/to/电影名称 [下集].mp4".to_string(),
                title: "电影名称 [下集]".to_string(),
                year: None,
                plot: None,
                rating: None,
                genres: None,
                director: None,
                actors: None,
                thumbnail_path: None,
                file_size: None,
                duration_seconds: None,
                width: None,
                height: None,
                added_at: "".to_string(),
                updated_at: "".to_string(),
                last_accessed: None,
                last_checked_at: None,
                scan_state: None,
                is_watched: None,
                group_id: None,
                play_count: 0,
            },
        ];

        let groups = detect_video_groups(&movies);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].title, "电影名称");
        assert_eq!(groups[0].movies.len(), 2);
    }
}
