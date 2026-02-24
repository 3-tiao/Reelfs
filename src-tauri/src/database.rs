use rusqlite::{Connection, Result, params, ToSql};
use std::path::Path;
use crate::models::{Movie, PlayHistory};
use log::{info, debug, warn, error};

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
                poster_path TEXT,
                fanart_path TEXT,
                thumbnail_path TEXT,
                file_size INTEGER,
                duration_seconds INTEGER,
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
            CREATE INDEX IF NOT EXISTS idx_rating ON movies(rating);
            CREATE INDEX IF NOT EXISTS idx_added_at ON movies(added_at DESC);
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
        
        Ok(())
    }

    pub fn insert_movie(&self, file_path: &str, title: &str, year: Option<i32>, 
                       plot: Option<&str>, rating: Option<f64>, genres: Option<&str>,
                       director: Option<&str>, actors: Option<&str>, 
                       poster_path: Option<&str>, fanart_path: Option<&str>) -> Result<i64> {
        debug!("[数据库] 插入电影: title={}, file_path={}", title, file_path);
        
        self.conn.execute(
            "INSERT INTO movies (file_path, title, year, plot, rating, genres, director, actors, poster_path, fanart_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![file_path, title, year, plot, rating, genres, director, actors, poster_path, fanart_path],
        )?;
        
        let id = self.conn.last_insert_rowid();
        info!("[数据库] 电影插入成功: id={}, title={}", id, title);
        
        Ok(id)
    }

    pub fn batch_insert_movies(&self, movies: &[(String, String, Option<i32>, Option<String>, Option<f64>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)]) -> Result<usize> {
        let start_time = std::time::Instant::now();
        debug!("[数据库] 开始批量插入: {} 条记录", movies.len());
        
        let tx = self.conn.unchecked_transaction()?;
        let mut count = 0;

        for movie in movies {
            let result = tx.execute(
                "INSERT OR IGNORE INTO movies (file_path, title, year, plot, rating, genres, director, actors, poster_path, fanart_path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    &movie.0, &movie.1, movie.2, &movie.3, movie.4, 
                    &movie.5, &movie.6, &movie.7, &movie.8, &movie.9
                ],
            );
            if result.is_ok() {
                count += 1;
            }
        }

        tx.commit()?;
        
        let elapsed = start_time.elapsed();
        info!("[数据库] 批量插入完成: {}/{} 条，耗时: {}ms", count, movies.len(), elapsed.as_millis());
        
        Ok(count)
    }

    pub fn get_movies(&self, offset: i32, limit: i32) -> Result<Vec<Movie>> {
        debug!("[数据库] 获取电影列表: offset={}, limit={}", offset, limit);
        
        let mut stmt = self.conn.prepare(
            "SELECT id, file_path, title, year, plot, rating, genres, director, actors, 
                    poster_path, fanart_path, thumbnail_path, file_size, duration_seconds,
                    added_at, updated_at, last_accessed
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
                poster_path: row.get(9)?,
                fanart_path: row.get(10)?,
                thumbnail_path: row.get(11)?,
                file_size: row.get(12)?,
                duration_seconds: row.get(13)?,
                added_at: row.get(14)?,
                updated_at: row.get(15)?,
                last_accessed: row.get(16)?,
            })
        })?;

        movies.collect()
    }

    pub fn get_movie_by_id(&self, id: i64) -> Result<Movie> {
        debug!("[数据库] 获取电影详情: id={}", id);
        
        let movie = self.conn.query_row(
            "SELECT id, file_path, title, year, plot, rating, genres, director, actors, 
                    poster_path, fanart_path, thumbnail_path, file_size, duration_seconds,
                    added_at, updated_at, last_accessed
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
                    poster_path: row.get(9)?,
                    fanart_path: row.get(10)?,
                    thumbnail_path: row.get(11)?,
                    file_size: row.get(12)?,
                    duration_seconds: row.get(13)?,
                    added_at: row.get(14)?,
                    updated_at: row.get(15)?,
                    last_accessed: row.get(16)?,
                })
            }
        );
        
        match &movie {
            Ok(m) => debug!("[数据库] 电影查询成功: id={}, title={}", m.id, m.title),
            Err(e) => debug!("[数据库] 电影查询失败: {}", e),
        }
        
        movie
    }

    pub fn search_movies(&self, query: &str) -> Result<Vec<Movie>> {
        debug!("[数据库] 搜索: query={}", query);
        
        let start_time = std::time::Instant::now();
        
        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.file_path, m.title, m.year, m.plot, m.rating, m.genres, m.director, m.actors, 
                    m.poster_path, m.fanart_path, m.thumbnail_path, m.file_size, m.duration_seconds,
                    m.added_at, m.updated_at, m.last_accessed
             FROM movies m
             WHERE m.title LIKE '%' || ?1 || '%'
             ORDER BY m.added_at DESC"
        )?;

        let movies = stmt.query_map(params![query], |row| {
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
                poster_path: row.get(9)?,
                fanart_path: row.get(10)?,
                thumbnail_path: row.get(11)?,
                file_size: row.get(12)?,
                duration_seconds: row.get(13)?,
                added_at: row.get(14)?,
                updated_at: row.get(15)?,
                last_accessed: row.get(16)?,
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

    pub fn set_movie_rating(&self, movie_id: i64, rating: Option<f64>) -> Result<()> {
        debug!("[数据库] 设置电影评级: movie_id={}, rating={:?}", movie_id, rating);
        
        let result = self.conn.execute(
            "UPDATE movies SET rating = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![rating, movie_id],
        )?;
        
        if result > 0 {
            info!("[数据库] 电影评级更新成功: movie_id={}, rating={:?}", movie_id, rating);
        } else {
            warn!("[数据库] 电影评级更新失败: movie_id={} 不存在", movie_id);
        }
        
        Ok(())
    }

    pub fn get_movies_by_rating_range(&self, min_rating: Option<f64>, max_rating: Option<f64>) -> Result<Vec<Movie>> {
        debug!("[数据库] 按评级范围查询: min={:?}, max={:?}", min_rating, max_rating);
        
        let query: String;
        let params_vec: Vec<Box<dyn ToSql>>;
        
        match (min_rating, max_rating) {
            (Some(min), Some(max)) => {
                query = "SELECT id, file_path, title, year, plot, rating, genres, director, actors, 
                        poster_path, fanart_path, thumbnail_path, file_size, duration_seconds,
                        added_at, updated_at, last_accessed
                 FROM movies 
                 WHERE rating >= ?1 AND rating <= ?2
                 ORDER BY rating DESC".to_string();
                params_vec = vec![Box::new(min), Box::new(max)];
            },
            (Some(min), None) => {
                query = "SELECT id, file_path, title, year, plot, rating, genres, director, actors, 
                        poster_path, fanart_path, thumbnail_path, file_size, duration_seconds,
                        added_at, updated_at, last_accessed
                 FROM movies 
                 WHERE rating >= ?1
                 ORDER BY rating DESC".to_string();
                params_vec = vec![Box::new(min)];
            },
            (None, Some(max)) => {
                query = "SELECT id, file_path, title, year, plot, rating, genres, director, actors, 
                        poster_path, fanart_path, thumbnail_path, file_size, duration_seconds,
                        added_at, updated_at, last_accessed
                 FROM movies 
                 WHERE rating <= ?1
                 ORDER BY rating DESC".to_string();
                params_vec = vec![Box::new(max)];
            },
            (None, None) => {
                query = "SELECT id, file_path, title, year, plot, rating, genres, director, actors, 
                        poster_path, fanart_path, thumbnail_path, file_size, duration_seconds,
                        added_at, updated_at, last_accessed
                 FROM movies 
                 WHERE rating IS NOT NULL
                 ORDER BY rating DESC".to_string();
                params_vec = vec![];
            },
        };
        
        let mut stmt = self.conn.prepare(&query)?;
        
        let params_refs: Vec<&dyn ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        
        let movies = stmt.query_map(params_refs.as_slice(), |row| {
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
                poster_path: row.get(9)?,
                fanart_path: row.get(10)?,
                thumbnail_path: row.get(11)?,
                file_size: row.get(12)?,
                duration_seconds: row.get(13)?,
                added_at: row.get(14)?,
                updated_at: row.get(15)?,
                last_accessed: row.get(16)?,
            })
        })?;

        let result: Result<Vec<Movie>, rusqlite::Error> = movies.collect();
        
        debug!("[数据库] 评级范围查询完成: {} 条结果", result.as_ref().map(|r| r.len()).unwrap_or(0));
        
        result
    }
}
