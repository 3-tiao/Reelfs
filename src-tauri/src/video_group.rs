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
