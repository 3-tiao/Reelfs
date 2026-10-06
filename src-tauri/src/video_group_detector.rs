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

    fn movie(id: i64, file_name: &str) -> Movie {
        Movie {
            id,
            file_path: format!("/nas/{}.mkv", file_name),
            title: file_name.to_string(),
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
        }
    }

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

    #[test]
    fn parse_part_info_maps_position_words() {
        assert_eq!(parse_part_info("上"), (1, "上集".to_string()));
        assert_eq!(parse_part_info("中"), (2, "中集".to_string()));
        assert_eq!(parse_part_info("下"), (3, "下集".to_string()));
        // "contains" semantics: 上 embedded in a longer token still maps to 1.
        assert_eq!(parse_part_info("上集"), (1, "上集".to_string()));
    }

    #[test]
    fn parse_part_info_parses_plain_numbers() {
        assert_eq!(parse_part_info("1"), (1, "第1部分".to_string()));
        assert_eq!(parse_part_info("12"), (12, "第12部分".to_string()));
        assert_eq!(parse_part_info(" 3 "), (3, "第3部分".to_string()));
    }

    #[test]
    fn parse_part_info_parses_prefixed_numbers() {
        assert_eq!(parse_part_info("CD2"), (2, "CD2".to_string()));
        assert_eq!(parse_part_info("CD 2"), (2, "CD2".to_string()));
        assert_eq!(parse_part_info("Part3"), (3, "Part3".to_string()));
        assert_eq!(parse_part_info("Disc4"), (4, "Disc4".to_string()));
    }

    #[test]
    fn parse_part_info_parses_fraction_denominator_pattern() {
        // N/M form: numerator becomes the part number.
        assert_eq!(parse_part_info("1/2"), (1, "第1部分".to_string()));
        assert_eq!(parse_part_info("2 / 3"), (2, "第2部分".to_string()));
    }

    #[test]
    fn parse_part_info_parses_episode_markers() {
        assert_eq!(parse_part_info("第5集"), (5, "第5集".to_string()));
        // "第N部" currently normalizes into the 集 wording — pins present behavior.
        assert_eq!(parse_part_info("第6部"), (6, "第6集".to_string()));
    }

    #[test]
    fn parse_part_info_returns_zero_on_unparseable_input() {
        // part_number == 0 makes detect_video_groups skip the match entirely.
        assert_eq!(parse_part_info("abc"), (0, "abc".to_string()));
        assert_eq!(parse_part_info(""), (0, "".to_string()));
        assert_eq!(parse_part_info("X1Y"), (0, "X1Y".to_string()));
    }

    #[test]
    fn clean_title_trims_trailing_separators() {
        assert_eq!(clean_title("Movie -"), "Movie");
        assert_eq!(clean_title("Movie_"), "Movie");
        assert_eq!(clean_title("Movie."), "Movie");
        assert_eq!(clean_title("Movie "), "Movie");
        assert_eq!(clean_title("Movie"), "Movie");
        assert_eq!(clean_title("  Movie  "), "Movie");
    }

    #[test]
    fn single_match_is_not_a_group() {
        let movies = vec![movie(1, "Lonely CD1"), movie(2, "Totally Different")];
        assert!(
            detect_video_groups(&movies).is_empty(),
            "one member matching a pattern must not produce a group"
        );
    }

    #[test]
    fn cd_and_disc_patterns_group() {
        let movies = vec![
            movie(1, "Concert CD1"),
            movie(2, "Concert CD2"),
            movie(3, "BTS Disc1"),
            movie(4, "BTS Disc2"),
        ];

        let groups = detect_video_groups(&movies);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].title, "BTS");
        assert_eq!(groups[0].movies.len(), 2);
        assert_eq!(groups[1].title, "Concert");
        assert_eq!(groups[1].movies.len(), 2);
    }

    #[test]
    fn fraction_pattern_needs_a_slash_inside_the_stem() {
        // detect_video_groups matches against Path::file_stem(), and a Unix
        // filename can never contain '/'. So the N/M pattern (pattern 13) can
        // only fire on stems that literally embed a slash, which real macOS /
        // Linux paths never produce — an integration case is impossible here.
        // The parse-level behaviour of that pattern is pinned separately in
        // parse_part_info_parses_fraction_denominator_pattern. This test
        // documents the reachable reality: "1 of 2" style names do NOT group.
        let movies = vec![movie(1, "Ep 1 of 2"), movie(2, "Ep 2 of 2")];
        assert!(detect_video_groups(&movies).is_empty());
    }

    #[test]
    fn episode_marker_pattern_groups() {
        let movies = vec![movie(1, "连续剧 第1集"), movie(2, "连续剧 第2集")];

        let groups = detect_video_groups(&movies);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].title, "连续剧");
        let parts: Vec<i32> = groups[0].movies.iter().map(|m| m.part_number).collect();
        assert_eq!(parts, vec![1, 2]);
    }

    #[test]
    fn parts_are_sorted_by_part_number_not_input_order() {
        let movies = vec![movie(1, "电影名称 [下集]"), movie(2, "电影名称 [上集]")];

        let groups = detect_video_groups(&movies);
        assert_eq!(groups.len(), 1);
        let parts: Vec<i32> = groups[0].movies.iter().map(|m| m.part_number).collect();
        assert_eq!(
            parts,
            vec![1, 3],
            "上(1) must sort before 下(3) regardless of input order"
        );
        assert_eq!(groups[0].movies[0].part_title, "上集");
        assert_eq!(groups[0].movies[1].part_title, "下集");
    }

    #[test]
    fn groups_are_sorted_by_title() {
        let movies = vec![
            movie(1, "Zeta CD1"),
            movie(2, "Zeta CD2"),
            movie(3, "Alpha CD1"),
            movie(4, "Alpha CD2"),
        ];

        let groups = detect_video_groups(&movies);
        let titles: Vec<&str> = groups.iter().map(|g| g.title.as_str()).collect();
        assert_eq!(titles, vec!["Alpha", "Zeta"]);
    }

    #[test]
    fn different_base_titles_do_not_merge() {
        let movies = vec![movie(1, "MovieA CD1"), movie(2, "MovieB CD2")];
        assert!(detect_video_groups(&movies).is_empty());
    }
}
