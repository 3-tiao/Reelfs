use rusqlite::{Connection, Result, params, OptionalExtension};
use crate::models::{VideoGroup, VideoPart, VideoGroupWithParts, VideoPartWithMovie, Movie};
use log::{info, debug};

pub struct VideoGroupManager<'a> {
    conn: &'a Connection,
}

impl<'a> VideoGroupManager<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

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
        debug!("[VideoGroup] 添加视频片段: group_id={}, movie_id={}, part_number={}", 
               group_id, movie_id, part_number);
        
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

    pub fn get_video_group(&self, id: i64) -> Result<Option<VideoGroup>> {
        debug!("[VideoGroup] 获取视频组: id={}", id);
        
        let mut stmt = self.conn.prepare(
            "SELECT id, title, year, plot, rating, genres, director, actors, poster_path, 
                    total_duration, part_count, created_at, updated_at
             FROM video_groups WHERE id = ?1"
        )?;
        
        let result = stmt.query_row(params![id], |row| {
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
        }).optional()?;
        
        Ok(result)
    }

    pub fn get_video_group_with_parts(&self, id: i64) -> Result<Option<VideoGroupWithParts>> {
        debug!("[VideoGroup] 获取视频组及片段: id={}", id);
        
        let group = self.get_video_group(id)?;
        
        if let Some(group) = group {
            let parts = self.get_video_parts(id)?;
            
            let mut parts_with_movies = Vec::new();
            for part in parts {
                let movie = self.get_movie(part.movie_id)?;
                if let Some(movie) = movie {
                    parts_with_movies.push(VideoPartWithMovie {
                        part,
                        movie,
                    });
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
             FROM video_parts WHERE group_id = ?1 ORDER BY part_number"
        )?;
        
        let parts = stmt.query_map(params![group_id], |row| {
            Ok(VideoPart {
                id: row.get(0)?,
                group_id: row.get(1)?,
                movie_id: row.get(2)?,
                part_number: row.get(3)?,
                part_title: row.get(4)?,
                duration_seconds: row.get(5)?,
            })
        })?.collect::<Result<Vec<_>>>()?;
        
        Ok(parts)
    }

    fn get_movie(&self, id: i64) -> Result<Option<Movie>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, file_path, title, year, plot, rating, genres, director, actors, 
                    thumbnail_path, file_size, duration_seconds,
                    width, height, added_at, updated_at, last_accessed, last_checked_at, scan_state, is_watched, group_id
             FROM movies WHERE id = ?1"
        )?;
        
        let result = stmt.query_row(params![id], |row| {
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
            })
        }).optional()?;
        
        Ok(result)
    }

    pub fn get_all_video_groups(&self, offset: i32, limit: i32) -> Result<Vec<VideoGroup>> {
        debug!("[VideoGroup] 获取视频组列表: offset={}, limit={}", offset, limit);
        
        let mut stmt = self.conn.prepare(
            "SELECT id, title, year, plot, rating, genres, director, actors, poster_path, 
                    total_duration, part_count, created_at, updated_at
             FROM video_groups ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
        )?;
        
        let groups = stmt.query_map(params![limit, offset], |row| {
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
        })?.collect::<Result<Vec<_>>>()?;
        
        Ok(groups)
    }

    pub fn delete_video_group(&self, id: i64) -> Result<()> {
        info!("[VideoGroup] 删除视频组: id={}", id);
        
        self.conn.execute(
            "UPDATE movies SET group_id = NULL WHERE id IN (SELECT movie_id FROM video_parts WHERE group_id = ?1)",
            params![id],
        )?;
        
        self.conn.execute(
            "DELETE FROM video_parts WHERE group_id = ?1",
            params![id],
        )?;
        
        self.conn.execute(
            "DELETE FROM video_groups WHERE id = ?1",
            params![id],
        )?;
        
        info!("[VideoGroup] 视频组删除成功: id={}", id);
        
        Ok(())
    }

    pub fn remove_video_part(&self, group_id: i64, part_id: i64) -> Result<()> {
        info!("[VideoGroup] 移除视频片段: group_id={}, part_id={}", group_id, part_id);
        
        let movie_id: i64 = self.conn.query_row(
            "SELECT movie_id FROM video_parts WHERE id = ?1",
            params![part_id],
            |row| row.get(0),
        )?;
        
        self.conn.execute(
            "UPDATE movies SET group_id = NULL WHERE id = ?1",
            params![movie_id],
        )?;
        
        self.conn.execute(
            "DELETE FROM video_parts WHERE id = ?1",
            params![part_id],
        )?;
        
        self.update_group_stats(group_id)?;
        
        info!("[VideoGroup] 视频片段移除成功");
        
        Ok(())
    }
}
