use crate::models::{Movie, VideoGroup, VideoGroupWithParts, VideoPart, VideoPartWithMovie};
use crate::video_group_detector::VideoGroupCandidate;
use log::{debug, error, info};
use rusqlite::{params, Connection, OptionalExtension, Result};

pub struct VideoGroupManager<'a> {
    conn: &'a Connection,
}

impl<'a> VideoGroupManager<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_video_group(
        &self,
        title: &str,
        year: Option<i32>,
        plot: Option<&str>,
        rating: Option<f64>,
        genres: Option<&str>,
        director: Option<&str>,
        actors: Option<&str>,
        poster_path: Option<&str>,
    ) -> Result<i64> {
        debug!("[VideoGroup] 创建视频组: title={}", title);

        self.conn.execute(
            "INSERT INTO video_groups (title, year, plot, rating, genres, director, actors, poster_path, part_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
            params![title, year, plot, rating, genres, director, actors, poster_path],
        )?;

        let id = self.conn.last_insert_rowid();
        info!("[VideoGroup] 视频组创建成功: id={}, title={}", id, title);

        Ok(id)
    }

    pub fn add_video_part(
        &self,
        group_id: i64,
        movie_id: i64,
        part_number: i32,
        part_title: Option<&str>,
    ) -> Result<i64> {
        debug!(
            "[VideoGroup] 添加视频片段: group_id={}, movie_id={}, part_number={}",
            group_id, movie_id, part_number
        );

        let duration: Option<i64> = self.conn.query_row(
            "SELECT duration_seconds FROM movies WHERE id = ?1",
            params![movie_id],
            |row| row.get(0),
        )?;

        self.conn.execute(
            "INSERT INTO video_parts (group_id, movie_id, part_number, part_title, duration_seconds)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![group_id, movie_id, part_number, part_title, duration],
        )?;

        self.conn.execute(
            "UPDATE movies SET group_id = ?1 WHERE id = ?2",
            params![group_id, movie_id],
        )?;

        let part_id = self.conn.last_insert_rowid();

        self.update_group_stats(group_id)?;

        info!("[VideoGroup] 视频片段添加成功: part_id={}", part_id);

        Ok(part_id)
    }

    pub fn create_video_groups_batch(&self, candidates: &[VideoGroupCandidate]) -> Result<usize> {
        info!(
            "[VideoGroup] 开始批量创建视频组: {} 个候选",
            candidates.len()
        );
        if candidates.is_empty() {
            return Ok(0);
        }

        let tx = self.conn.unchecked_transaction()?;
        let mut created_count = 0;

        for candidate in candidates {
            if let Err(e) = tx.execute(
                "INSERT INTO video_groups (title, year, plot, rating, genres, director, actors, poster_path, part_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
                params![candidate.title, rusqlite::types::Null, rusqlite::types::Null, rusqlite::types::Null, rusqlite::types::Null, rusqlite::types::Null, rusqlite::types::Null, rusqlite::types::Null],
            ) {
                error!("[VideoGroup] 批量插入视频组失败 {}: {}", candidate.title, e);
                continue;
            }

            let group_id = tx.last_insert_rowid();
            created_count += 1;

            let mut total_duration = 0;
            let mut part_count = 0;

            for movie_with_part in &candidate.movies {
                let movie_id = movie_with_part.movie.id;

                // Fetch duration
                let duration: Option<i64> = tx
                    .query_row(
                        "SELECT duration_seconds FROM movies WHERE id = ?1",
                        params![movie_id],
                        |row| row.get(0),
                    )
                    .unwrap_or(None);

                if let Some(d) = duration {
                    total_duration += d;
                }
                part_count += 1;

                if let Err(e) = tx.execute(
                    "INSERT INTO video_parts (group_id, movie_id, part_number, part_title, duration_seconds)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![group_id, movie_id, movie_with_part.part_number, movie_with_part.part_title, duration],
                ) {
                    error!("[VideoGroup] 批量插入视频片段失败 movie_id={}: {}", movie_id, e);
                    continue;
                }

                // Update movie group_id
                let _ = tx.execute(
                    "UPDATE movies SET group_id = ?1 WHERE id = ?2 AND group_id IS NULL",
                    params![group_id, movie_id],
                );
            }

            // Update stats
            let _ = tx.execute(
                "UPDATE video_groups SET total_duration = ?1, part_count = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
                params![total_duration, part_count, group_id],
            );
        }

        tx.commit()?;
        info!("[VideoGroup] 批量创建视频组成功: {} 个", created_count);
        Ok(created_count)
    }

    fn update_group_stats(&self, group_id: i64) -> Result<()> {
        debug!("[VideoGroup] 更新视频组统计信息: group_id={}", group_id);

        let total_duration: Option<i64> = self.conn.query_row(
            "SELECT SUM(vp.duration_seconds) 
             FROM video_parts vp 
             WHERE vp.group_id = ?1",
            params![group_id],
            |row| row.get(0),
        )?;

        let part_count: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM video_parts WHERE group_id = ?1",
            params![group_id],
            |row| row.get(0),
        )?;

        self.conn.execute(
            "UPDATE video_groups SET total_duration = ?1, part_count = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
            params![total_duration, part_count, group_id],
        )?;

        Ok(())
    }

    /// Sets the user's rating for the whole collection. Individual part ratings remain unchanged.
    pub fn set_video_group_rating(&self, group_id: i64, rating: Option<f64>) -> Result<()> {
        let rating = rating.filter(|value| (0.0..=5.0).contains(value));
        info!(
            "[VideoGroup] 设置合集评分: group_id={}, rating={:?}",
            group_id, rating
        );

        self.conn.execute(
            "UPDATE video_groups SET rating = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![rating, group_id],
        )?;

        Ok(())
    }

    pub fn get_video_group(&self, id: i64) -> Result<Option<VideoGroup>> {
        debug!("[VideoGroup] 获取视频组: id={}", id);

        let mut stmt = self.conn.prepare(
            "SELECT id, title, year, plot, rating, genres, director, actors, poster_path, 
                    total_duration, part_count, created_at, updated_at
             FROM video_groups WHERE id = ?1",
        )?;

        let result = stmt
            .query_row(params![id], |row| {
                Ok(VideoGroup {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    year: row.get(2)?,
                    plot: row.get(3)?,
                    rating: row.get(4)?,
                    genres: row.get(5)?,
                    director: row.get(6)?,
                    actors: row.get(7)?,
                    poster_path: row.get(8)?,
                    total_duration: row.get(9)?,
                    part_count: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            })
            .optional()?;

        Ok(result)
    }

    pub fn get_video_group_with_parts(&self, id: i64) -> Result<Option<VideoGroupWithParts>> {
        debug!("[VideoGroup] 获取视频组及片段: id={}", id);

        let group = self.get_video_group(id)?;

        if let Some(group) = group {
            let parts = self.get_video_parts(id)?;

            if parts.is_empty() {
                return Ok(Some(VideoGroupWithParts {
                    group,
                    parts: Vec::new(),
                }));
            }

            let movie_ids: Vec<String> = parts.iter().map(|p| p.movie_id.to_string()).collect();
            let placeholders = movie_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let query = format!(
                "SELECT m.id, m.file_path, m.title, m.year, m.plot, m.rating, m.genres, m.director, m.actors,
                        m.thumbnail_path, m.file_size, m.duration_seconds,
                        m.width, m.height, m.added_at, m.updated_at, m.last_accessed, m.last_checked_at, m.scan_state, m.is_watched, m.group_id,
                        COALESCE(ph.play_count, 0) as play_count
                 FROM movies m
                 LEFT JOIN play_history ph ON ph.movie_id = m.id
                 WHERE m.id IN ({})",
                placeholders
            );

            let mut stmt = self.conn.prepare(&query)?;
            let movie_id_params: Vec<&dyn rusqlite::ToSql> = movie_ids
                .iter()
                .map(|id| id as &dyn rusqlite::ToSql)
                .collect();

            // Map fetched movies by their ID for O(1) assignment
            let mut movies_map: std::collections::HashMap<i64, Movie> =
                std::collections::HashMap::new();
            let rows = stmt.query_map(rusqlite::params_from_iter(movie_id_params), |row| {
                Ok(Movie {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    title: row.get(2)?,
                    year: row.get(3)?,
                    plot: row.get(4)?,
                    rating: row.get(5)?,
                    genres: row.get(6)?,
                    director: row.get(7)?,
                    actors: row.get(8)?,
                    thumbnail_path: row.get(9)?,
                    file_size: row.get(10)?,
                    duration_seconds: row.get(11)?,
                    width: row.get(12)?,
                    height: row.get(13)?,
                    added_at: row.get(14)?,
                    updated_at: row.get(15)?,
                    last_accessed: row.get(16)?,
                    last_checked_at: row.get(17)?,
                    scan_state: row.get(18)?,
                    is_watched: row.get(19)?,
                    group_id: row.get(20)?,
                    play_count: row.get(21)?,
                })
            })?;

            for movie in rows.flatten() {
                movies_map.insert(movie.id, movie);
            }

            let mut parts_with_movies = Vec::with_capacity(parts.len());
            for part in parts {
                if let Some(movie) = movies_map.get(&part.movie_id).cloned() {
                    parts_with_movies.push(VideoPartWithMovie { part, movie });
                }
            }

            Ok(Some(VideoGroupWithParts {
                group,
                parts: parts_with_movies,
            }))
        } else {
            Ok(None)
        }
    }

    fn get_video_parts(&self, group_id: i64) -> Result<Vec<VideoPart>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, group_id, movie_id, part_number, part_title, duration_seconds
             FROM video_parts WHERE group_id = ?1 ORDER BY part_number",
        )?;

        let parts = stmt
            .query_map(params![group_id], |row| {
                Ok(VideoPart {
                    id: row.get(0)?,
                    group_id: row.get(1)?,
                    movie_id: row.get(2)?,
                    part_number: row.get(3)?,
                    part_title: row.get(4)?,
                    duration_seconds: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(parts)
    }

    pub fn get_all_video_groups(&self, offset: i32, limit: i32) -> Result<Vec<VideoGroup>> {
        debug!(
            "[VideoGroup] 获取视频组列表: offset={}, limit={}",
            offset, limit
        );

        let mut stmt = self.conn.prepare(
            "SELECT id, title, year, plot, rating, genres, director, actors, poster_path, 
                    total_duration, part_count, created_at, updated_at
             FROM video_groups ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
        )?;

        let groups = stmt
            .query_map(params![limit, offset], |row| {
                Ok(VideoGroup {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    year: row.get(2)?,
                    plot: row.get(3)?,
                    rating: row.get(4)?,
                    genres: row.get(5)?,
                    director: row.get(6)?,
                    actors: row.get(7)?,
                    poster_path: row.get(8)?,
                    total_duration: row.get(9)?,
                    part_count: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(groups)
    }

    pub fn delete_video_group(&self, id: i64) -> Result<()> {
        info!("[VideoGroup] 删除视频组: id={}", id);

        self.conn.execute(
            "UPDATE movies SET group_id = NULL WHERE id IN (SELECT movie_id FROM video_parts WHERE group_id = ?1)",
            params![id],
        )?;

        self.conn
            .execute("DELETE FROM video_parts WHERE group_id = ?1", params![id])?;

        self.conn
            .execute("DELETE FROM video_groups WHERE id = ?1", params![id])?;

        info!("[VideoGroup] 视频组删除成功: id={}", id);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::video_group_detector::{MovieWithPart, VideoGroupCandidate};

    /// In-memory database with the full schema + migrations, so tests never
    /// touch the developer's real files.
    fn mem_db() -> Database {
        Database::new(":memory:").unwrap()
    }

    fn insert_movie(conn: &Connection, path: &str, title: &str, duration: Option<i64>) -> i64 {
        conn.execute(
            "INSERT INTO movies (file_path, title, duration_seconds) VALUES (?1, ?2, ?3)",
            params![path, title, duration],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn candidate(title: &str, parts: &[(i64, i32, &str)]) -> VideoGroupCandidate {
        VideoGroupCandidate {
            title: title.to_string(),
            movies: parts
                .iter()
                .map(|(movie_id, part_number, part_title)| MovieWithPart {
                    movie: crate::models::Movie {
                        id: *movie_id,
                        file_path: String::new(),
                        title: String::new(),
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
                        added_at: String::new(),
                        updated_at: String::new(),
                        last_accessed: None,
                        last_checked_at: None,
                        scan_state: None,
                        is_watched: None,
                        group_id: None,
                        play_count: 0,
                    },
                    part_number: *part_number,
                    part_title: part_title.to_string(),
                })
                .collect(),
        }
    }

    fn group_rating(conn: &Connection, group_id: i64) -> Option<f64> {
        conn.query_row(
            "SELECT rating FROM video_groups WHERE id = ?1",
            params![group_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn batch_create_sets_membership_parts_and_stats() {
        let db = mem_db();
        let conn = db.get_connection();
        let id1 = insert_movie(conn, "/nas/p1.mkv", "Part 1", Some(100));
        let id2 = insert_movie(conn, "/nas/p2.mkv", "Part 2", Some(200));

        let created = VideoGroupManager::new(conn)
            .create_video_groups_batch(&[candidate(
                "Trilogy",
                &[(id1, 1, "上集"), (id2, 2, "下集")],
            )])
            .unwrap();

        assert_eq!(created, 1);

        let (total_duration, part_count): (Option<i64>, i32) = conn
            .query_row(
                "SELECT total_duration, part_count FROM video_groups WHERE title = 'Trilogy'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(total_duration, Some(300), "stats must sum part durations");
        assert_eq!(part_count, 2);

        let grouped: Vec<i64> = {
            let mut stmt = conn
                .prepare("SELECT id FROM movies WHERE group_id IS NOT NULL ORDER BY id")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(grouped, vec![id1, id2], "both movies must join the group");

        let parts: Vec<i32> = {
            let mut stmt = conn
                .prepare("SELECT part_number FROM video_parts ORDER BY part_number")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(parts, vec![1, 2]);
    }

    #[test]
    fn batch_create_does_not_steal_already_grouped_movies() {
        let db = mem_db();
        let conn = db.get_connection();
        let manager = VideoGroupManager::new(conn);

        let id1 = insert_movie(conn, "/nas/a1.mkv", "A1", Some(50));
        let id2 = insert_movie(conn, "/nas/b1.mkv", "B1", Some(60));

        let first = manager
            .create_video_groups_batch(&[candidate("First Group", &[(id1, 1, "上集")])])
            .unwrap();
        assert_eq!(first, 1);
        let original_group: i64 = conn
            .query_row(
                "SELECT group_id FROM movies WHERE id = ?1",
                params![id1],
                |row| row.get(0),
            )
            .unwrap();

        // Re-running detection must not reassign a movie that already has a group
        // — the UPDATE carries 'AND group_id IS NULL'.
        let second = manager
            .create_video_groups_batch(&[candidate(
                "Second Group",
                &[(id1, 1, "上集"), (id2, 2, "下集")],
            )])
            .unwrap();
        assert_eq!(second, 1);

        let now_grouped: i64 = conn
            .query_row(
                "SELECT group_id FROM movies WHERE id = ?1",
                params![id1],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            now_grouped, original_group,
            "a grouped movie must keep its original group on re-detection"
        );

        // The ungrouped movie from the same batch still got assigned.
        let id2_group: i64 = conn
            .query_row(
                "SELECT group_id FROM movies WHERE id = ?1",
                params![id2],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(id2_group, original_group);
    }

    #[test]
    fn batch_create_with_empty_candidates_is_a_noop() {
        let db = mem_db();
        let conn = db.get_connection();
        let created = VideoGroupManager::new(conn)
            .create_video_groups_batch(&[])
            .unwrap();
        assert_eq!(created, 0);
        let groups: i64 = conn
            .query_row("SELECT COUNT(*) FROM video_groups", [], |row| row.get(0))
            .unwrap();
        assert_eq!(groups, 0);
    }

    #[test]
    fn add_video_part_updates_group_stats() {
        let db = mem_db();
        let conn = db.get_connection();
        let manager = VideoGroupManager::new(conn);

        let m1 = insert_movie(conn, "/nas/s1.mkv", "S1", Some(90));
        let m2 = insert_movie(conn, "/nas/s2.mkv", "S2", Some(110));
        let group_id = manager
            .create_video_group("Show", None, None, None, None, None, None, None)
            .unwrap();

        manager
            .add_video_part(group_id, m1, 1, Some("上集"))
            .unwrap();
        manager
            .add_video_part(group_id, m2, 2, Some("下集"))
            .unwrap();

        let (total_duration, part_count): (Option<i64>, i32) = conn
            .query_row(
                "SELECT total_duration, part_count FROM video_groups WHERE id = ?1",
                params![group_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(total_duration, Some(200));
        assert_eq!(part_count, 2);
    }

    #[test]
    fn set_video_group_rating_clamps_out_of_range_to_null() {
        let db = mem_db();
        let conn = db.get_connection();
        let manager = VideoGroupManager::new(conn);
        let group_id = manager
            .create_video_group("Rated", None, None, None, None, None, None, None)
            .unwrap();

        manager.set_video_group_rating(group_id, Some(4.5)).unwrap();
        assert_eq!(group_rating(conn, group_id), Some(4.5));

        manager.set_video_group_rating(group_id, Some(0.0)).unwrap();
        assert_eq!(
            group_rating(conn, group_id),
            Some(0.0),
            "0 is a legal rating"
        );

        manager.set_video_group_rating(group_id, Some(5.0)).unwrap();
        assert_eq!(
            group_rating(conn, group_id),
            Some(5.0),
            "5 is a legal rating"
        );

        manager.set_video_group_rating(group_id, Some(5.5)).unwrap();
        assert_eq!(
            group_rating(conn, group_id),
            None,
            "above 5 must be rejected (stored as NULL)"
        );

        manager
            .set_video_group_rating(group_id, Some(-0.1))
            .unwrap();
        assert_eq!(
            group_rating(conn, group_id),
            None,
            "below 0 must be rejected (stored as NULL)"
        );

        manager.set_video_group_rating(group_id, None).unwrap();
        assert_eq!(group_rating(conn, group_id), None);
    }

    #[test]
    fn get_video_group_with_parts_returns_parts_sorted_by_part_number() {
        let db = mem_db();
        let conn = db.get_connection();
        let manager = VideoGroupManager::new(conn);

        let m1 = insert_movie(conn, "/nas/x1.mkv", "X1", Some(10));
        let m2 = insert_movie(conn, "/nas/x2.mkv", "X2", Some(20));
        let m3 = insert_movie(conn, "/nas/x3.mkv", "X3", Some(30));
        let group_id = manager
            .create_video_group("Saga", None, None, None, None, None, None, None)
            .unwrap();

        // Insert deliberately out of order.
        manager
            .add_video_part(group_id, m2, 2, Some("中集"))
            .unwrap();
        manager
            .add_video_part(group_id, m3, 3, Some("下集"))
            .unwrap();
        manager
            .add_video_part(group_id, m1, 1, Some("上集"))
            .unwrap();

        let with_parts = manager
            .get_video_group_with_parts(group_id)
            .unwrap()
            .expect("group must exist");

        assert_eq!(with_parts.group.id, group_id);
        assert_eq!(with_parts.group.title, "Saga");
        let numbers: Vec<i32> = with_parts
            .parts
            .iter()
            .map(|p| p.part.part_number)
            .collect();
        assert_eq!(
            numbers,
            vec![1, 2, 3],
            "parts must come back ordered by part_number"
        );
        let titles: Vec<&str> = with_parts
            .parts
            .iter()
            .map(|p| p.movie.title.as_str())
            .collect();
        assert_eq!(
            titles,
            vec!["X1", "X2", "X3"],
            "each part must carry its movie"
        );
    }

    #[test]
    fn get_video_group_with_parts_returns_none_for_missing_group() {
        let db = mem_db();
        let conn = db.get_connection();
        let result = VideoGroupManager::new(conn)
            .get_video_group_with_parts(999)
            .unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn delete_video_group_removes_parts_and_ungroups_movies() {
        let db = mem_db();
        let conn = db.get_connection();
        let manager = VideoGroupManager::new(conn);

        let m1 = insert_movie(conn, "/nas/d1.mkv", "D1", Some(10));
        let group_id = manager
            .create_video_group("Doomed", None, None, None, None, None, None, None)
            .unwrap();
        manager
            .add_video_part(group_id, m1, 1, Some("上集"))
            .unwrap();

        manager.delete_video_group(group_id).unwrap();

        let groups: i64 = conn
            .query_row("SELECT COUNT(*) FROM video_groups", [], |row| row.get(0))
            .unwrap();
        let parts: i64 = conn
            .query_row("SELECT COUNT(*) FROM video_parts", [], |row| row.get(0))
            .unwrap();
        let orphaned: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM movies WHERE group_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((groups, parts, orphaned), (0, 0, 0));
    }
}
