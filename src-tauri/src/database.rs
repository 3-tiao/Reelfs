use rusqlite::{Connection, Result, params};
use std::path::Path;
use crate::models::{Movie, PlayHistory};
use log::{info, debug, error};

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(db_path: &str) -> Result<Self> {
        info!("[数据库] 初始化数据库: {}", db_path);
        
        if let Some(parent) = Path::new(db_path).parent() {
            debug!("[数据库] 创建数据库目录: {:?}", parent);
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(db_path)?;
        let db = Database { conn };
        db.init_schema()?;
        
        info!("[数据库] 数据库初始化成功: {}", db_path);
        
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        debug!("[数据库] 初始化数据库表结构");
        
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS movies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                year INTEGER,
                plot TEXT,
                rating REAL,
                genres TEXT,
                director TEXT,
                actors TEXT,
                thumbnail_path TEXT,
                file_size INTEGER,
                duration_seconds INTEGER,
                width INTEGER,
                height INTEGER,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_accessed DATETIME
            );

            CREATE TABLE IF NOT EXISTS play_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                movie_id INTEGER NOT NULL,
                last_position REAL DEFAULT 0,
                last_played DATETIME DEFAULT CURRENT_TIMESTAMP,
                play_count INTEGER DEFAULT 1,
                FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_title ON movies(title);
            CREATE INDEX IF NOT EXISTS idx_year ON movies(year);
            CREATE INDEX IF NOT EXISTS idx_added_at ON movies(added_at DESC);
            CREATE INDEX IF NOT EXISTS idx_rating ON movies(rating);
            CREATE INDEX IF NOT EXISTS idx_last_accessed ON movies(last_accessed DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_file_path ON movies(file_path);

            CREATE VIRTUAL TABLE IF NOT EXISTS movie_fts USING fts5(
                title, 
                plot, 
                actors, 
                director,
                content=movies,
                content_rowid=id,
                tokenize='unicode61'
            );

            CREATE TRIGGER IF NOT EXISTS movies_ai AFTER INSERT ON movies BEGIN
                INSERT INTO movie_fts(rowid, title, plot, actors, director)
                VALUES (new.id, new.title, new.plot, new.actors, new.director);
            END;

            CREATE TRIGGER IF NOT EXISTS movies_ad AFTER DELETE ON movies BEGIN
                DELETE FROM movie_fts WHERE rowid = old.id;
            END;

            CREATE TRIGGER IF NOT EXISTS movies_au AFTER UPDATE ON movies BEGIN
                UPDATE movie_fts SET 
                    title = new.title,
                    plot = new.plot,
                    actors = new.actors,
                    director = new.director
                WHERE rowid = new.id;
            END;
            "
        )?;
        
        debug!("[数据库] 数据库表结构初始化完成");
        
        self.migrate_database()?;
        
        Ok(())
    }
    
    fn migrate_database(&self) -> Result<()> {
        info!("[数据库] 检查并应用数据库迁移");
        
        let tx = self.conn.unchecked_transaction()?;
        
        let has_width = tx.prepare(
            "SELECT 1 FROM pragma_table_info('movies') WHERE name = 'width'"
        )?.exists([])?;
        
        let has_height = tx.prepare(
            "SELECT 1 FROM pragma_table_info('movies') WHERE name = 'height'"
        )?.exists([])?;
        
        let has_last_checked_at = tx.prepare(
            "SELECT 1 FROM pragma_table_info('movies') WHERE name = 'last_checked_at'"
        )?.exists([])?;
        
        let has_scan_state = tx.prepare(
            "SELECT 1 FROM pragma_table_info('movies') WHERE name = 'scan_state'"
        )?.exists([])?;
        
        if !has_width {
            info!("[数据库] 添加 width 列");
            tx.execute("ALTER TABLE movies ADD COLUMN width INTEGER", [])?;
        }
        
        if !has_height {
            info!("[数据库] 添加 height 列");
            tx.execute("ALTER TABLE movies ADD COLUMN height INTEGER", [])?;
        }
        
        if !has_last_checked_at {
            info!("[数据库] 添加 last_checked_at 列");
            tx.execute("ALTER TABLE movies ADD COLUMN last_checked_at DATETIME", [])?;
        }
        
        if !has_scan_state {
            info!("[数据库] 添加 scan_state 列");
            tx.execute("ALTER TABLE movies ADD COLUMN scan_state TEXT", [])?;
        }
        
        let has_is_watched = tx.prepare(
            "SELECT 1 FROM pragma_table_info('movies') WHERE name = 'is_watched'"
        )?.exists([])?;
        
        if !has_is_watched {
            info!("[数据库] 添加 is_watched 列");
            tx.execute("ALTER TABLE movies ADD COLUMN is_watched INTEGER DEFAULT 0", [])?;
        }
        
        tx.commit()?;
        
        info!("[数据库] 数据库迁移完成");
        
        Ok(())
    }

    pub fn insert_movie(&self, file_path: &str, title: &str, year: Option<i32>, 
                       plot: Option<&str>, rating: Option<f64>, genres: Option<&str>,
                       director: Option<&str>, actors: Option<&str>,
                       file_size: Option<i64>, duration_seconds: Option<i64>,
                       width: Option<i32>, height: Option<i32>) -> Result<i64> {
        debug!("[数据库] 插入电影: title={}, file_path={}", title, file_path);
        
        self.conn.execute(
            "INSERT INTO movies (file_path, title, year, plot, rating, genres, director, actors, file_size, duration_seconds, width, height, last_checked_at, scan_state)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![file_path, title, year, plot, rating, genres, director, actors, file_size, duration_seconds, width, height, "checked", "checked"],
        )?;
        
        let id = self.conn.last_insert_rowid();
        info!("[数据库] 电影插入成功: id={}, title={}", id, title);
        
        Ok(id)
    }

    pub fn batch_insert_movies(&self, movies: &[(String, String, Option<i32>, Option<String>, Option<f64>, Option<String>, Option<String>, Option<String>, Option<i64>, Option<i64>, Option<i32>, Option<i32>)]) -> Result<usize> {
        let start_time = std::time::Instant::now();
        debug!("[数据库] 开始批量插入/更新: {} 条记录", movies.len());
        
        let tx = self.conn.unchecked_transaction()?;
        let mut count = 0;
        
        for movie in movies {
            let result = tx.execute(
                "INSERT OR REPLACE INTO movies (file_path, title, year, plot, rating, genres, director, actors, file_size, duration_seconds, width, height, last_checked_at, scan_state)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    &movie.0, &movie.1, movie.2, &movie.3, movie.4, 
                    &movie.5, &movie.6, &movie.7,
                    movie.8, movie.9, movie.10, movie.11, "checked", "checked"
                ],
            );
            if result.is_ok() {
                count += 1;
            }
        }
        
        tx.commit()?;
        
        let elapsed = start_time.elapsed();
        info!("[数据库] 批量插入/更新完成: {}/{} 条，耗时: {}ms", count, movies.len(), elapsed.as_millis());
        
        Ok(count)
    }

    pub fn get_movies(&self, offset: i32, limit: i32) -> Result<Vec<Movie>> {
        debug!("[数据库] 获取电影列表: offset={}, limit={}", offset, limit);
        
        let mut stmt = self.conn.prepare(
            "SELECT id, file_path, title, year, plot, rating, genres, director, actors, 
                    thumbnail_path, file_size, duration_seconds,
                    width, height, added_at, updated_at, last_accessed, last_checked_at, scan_state, is_watched
             FROM movies ORDER BY added_at DESC LIMIT ?1 OFFSET ?2"
        )?;

        let movies = stmt.query_map(params![limit, offset], |row| {
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
            })
        })?;

        movies.collect()
    }

    pub fn get_movie_by_id(&self, id: i64) -> Result<Movie> {
        debug!("[数据库] 获取电影详情: id={}", id);
        
        let movie = self.conn.query_row(
            "SELECT id, file_path, title, year, plot, rating, genres, director, actors, 
                    thumbnail_path, file_size, duration_seconds,
                    width, height, added_at, updated_at, last_accessed, last_checked_at, scan_state, is_watched
             FROM movies WHERE id = ?1",
            params![id],
            |row| {
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
                })
            }
        );
        
        match &movie {
            Ok(m) => debug!("[数据库] 电影查询成功: id={}, title={}", m.id, m.title),
            Err(e) => debug!("[数据库] 电影查询失败: {}", e),
        }
        
        movie
    }

    pub fn get_movie_by_path(&self, file_path: &str) -> Result<Option<Movie>> {
        debug!("[数据库] 根据路径获取电影: file_path={}", file_path);
        
        let movie = self.conn.query_row(
            "SELECT id, file_path, title, year, plot, rating, genres, director, actors, 
                    thumbnail_path, file_size, duration_seconds,
                    width, height, added_at, updated_at, last_accessed, last_checked_at, scan_state, is_watched
             FROM movies WHERE file_path = ?1",
            params![file_path],
            |row| {
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
                })
            }
        );
        
        match movie {
            Ok(m) => {
                debug!("[数据库] 电影查询成功: id={}, title={}", m.id, m.title);
                Ok(Some(m))
            },
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                debug!("[数据库] 电影不存在: {}", file_path);
                Ok(None)
            },
            Err(e) => {
                debug!("[数据库] 电影查询失败: {}", e);
                Err(e)
            }
        }
    }

    pub fn search_movies(&self, query: &str) -> Result<Vec<Movie>> {
        debug!("[数据库] 搜索: query={}", query);
        
        let start_time = std::time::Instant::now();
        
        let pattern = format!("%{}%", query);
        
        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.file_path, m.title, m.year, m.plot, m.rating, m.genres, m.director, m.actors, 
                    m.thumbnail_path, m.file_size, m.duration_seconds,
                    m.width, m.height, m.added_at, m.updated_at, m.last_accessed, m.last_checked_at, m.scan_state, m.is_watched
             FROM movies m
             WHERE m.title LIKE ?1 OR m.file_path LIKE ?1 OR m.actors LIKE ?1 OR m.director LIKE ?1
             ORDER BY m.added_at DESC"
        )?;

        let movies = stmt.query_map(params![pattern], |row| {
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
            })
        })?;

        let result: Result<Vec<Movie>, rusqlite::Error> = movies.collect();
        
        let elapsed = start_time.elapsed();
        debug!("[数据库] 搜索完成: {} 条结果，耗时: {}ms", 
               result.as_ref().map(|r| r.len()).unwrap_or(0), elapsed.as_millis());
        
        result
    }

    pub fn update_thumbnail_path(&self, movie_id: i64, thumbnail_path: &str) -> Result<()> {
        debug!("[数据库] 更新缩略图路径: movie_id={}, path={}", movie_id, thumbnail_path);
        
        self.conn.execute(
            "UPDATE movies SET thumbnail_path = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![thumbnail_path, movie_id],
        )?;
        
        info!("[数据库] 缩略图路径更新成功: movie_id={}", movie_id);
        
        Ok(())
    }

    pub fn update_video_info(
        &self,
        movie_id: i64,
        duration_seconds: Option<i64>,
        width: Option<i32>,
        height: Option<i32>,
    ) -> Result<()> {
        debug!("[数据库] 更新视频信息: movie_id={}, duration={:?}, width={:?}, height={:?}", 
               movie_id, duration_seconds, width, height);
        
        self.conn.execute(
            "UPDATE movies SET duration_seconds = ?1, width = ?2, height = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
            params![duration_seconds, width, height, movie_id],
        )?;
        
        info!("[数据库] 视频信息更新成功: movie_id={}", movie_id);
        
        Ok(())
    }

    pub fn set_watched_status(&self, movie_id: i64, is_watched: bool) -> Result<()> {
        debug!("[数据库] 设置观看状态: movie_id={}, is_watched={}", movie_id, is_watched);
        
        self.conn.execute(
            "UPDATE movies SET is_watched = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![if is_watched { 1 } else { 0 }, movie_id],
        )?;
        
        info!("[数据库] 观看状态更新成功: movie_id={}, is_watched={}", movie_id, is_watched);
        
        Ok(())
    }

    pub fn get_play_history(&self, movie_id: i64) -> Result<Option<PlayHistory>> {
        debug!("[数据库] 获取播放历史: movie_id={}", movie_id);
        
        let result = self.conn.query_row(
            "SELECT id, movie_id, last_position, last_played, play_count 
             FROM play_history WHERE movie_id = ?1",
            params![movie_id],
            |row| {
                Ok(PlayHistory {
                    id: row.get(0)?,
                    movie_id: row.get(1)?,
                    last_position: row.get(2)?,
                    last_played: row.get(3)?,
                    play_count: row.get(4)?,
                })
            }
        );

        match result {
            Ok(history) => {
                debug!("[数据库] 播放历史查询成功: movie_id={}, last_position={}s", 
                       history.movie_id, history.last_position);
                Ok(Some(history))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                debug!("[数据库] 无播放历史: movie_id={}", movie_id);
                Ok(None)
            }
            Err(e) => {
                error!("[数据库] 播放历史查询失败: {}", e);
                Err(e)
            }
        }
    }

    pub fn update_play_history(&self, movie_id: i64, position: f64) -> Result<()> {
        debug!("[数据库] 更新播放历史: movie_id={}, position={}s", movie_id, position);
        
        let existing = self.get_play_history(movie_id)?;

        if let Some(history) = existing {
            self.conn.execute(
                "UPDATE play_history SET last_position = ?1, last_played = CURRENT_TIMESTAMP, play_count = ?2 
                 WHERE movie_id = ?3",
                params![position, history.play_count + 1, movie_id],
            )?;
            debug!("[数据库] 播放历史更新成功: movie_id={}, play_count={}", 
                   movie_id, history.play_count + 1);
        } else {
            self.conn.execute(
                "INSERT INTO play_history (movie_id, last_position) VALUES (?1, ?2)",
                params![movie_id, position],
            )?;
            debug!("[数据库] 播放历史插入成功: movie_id={}", movie_id);
        }

        Ok(())
    }

    pub fn set_movie_rating(&self, movie_id: i64, rating: Option<f64>) -> Result<()> {
        debug!("[数据库] 设置电影评级: movie_id={}, rating={:?}", movie_id, rating);
        
        self.conn.execute(
            "UPDATE movies SET rating = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![rating, movie_id],
        )?;
        
        info!("[数据库] 电影评级设置成功: movie_id={}, rating={:?}", movie_id, rating);
        
        Ok(())
    }

    pub fn get_total_count(&self) -> Result<i64> {
        debug!("[数据库] 获取电影总数");
        
        let count = self.conn.query_row("SELECT COUNT(*) FROM movies", [], |row| row.get(0));
        
        match &count {
            Ok(c) => debug!("[数据库] 电影总数: {}", c),
            Err(e) => debug!("[数据库] 获取总数失败: {}", e),
        }
        
        count
    }

    pub fn delete_movie_by_path(&self, file_path: &str) -> Result<()> {
        debug!("[数据库] 删除电影: file_path={}", file_path);
        
        self.conn.execute("DELETE FROM movies WHERE file_path = ?1", params![file_path])?;
        
        info!("[数据库] 电影删除成功: {}", file_path);
        
        Ok(())
    }

    pub fn delete_invalid_records(&self) -> Result<usize> {
        info!("[数据库] 开始删除失效记录");
        
        let mut stmt = self.conn.prepare("SELECT id, file_path FROM movies")?;
        let mut rows = stmt.query([])?;
        let mut invalid_count = 0;
        
        while let Ok(Some(row)) = rows.next() {
            let id: i64 = row.get(0)?;
            let file_path: String = row.get(1)?;
            
            let path = std::path::Path::new(&file_path);
            if !path.exists() {
                debug!("[数据库] 删除失效记录: id={}, file_path={}", id, file_path);
                self.conn.execute("DELETE FROM movies WHERE id = ?1", params![id])?;
                invalid_count += 1;
            }
        }
        
        drop(rows);
        drop(stmt);
        
        info!("[数据库] 删除失效记录完成: {} 条", invalid_count);
        
        Ok(invalid_count)
    }

    pub fn get_movies_with_filters(
        &self,
        offset: i32,
        limit: i32,
        min_year: Option<i32>,
        max_year: Option<i32>,
        min_rating: Option<f64>,
        max_rating: Option<f64>,
        actors: Option<String>,
        genres: Option<String>,
        sort_by: Option<String>,
        sort_order: Option<String>,
        is_watched: Option<bool>,
    ) -> Result<Vec<Movie>> {
        debug!("[数据库] 获取筛选电影列表: offset={}, limit={}, filters={:?}, sort={:?} {:?}",
               offset, limit, (min_year, max_year, min_rating, max_rating, &actors, &genres, is_watched), sort_by, sort_order);

        let mut where_clauses = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(min_y) = min_year {
            where_clauses.push("year >= ?".to_string());
            params.push(Box::new(min_y));
        }

        if let Some(max_y) = max_year {
            where_clauses.push("year <= ?".to_string());
            params.push(Box::new(max_y));
        }

        if let Some(min_r) = min_rating {
            where_clauses.push("rating >= ?".to_string());
            params.push(Box::new(min_r));
        }

        if let Some(max_r) = max_rating {
            where_clauses.push("rating <= ?".to_string());
            params.push(Box::new(max_r));
        }

        if let Some(ref actors_str) = actors {
            if !actors_str.is_empty() {
                where_clauses.push("actors LIKE ?".to_string());
                params.push(Box::new(format!("%{}%", actors_str)));
            }
        }

        if let Some(ref genres_str) = genres {
            if !genres_str.is_empty() {
                where_clauses.push("genres LIKE ?".to_string());
                params.push(Box::new(format!("%{}%", genres_str)));
            }
        }

        if let Some(watched) = is_watched {
            where_clauses.push("is_watched = ?".to_string());
            params.push(Box::new(if watched { 1 } else { 0 }));
        }

        let where_clause = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };

        let sort_column = sort_by.unwrap_or_else(|| "added_at".to_string());
        let sort_dir = sort_order.unwrap_or_else(|| "DESC".to_string());

        let query = format!(
            "SELECT id, file_path, title, year, plot, rating, genres, director, actors,
                    thumbnail_path, file_size, duration_seconds,
                    width, height, added_at, updated_at, last_accessed, last_checked_at, scan_state, is_watched
             FROM movies
             {}
             ORDER BY {} {}
             LIMIT ? OFFSET ?",
            where_clause, sort_column, sort_dir
        );

        params.push(Box::new(limit));
        params.push(Box::new(offset));

        let mut stmt = self.conn.prepare(&query)?;

        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let movies = stmt.query_map(param_refs.as_slice(), |row| {
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
            })
        })?;

        let result: Result<Vec<Movie>, rusqlite::Error> = movies.collect();
        
        match &result {
            Ok(movies) => debug!("[数据库] 筛选电影查询成功: {} 条结果", movies.len()),
            Err(e) => debug!("[数据库] 筛选电影查询失败: {}", e),
        }
        
        result
    }

    pub fn get_unique_genres(&self) -> Result<Vec<String>> {
        debug!("[数据库] 获取所有类型");

        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT genres FROM movies WHERE genres IS NOT NULL AND genres != ''"
        )?;

        let genres_iter = stmt.query_map([], |row| {
            let genres_str: String = row.get(0)?;
            Ok(genres_str)
        })?;

        let mut all_genres = Vec::new();
        for genre_result in genres_iter {
            if let Ok(genres_str) = genre_result {
                for genre in genres_str.split(',') {
                    let genre = genre.trim();
                    if !genre.is_empty() && !all_genres.contains(&genre.to_string()) {
                        all_genres.push(genre.to_string());
                    }
                }
            }
        }

        all_genres.sort();
        debug!("[数据库] 获取类型成功: {} 个类型", all_genres.len());

        Ok(all_genres)
    }

    pub fn get_unique_actors(&self) -> Result<Vec<String>> {
        debug!("[数据库] 获取所有演员");

        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT actors FROM movies WHERE actors IS NOT NULL AND actors != ''"
        )?;

        let actors_iter = stmt.query_map([], |row| {
            let actors_str: String = row.get(0)?;
            Ok(actors_str)
        })?;

        let mut all_actors = Vec::new();
        for actor_result in actors_iter {
            if let Ok(actors_str) = actor_result {
                for actor in actors_str.split(',') {
                    let actor = actor.trim();
                    if !actor.is_empty() && !all_actors.contains(&actor.to_string()) {
                        all_actors.push(actor.to_string());
                    }
                }
            }
        }

        all_actors.sort();
        debug!("[数据库] 获取演员成功: {} 个演员", all_actors.len());

        Ok(all_actors)
    }

    pub fn clear_all_movies(&self) -> Result<()> {
        info!("[数据库] 清空所有电影数据");
        
        self.conn.execute("DELETE FROM movies", [])?;
        self.conn.execute("DELETE FROM play_history", [])?;
        
        info!("[数据库] 所有电影数据已清空");
        
        Ok(())
    }
}
