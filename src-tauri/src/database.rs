use rusqlite::{Connection, Result, params};
use std::path::Path;
use crate::models::{Movie, PlayHistory};

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(db_path: &str) -> Result<Self> {
        if let Some(parent) = Path::new(db_path).parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(db_path)?;
        let db = Database { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
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
        Ok(())
    }

    pub fn insert_movie(&self, file_path: &str, title: &str, year: Option<i32>, 
                       plot: Option<&str>, rating: Option<f64>, genres: Option<&str>,
                       director: Option<&str>, actors: Option<&str>, 
                       poster_path: Option<&str>, fanart_path: Option<&str>) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO movies (file_path, title, year, plot, rating, genres, director, actors, poster_path, fanart_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![file_path, title, year, plot, rating, genres, director, actors, poster_path, fanart_path],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn batch_insert_movies(&self, movies: &[(String, String, Option<i32>, Option<String>, Option<f64>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)]) -> Result<usize> {
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
        Ok(count)
    }

    pub fn get_movies(&self, offset: i32, limit: i32) -> Result<Vec<Movie>> {
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
        self.conn.query_row(
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
        )
    }

    pub fn search_movies(&self, query: &str) -> Result<Vec<Movie>> {
        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.file_path, m.title, m.year, m.plot, m.rating, m.genres, m.director, m.actors, 
                    m.poster_path, m.fanart_path, m.thumbnail_path, m.file_size, m.duration_seconds,
                    m.added_at, m.updated_at, m.last_accessed
             FROM movies m
             JOIN movie_fts ON movie_fts.rowid = m.id
             WHERE movie_fts MATCH ?1
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

        movies.collect()
    }

    pub fn update_thumbnail_path(&self, movie_id: i64, thumbnail_path: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE movies SET thumbnail_path = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![thumbnail_path, movie_id],
        )?;
        Ok(())
    }

    pub fn get_play_history(&self, movie_id: i64) -> Result<Option<PlayHistory>> {
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
            Ok(history) => Ok(Some(history)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn update_play_history(&self, movie_id: i64, position: f64) -> Result<()> {
        let existing = self.get_play_history(movie_id)?;

        if let Some(history) = existing {
            self.conn.execute(
                "UPDATE play_history SET last_position = ?1, last_played = CURRENT_TIMESTAMP, play_count = ?2 
                 WHERE movie_id = ?3",
                params![position, history.play_count + 1, movie_id],
            )?;
        } else {
            self.conn.execute(
                "INSERT INTO play_history (movie_id, last_position) VALUES (?1, ?2)",
                params![movie_id, position],
            )?;
        }

        Ok(())
    }

    pub fn get_total_count(&self) -> Result<i64> {
        self.conn.query_row("SELECT COUNT(*) FROM movies", [], |row| row.get(0))
    }

    pub fn delete_movie_by_path(&self, file_path: &str) -> Result<()> {
        self.conn.execute("DELETE FROM movies WHERE file_path = ?1", params![file_path])?;
        Ok(())
    }
}
