use crate::models::{Movie, PlayHistory};
use crate::path_utils::normalize_path_str;
use log::{debug, error, info};
use rusqlite::{params, Connection, Result};
use std::collections::HashSet;
use std::path::Path;

pub type MovieUpdateRow = (
    i64,
    String,
    Option<i32>,
    Option<String>,
    Option<f64>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<i64>,
);

pub struct Database {
    conn: Connection,
}

pub type MovieBatchRow = (
    String,
    String,
    Option<i32>,
    Option<String>,
    Option<f64>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<i64>,
    Option<i32>,
    Option<i32>,
);

fn map_movie_row(row: &rusqlite::Row<'_>) -> Result<Movie> {
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
}

fn build_fts_query(query: &str) -> Option<String> {
    let tokens: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(|token| format!("{}*", token))
        .collect();

    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}

fn normalize_search_query(query: &str) -> Option<String> {
    let normalized = query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn resolve_sort_clause(
    sort_by: Option<&str>,
    sort_order: Option<&str>,
) -> (&'static str, &'static str) {
    let sort_column = match sort_by.unwrap_or("added_at") {
        "title" => "COALESCE(vg.title, m.title)",
        "year" => "COALESCE(vg.year, m.year)",
        "rating" => "COALESCE(vg.rating, m.rating)",
        "duration_seconds" => "COALESCE(vg.total_duration, m.duration_seconds)",
        "last_accessed" => "m.last_accessed",
        "play_count" => "COALESCE(ph.play_count, 0)",
        _ => "m.added_at",
    };

    let sort_direction = match sort_order.unwrap_or("DESC").to_ascii_uppercase().as_str() {
        "ASC" => "ASC",
        _ => "DESC",
    };

    (sort_column, sort_direction)
}

fn nulls_last_suffix(sort_by: Option<&str>) -> &'static str {
    // Push rows with missing data to the bottom regardless of sort direction
    // so ASC/DESC stay visually distinguishable when most rows have NULLs.
    match sort_by.unwrap_or("") {
        "last_accessed" | "year" => " NULLS LAST",
        _ => "",
    }
}

fn build_order_clause(sort_by: Option<&str>, sort_order: Option<&str>) -> String {
    let (sorted_col, sort_dir) = resolve_sort_clause(sort_by, sort_order);
    if sort_by.map(|v| v == "rating").unwrap_or(false) {
        // Within each rating bucket, fall back to added_at (same direction)
        // so paginated chunks line up with the front-end section grouping.
        format!(
            "{} {}, m.added_at {}, m.id DESC",
            sorted_col, sort_dir, sort_dir
        )
    } else {
        format!(
            "{} {}{}, m.id DESC",
            sorted_col,
            sort_dir,
            nulls_last_suffix(sort_by)
        )
    }
}

fn sanitize_rating(rating: Option<f64>) -> Option<f64> {
    match rating {
        Some(value) if (0.0..=5.0).contains(&value) => Some(value),
        _ => None,
    }
}

impl Database {
    pub fn new(db_path: &str) -> Result<Self> {
        info!("[数据库] 初始化数据库: {}", db_path);

        if let Some(parent) = Path::new(db_path).parent() {
            debug!("[数据库] 创建数据库目录: {:?}", parent);
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(db_path)?;
        // Multiple connections exist (UI commands, watcher thread, indexer threads).
        // Without these, concurrent writers hit SQLITE_BUSY immediately.
        conn.busy_timeout(std::time::Duration::from_secs(10))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Database { conn };
        db.init_schema()?;

        info!("[数据库] 数据库初始化成功: {}", db_path);

        Ok(db)
    }

    pub fn get_connection(&self) -> &Connection {
        &self.conn
    }

    /// Trigger maintenance for the external-content FTS5 table must use the
    /// documented 'delete' command form (https://sqlite.org/fts5.html,
    /// "External Content Tables"). The previous plain UPDATE/DELETE shapes
    /// corrupted the index: a NULL->value UPDATE failed with "database disk
    /// image is malformed" (rolling back whole batch transactions), renamed
    /// tokens stayed searchable forever, and deleted rows kept matching.
    const FTS_SYNC_TRIGGER_SQL: &str = "
            CREATE TRIGGER IF NOT EXISTS movies_ad AFTER DELETE ON movies BEGIN
                INSERT INTO movie_fts(movie_fts, rowid, title, plot, actors, director)
                VALUES ('delete', old.id, old.title, old.plot, old.actors, old.director);
            END;

            CREATE TRIGGER IF NOT EXISTS movies_au AFTER UPDATE ON movies BEGIN
                INSERT INTO movie_fts(movie_fts, rowid, title, plot, actors, director)
                VALUES ('delete', old.id, old.title, old.plot, old.actors, old.director);
                INSERT INTO movie_fts(rowid, title, plot, actors, director)
                VALUES (new.id, new.title, new.plot, new.actors, new.director);
            END;";

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

            CREATE TABLE IF NOT EXISTS video_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                year INTEGER,
                plot TEXT,
                rating REAL,
                genres TEXT,
                director TEXT,
                actors TEXT,
                poster_path TEXT,
                total_duration INTEGER,
                part_count INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS video_parts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                movie_id INTEGER NOT NULL,
                part_number INTEGER NOT NULL,
                part_title TEXT,
                duration_seconds INTEGER,
                FOREIGN KEY (group_id) REFERENCES video_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
                UNIQUE(group_id, part_number)
            );

            CREATE INDEX IF NOT EXISTS idx_title ON movies(title);
            CREATE INDEX IF NOT EXISTS idx_year ON movies(year);
            CREATE INDEX IF NOT EXISTS idx_added_at ON movies(added_at DESC);
            CREATE INDEX IF NOT EXISTS idx_rating ON movies(rating);
            CREATE INDEX IF NOT EXISTS idx_last_accessed ON movies(last_accessed DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_file_path ON movies(file_path);
            CREATE INDEX IF NOT EXISTS idx_video_groups_title ON video_groups(title);
            CREATE INDEX IF NOT EXISTS idx_video_parts_group ON video_parts(group_id);
            CREATE INDEX IF NOT EXISTS idx_video_parts_movie ON video_parts(movie_id);

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

            ",
        )?;

        self.conn.execute_batch(Self::FTS_SYNC_TRIGGER_SQL)?;

        debug!("[数据库] 数据库表结构初始化完成");

        self.migrate_database()?;

        Ok(())
    }

    fn migrate_database(&self) -> Result<()> {
        info!("[数据库] 检查并应用数据库迁移");

        let tx = self.conn.unchecked_transaction()?;

        let has_width = tx
            .prepare("SELECT 1 FROM pragma_table_info('movies') WHERE name = 'width'")?
            .exists([])?;

        let has_height = tx
            .prepare("SELECT 1 FROM pragma_table_info('movies') WHERE name = 'height'")?
            .exists([])?;

        let has_last_checked_at = tx
            .prepare("SELECT 1 FROM pragma_table_info('movies') WHERE name = 'last_checked_at'")?
            .exists([])?;

        let has_scan_state = tx
            .prepare("SELECT 1 FROM pragma_table_info('movies') WHERE name = 'scan_state'")?
            .exists([])?;

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

        let has_is_watched = tx
            .prepare("SELECT 1 FROM pragma_table_info('movies') WHERE name = 'is_watched'")?
            .exists([])?;

        if !has_is_watched {
            info!("[数据库] 添加 is_watched 列");
            tx.execute(
                "ALTER TABLE movies ADD COLUMN is_watched INTEGER DEFAULT 0",
                [],
            )?;
        }

        let has_group_id = tx
            .prepare("SELECT 1 FROM pragma_table_info('movies') WHERE name = 'group_id'")?
            .exists([])?;

        if !has_group_id {
            info!("[数据库] 添加 group_id 列");
            tx.execute(
                "ALTER TABLE movies ADD COLUMN group_id INTEGER REFERENCES video_groups(id)",
                [],
            )?;
        }

        let cleared_movie_ratings = tx.execute(
            "UPDATE movies SET rating = NULL, updated_at = CURRENT_TIMESTAMP WHERE rating < 0 OR rating > 5",
            [],
        )?;
        if cleared_movie_ratings > 0 {
            info!("[数据库] 已清理 {} 条异常电影评分", cleared_movie_ratings);
        }

        let cleared_group_ratings = tx.execute(
            "UPDATE video_groups SET rating = NULL, updated_at = CURRENT_TIMESTAMP WHERE rating < 0 OR rating > 5",
            [],
        )?;
        if cleared_group_ratings > 0 {
            info!("[数据库] 已清理 {} 条异常视频组评分", cleared_group_ratings);
        }

        let fixed_checked_timestamps = tx.execute(
            "UPDATE movies SET last_checked_at = CURRENT_TIMESTAMP WHERE last_checked_at = 'checked'",
            [],
        )?;
        if fixed_checked_timestamps > 0 {
            info!(
                "[数据库] 已修复 {} 条非日期 last_checked_at",
                fixed_checked_timestamps
            );
        }

        // Backfill movies.last_accessed from play_history.last_played for rows
        // played before increment_play_count started touching last_accessed.
        // Idempotent: only fills NULL targets that have a matching play_history row.
        let backfilled_last_accessed = tx.execute(
            "UPDATE movies
                SET last_accessed = (
                    SELECT last_played FROM play_history WHERE play_history.movie_id = movies.id
                )
              WHERE last_accessed IS NULL
                AND EXISTS (SELECT 1 FROM play_history WHERE play_history.movie_id = movies.id)",
            [],
        )?;
        if backfilled_last_accessed > 0 {
            info!(
                "[数据库] 已从 play_history.last_played 回填 {} 条 last_accessed",
                backfilled_last_accessed
            );
        }

        // Repair databases created before the FTS5 trigger fix: if the UPDATE
        // trigger is still the corrupting plain-UPDATE shape, replace both
        // sync triggers with the 'delete' command form and rebuild the index
        // once to flush ghost tokens left by the old shapes. A no-op for
        // databases already on the fixed triggers.
        let movies_au_sql: Option<String> = tx
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'movies_au'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(None);
        if let Some(sql) = movies_au_sql {
            if !sql.contains("'delete'") {
                info!("[数据库] 修复 FTS5 同步触发器（'delete' 命令形式）并重建全文索引");
                tx.execute("DROP TRIGGER IF EXISTS movies_au", [])?;
                tx.execute("DROP TRIGGER IF EXISTS movies_ad", [])?;
                tx.execute_batch(Self::FTS_SYNC_TRIGGER_SQL)?;
                tx.execute("INSERT INTO movie_fts(movie_fts) VALUES('rebuild')", [])?;
            }
        }

        // Always run; the pass is O(N) and a no-op when there are no NFC/NFD
        // drifts, so it doubles as a safety net against future regressions
        // (external writes, rolled-back versions, etc.).
        Self::migrate_path_nfc(&tx)?;

        tx.commit()?;

        info!("[数据库] 数据库迁移完成");

        Ok(())
    }

    /// Migration: collapse rows whose `file_path` differs only in Unicode
    /// normalization form (NFD vs NFC, common on macOS) into a single canonical
    /// NFC row, merging useful per-movie state.
    ///
    /// Runs on every connection open (there is no `user_version` gate) so it also
    /// acts as a safety net against NFD/NFC drift introduced outside the app.
    /// Measured cost: ~200ms for a 10k-row library in a debug build.
    fn migrate_path_nfc(tx: &rusqlite::Transaction<'_>) -> Result<()> {
        use std::collections::HashMap;

        debug!("[数据库] 开始 Unicode NFC 路径迁移");

        let rows: Vec<(i64, String)> = {
            let mut stmt = tx.prepare("SELECT id, file_path FROM movies ORDER BY id ASC")?;
            let iter = stmt.query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut out = Vec::new();
            for r in iter {
                out.push(r?);
            }
            out
        };

        let mut groups: HashMap<String, Vec<i64>> = HashMap::new();
        for (id, fp) in &rows {
            let key = normalize_path_str(fp);
            groups.entry(key).or_default().push(*id);
        }

        let mut merged = 0usize;
        let mut rewritten = 0usize;

        for (nfc_path, members) in groups {
            if members.is_empty() {
                continue;
            }
            let keeper_id = *members.iter().min().expect("non-empty");
            let duplicates: Vec<i64> = members.into_iter().filter(|id| *id != keeper_id).collect();

            for dup_id in &duplicates {
                // Merge state from dup → keeper. Keeper's existing values win when set;
                // otherwise we adopt the duplicate's, so nothing useful is lost.
                tx.execute(
                    "UPDATE movies SET
                        rating = COALESCE(rating, (SELECT rating FROM movies WHERE id = ?2)),
                        is_watched = MAX(IFNULL(is_watched, 0), IFNULL((SELECT is_watched FROM movies WHERE id = ?2), 0)),
                        last_accessed = COALESCE(last_accessed, (SELECT last_accessed FROM movies WHERE id = ?2)),
                        group_id = COALESCE(group_id, (SELECT group_id FROM movies WHERE id = ?2)),
                        updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?1",
                    params![keeper_id, dup_id],
                )?;

                // Rebind dependent rows before the cascade kicks in.
                tx.execute(
                    "UPDATE play_history SET movie_id = ?1 WHERE movie_id = ?2",
                    params![keeper_id, dup_id],
                )?;
                tx.execute(
                    "UPDATE video_parts SET movie_id = ?1 WHERE movie_id = ?2",
                    params![keeper_id, dup_id],
                )?;

                tx.execute("DELETE FROM movies WHERE id = ?1", params![dup_id])?;
                merged += 1;
            }

            // Make sure the keeper's stored path is in NFC form too.
            let changed = tx.execute(
                "UPDATE movies SET file_path = ?1 WHERE id = ?2 AND file_path <> ?1",
                params![nfc_path, keeper_id],
            )?;
            rewritten += changed;
        }

        if merged > 0 || rewritten > 0 {
            info!(
                "[数据库] Unicode NFC 路径迁移完成: 合并 {} 条重复, 重写 {} 条路径",
                merged, rewritten
            );
        } else {
            debug!("[数据库] Unicode NFC 路径迁移完成: 无需变更");
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_movie(
        &self,
        file_path: &str,
        title: &str,
        year: Option<i32>,
        plot: Option<&str>,
        rating: Option<f64>,
        genres: Option<&str>,
        director: Option<&str>,
        actors: Option<&str>,
        file_size: Option<i64>,
        duration_seconds: Option<i64>,
        width: Option<i32>,
        height: Option<i32>,
    ) -> Result<i64> {
        let file_path = normalize_path_str(file_path);
        debug!(
            "[数据库] 插入电影: title={}, file_path={}",
            title, file_path
        );
        let rating = sanitize_rating(rating);

        // ON CONFLICT DO NOTHING with RETURNING id so racing inserts (watcher + scan) don't error.
        // If the row already existed, RETURNING yields no rows; fall back to a SELECT.
        let id: Option<i64> = self.conn.query_row(
            "INSERT INTO movies (file_path, title, year, plot, rating, genres, director, actors, file_size, duration_seconds, width, height, last_checked_at, scan_state)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP, 'checked')
             ON CONFLICT(file_path) DO NOTHING
             RETURNING id",
            params![file_path, title, year, plot, rating, genres, director, actors, file_size, duration_seconds, width, height],
            |row| row.get::<_, i64>(0),
        ).map(Some).or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;

        let id = match id {
            Some(id) => id,
            None => self.conn.query_row(
                "SELECT id FROM movies WHERE file_path = ?1",
                params![file_path],
                |row| row.get(0),
            )?,
        };

        info!("[数据库] 电影插入成功: id={}, title={}", id, title);

        Ok(id)
    }

    pub fn batch_insert_movies(&self, movies: &[MovieBatchRow]) -> Result<Vec<i64>> {
        let start_time = std::time::Instant::now();
        debug!("[数据库] 开始批量插入/更新: {} 条记录", movies.len());

        let tx = self.conn.unchecked_transaction()?;
        let mut ids = Vec::with_capacity(movies.len());

        {
            let mut stmt = tx.prepare(
                "INSERT INTO movies (file_path, title, year, plot, rating, genres, director, actors, file_size, duration_seconds, width, height, last_checked_at, scan_state)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP, 'checked')
                 ON CONFLICT(file_path) DO UPDATE SET
                    title = excluded.title,
                    year = excluded.year,
                    plot = excluded.plot,
                    rating = COALESCE(movies.rating, excluded.rating),
                    genres = excluded.genres,
                    director = excluded.director,
                    actors = excluded.actors,
                    file_size = excluded.file_size,
                    last_checked_at = CURRENT_TIMESTAMP,
                    scan_state = 'checked',
                    updated_at = CURRENT_TIMESTAMP
                 RETURNING id"
            )?;

            for movie in movies {
                let rating = sanitize_rating(movie.4);
                let normalized_path = normalize_path_str(&movie.0);
                let id_result = stmt.query_row(
                    params![
                        &normalized_path,
                        &movie.1,
                        movie.2,
                        &movie.3,
                        rating,
                        &movie.5,
                        &movie.6,
                        &movie.7,
                        movie.8,
                        movie.9,
                        movie.10,
                        movie.11
                    ],
                    |row| row.get::<_, i64>(0),
                );
                match id_result {
                    Ok(id) => ids.push(id),
                    Err(e) => error!(
                        "[数据库] 批量插入单行失败: path={}, error={}",
                        normalized_path, e
                    ),
                }
            }
        }

        tx.commit()?;

        let elapsed = start_time.elapsed();
        info!(
            "[数据库] 批量插入/更新完成: {}/{} 条，耗时: {}ms",
            ids.len(),
            movies.len(),
            elapsed.as_millis()
        );

        Ok(ids)
    }

    pub fn get_movies(&self, offset: i32, limit: i32) -> Result<Vec<Movie>> {
        debug!("[数据库] 获取电影列表: offset={}, limit={}", offset, limit);

        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.file_path,
                    COALESCE(vg.title, m.title) as title,
                    COALESCE(vg.year, m.year) as year,
                    COALESCE(vg.plot, m.plot) as plot,
                    COALESCE(vg.rating, m.rating) as rating,
                    COALESCE(vg.genres, m.genres) as genres,
                    COALESCE(vg.director, m.director) as director,
                    COALESCE(vg.actors, m.actors) as actors,
                    COALESCE(vg.poster_path, m.thumbnail_path) as thumbnail_path,
                    m.file_size,
                    COALESCE(vg.total_duration, m.duration_seconds) as duration_seconds,
                    m.width, m.height, m.added_at, m.updated_at, m.last_accessed, m.last_checked_at, m.scan_state, m.is_watched, m.group_id,
                    COALESCE(ph.play_count, 0) as play_count
             FROM movies m
             LEFT JOIN video_groups vg ON m.group_id = vg.id
             LEFT JOIN play_history ph ON ph.movie_id = m.id
             WHERE m.group_id IS NULL OR m.id = (
                 SELECT movie_id FROM video_parts WHERE group_id = m.group_id ORDER BY part_number LIMIT 1
             )
             ORDER BY m.added_at DESC, m.id DESC LIMIT ?1 OFFSET ?2"
        )?;

        let movies = stmt.query_map(params![limit, offset], map_movie_row)?;

        movies.collect()
    }

    pub fn get_all_movies(&self) -> Result<Vec<Movie>> {
        debug!("[数据库] 获取全部电影列表");

        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.file_path,
                    COALESCE(vg.title, m.title) as title,
                    COALESCE(vg.year, m.year) as year,
                    COALESCE(vg.plot, m.plot) as plot,
                    COALESCE(vg.rating, m.rating) as rating,
                    COALESCE(vg.genres, m.genres) as genres,
                    COALESCE(vg.director, m.director) as director,
                    COALESCE(vg.actors, m.actors) as actors,
                    COALESCE(vg.poster_path, m.thumbnail_path) as thumbnail_path,
                    m.file_size,
                    COALESCE(vg.total_duration, m.duration_seconds) as duration_seconds,
                    m.width, m.height, m.added_at, m.updated_at, m.last_accessed, m.last_checked_at, m.scan_state, m.is_watched, m.group_id,
                    COALESCE(ph.play_count, 0) as play_count
             FROM movies m
             LEFT JOIN video_groups vg ON m.group_id = vg.id
             LEFT JOIN play_history ph ON ph.movie_id = m.id
             WHERE m.group_id IS NULL OR m.id = (
                 SELECT movie_id FROM video_parts WHERE group_id = m.group_id ORDER BY part_number LIMIT 1
             )
             ORDER BY m.added_at DESC, m.id DESC"
        )?;

        let movies = stmt.query_map([], map_movie_row)?;

        movies.collect()
    }

    pub fn get_movie_by_id(&self, id: i64) -> Result<Movie> {
        debug!("[数据库] 获取电影详情: id={}", id);

        let movie = self.conn.query_row(
            "SELECT m.id, m.file_path, m.title, m.year, m.plot, m.rating, m.genres, m.director, m.actors,
                    m.thumbnail_path, m.file_size, m.duration_seconds,
                    m.width, m.height, m.added_at, m.updated_at, m.last_accessed, m.last_checked_at, m.scan_state, m.is_watched, m.group_id,
                    COALESCE(ph.play_count, 0) as play_count
             FROM movies m
             LEFT JOIN play_history ph ON ph.movie_id = m.id
             WHERE m.id = ?1",
            params![id],
            map_movie_row,
        );

        match &movie {
            Ok(m) => debug!("[数据库] 电影查询成功: id={}, title={}", m.id, m.title),
            Err(e) => debug!("[数据库] 电影查询失败: {}", e),
        }

        movie
    }

    pub fn get_movie_by_path(&self, file_path: &str) -> Result<Option<Movie>> {
        let file_path = normalize_path_str(file_path);
        debug!("[数据库] 根据路径获取电影: file_path={}", file_path);

        let movie = self.conn.query_row(
            "SELECT m.id, m.file_path, m.title, m.year, m.plot, m.rating, m.genres, m.director, m.actors,
                    m.thumbnail_path, m.file_size, m.duration_seconds,
                    m.width, m.height, m.added_at, m.updated_at, m.last_accessed, m.last_checked_at, m.scan_state, m.is_watched, m.group_id,
                    COALESCE(ph.play_count, 0) as play_count
             FROM movies m
             LEFT JOIN play_history ph ON ph.movie_id = m.id
             WHERE m.file_path = ?1",
            params![file_path],
            map_movie_row,
        );

        match movie {
            Ok(m) => {
                debug!("[数据库] 电影查询成功: id={}, title={}", m.id, m.title);
                Ok(Some(m))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                debug!("[数据库] 电影不存在: {}", file_path);
                Ok(None)
            }
            Err(e) => {
                debug!("[数据库] 电影查询失败: {}", e);
                Err(e)
            }
        }
    }

    pub fn search_movies(&self, query: &str, offset: i32, limit: i32) -> Result<Vec<Movie>> {
        debug!(
            "[数据库] 搜索: query={}, offset={}, limit={}",
            query, offset, limit
        );

        let start_time = std::time::Instant::now();

        let Some(fts_query) = build_fts_query(query) else {
            debug!("[数据库] 搜索关键字为空，直接返回空结果");
            return Ok(Vec::new());
        };

        let normalized_query = normalize_search_query(query).unwrap_or_default();
        let title_prefix_pattern = format!("{}%", escape_like_pattern(&normalized_query));
        let contains_pattern = format!("%{}%", escape_like_pattern(&normalized_query));

        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.file_path, 
                    COALESCE(vg.title, m.title) as title, 
                    COALESCE(vg.year, m.year) as year, 
                    COALESCE(vg.plot, m.plot) as plot, 
                    COALESCE(vg.rating, m.rating) as rating, 
                    COALESCE(vg.genres, m.genres) as genres, 
                    COALESCE(vg.director, m.director) as director, 
                    COALESCE(vg.actors, m.actors) as actors, 
                    COALESCE(vg.poster_path, m.thumbnail_path) as thumbnail_path, 
                    m.file_size, 
                    COALESCE(vg.total_duration, m.duration_seconds) as duration_seconds,
                    m.width, m.height, m.added_at, m.updated_at, m.last_accessed, m.last_checked_at, m.scan_state, m.is_watched, m.group_id,
                    COALESCE(ph.play_count, 0) as play_count
             FROM movie_fts
             JOIN movies m ON m.id = movie_fts.rowid
             LEFT JOIN video_groups vg ON m.group_id = vg.id
             LEFT JOIN play_history ph ON ph.movie_id = m.id
             WHERE movie_fts MATCH ?1
               AND (m.group_id IS NULL OR m.id = (
                     SELECT movie_id FROM video_parts WHERE group_id = m.group_id ORDER BY part_number LIMIT 1
                 ))
             ORDER BY
                CASE
                    WHEN lower(COALESCE(vg.title, m.title)) = ?2 THEN 0
                    WHEN lower(COALESCE(vg.title, m.title)) LIKE ?3 ESCAPE '\\' THEN 1
                    WHEN lower(COALESCE(vg.title, m.title)) LIKE ?4 ESCAPE '\\' THEN 2
                    WHEN lower(COALESCE(vg.actors, m.actors, '')) LIKE ?4 ESCAPE '\\' THEN 3
                    WHEN lower(COALESCE(vg.director, m.director, '')) LIKE ?4 ESCAPE '\\' THEN 4
                    ELSE 5
                END,
                bm25(movie_fts, 8.0, 1.0, 3.0, 2.0),
                m.added_at DESC,
                m.id DESC
             LIMIT ?5 OFFSET ?6"
        )?;

        let movies = stmt.query_map(
            params![
                fts_query,
                normalized_query,
                title_prefix_pattern,
                contains_pattern,
                limit,
                offset
            ],
            map_movie_row,
        )?;

        let result: Result<Vec<Movie>, rusqlite::Error> = movies.collect();

        let elapsed = start_time.elapsed();
        debug!(
            "[数据库] 搜索完成: {} 条结果，耗时: {}ms",
            result.as_ref().map(|r| r.len()).unwrap_or(0),
            elapsed.as_millis()
        );

        result
    }

    pub fn update_thumbnail_path(&self, movie_id: i64, thumbnail_path: &str) -> Result<()> {
        debug!(
            "[数据库] 更新缩略图路径: movie_id={}, path={}",
            movie_id, thumbnail_path
        );

        self.conn.execute(
            "UPDATE movies SET thumbnail_path = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![thumbnail_path, movie_id],
        )?;

        info!("[数据库] 缩略图路径更新成功: movie_id={}", movie_id);

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_movie_metadata(
        &self,
        movie_id: i64,
        title: &str,
        year: Option<i32>,
        plot: Option<&str>,
        rating: Option<f64>,
        genres: Option<&str>,
        director: Option<&str>,
        actors: Option<&str>,
        file_size: Option<i64>,
    ) -> Result<bool> {
        debug!(
            "[数据库] 更新电影元数据: movie_id={}, title={}",
            movie_id, title
        );
        let rating = sanitize_rating(rating);

        let changed = self.conn.execute(
            "UPDATE movies SET title = ?1, year = ?2, plot = ?3, rating = COALESCE(movies.rating, ?4),
              genres = ?5, director = ?6, actors = ?7, file_size = ?8,
              last_checked_at = CURRENT_TIMESTAMP, scan_state = 'checked',
              updated_at = CURRENT_TIMESTAMP WHERE id = ?9 AND (
                 title IS NOT ?1 OR year IS NOT ?2 OR plot IS NOT ?3 OR
                 (rating IS NULL AND ?4 IS NOT NULL) OR genres IS NOT ?5 OR
                 director IS NOT ?6 OR actors IS NOT ?7 OR file_size IS NOT ?8
              )",
            params![title, year, plot, rating, genres, director, actors, file_size, movie_id],
        )?;

        if changed > 0 {
            debug!("[数据库] 电影元数据更新成功: movie_id={}", movie_id);
        } else {
            debug!("[数据库] 电影元数据无变化: movie_id={}", movie_id);
        }

        Ok(changed > 0)
    }

    /// Same semantics as [`Database::update_movie_metadata`], but all rows are applied
    /// in one transaction. The caller is expected to chunk large passes so the
    /// surrounding mutex is released between batches.
    pub fn batch_update_movie_metadata(&self, rows: &[MovieUpdateRow]) -> Result<usize> {
        if rows.is_empty() {
            return Ok(0);
        }

        let tx = self.conn.unchecked_transaction()?;
        let mut changed_total = 0usize;

        {
            let mut stmt = tx.prepare(
                "UPDATE movies SET title = ?1, year = ?2, plot = ?3, rating = COALESCE(movies.rating, ?4),
                  genres = ?5, director = ?6, actors = ?7, file_size = ?8,
                  last_checked_at = CURRENT_TIMESTAMP, scan_state = 'checked',
                  updated_at = CURRENT_TIMESTAMP WHERE id = ?9 AND (
                     title IS NOT ?1 OR year IS NOT ?2 OR plot IS NOT ?3 OR
                     (rating IS NULL AND ?4 IS NOT NULL) OR genres IS NOT ?5 OR
                     director IS NOT ?6 OR actors IS NOT ?7 OR file_size IS NOT ?8
                  )",
            )?;

            for row in rows {
                let rating = sanitize_rating(row.4);
                let changed = stmt.execute(params![
                    &row.1, row.2, &row.3, rating, &row.5, &row.6, &row.7, row.8, row.0
                ])?;
                changed_total += changed;
            }
        }

        tx.commit()?;

        debug!(
            "[数据库] 批量更新电影元数据: {} 条记录，{} 条有变化",
            rows.len(),
            changed_total
        );

        Ok(changed_total)
    }

    pub fn get_all_file_paths(&self) -> Result<Vec<(i64, String)>> {
        debug!("[数据库] 获取所有文件路径");
        let mut stmt = self.conn.prepare("SELECT id, file_path FROM movies")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect()
    }

    pub fn clear_all_thumbnail_paths(&self) -> Result<()> {
        info!("[数据库] 清空所有缩略图路径");

        self.conn.execute(
            "UPDATE movies SET thumbnail_path = NULL, updated_at = CURRENT_TIMESTAMP",
            [],
        )?;

        Ok(())
    }

    pub fn update_video_info(
        &self,
        movie_id: i64,
        duration_seconds: Option<i64>,
        width: Option<i32>,
        height: Option<i32>,
    ) -> Result<()> {
        debug!(
            "[数据库] 更新视频信息: movie_id={}, duration={:?}, width={:?}, height={:?}",
            movie_id, duration_seconds, width, height
        );

        self.conn.execute(
            "UPDATE movies SET duration_seconds = ?1, width = ?2, height = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
            params![duration_seconds, width, height, movie_id],
        )?;

        info!("[数据库] 视频信息更新成功: movie_id={}", movie_id);

        Ok(())
    }

    pub fn set_watched_status(&self, movie_id: i64, is_watched: bool) -> Result<()> {
        debug!(
            "[数据库] 设置观看状态: movie_id={}, is_watched={}",
            movie_id, is_watched
        );

        self.conn.execute(
            "UPDATE movies SET is_watched = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![if is_watched { 1 } else { 0 }, movie_id],
        )?;

        info!(
            "[数据库] 观看状态更新成功: movie_id={}, is_watched={}",
            movie_id, is_watched
        );

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
            },
        );

        match result {
            Ok(history) => {
                debug!(
                    "[数据库] 播放历史查询成功: movie_id={}, last_position={}s",
                    history.movie_id, history.last_position
                );
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
        debug!(
            "[数据库] 更新播放历史: movie_id={}, position={}s",
            movie_id, position
        );

        let existing = self.get_play_history(movie_id)?;

        if let Some(_history) = existing {
            self.conn.execute(
                "UPDATE play_history SET last_position = ?1, last_played = CURRENT_TIMESTAMP 
                 WHERE movie_id = ?2",
                params![position, movie_id],
            )?;
            debug!("[数据库] 播放历史更新成功: movie_id={}", movie_id);
        } else {
            self.conn.execute(
                "INSERT INTO play_history (movie_id, last_position) VALUES (?1, ?2)",
                params![movie_id, position],
            )?;
            debug!("[数据库] 播放历史插入成功: movie_id={}", movie_id);
        }

        Ok(())
    }

    pub fn increment_play_count(&self, movie_id: i64) -> Result<()> {
        debug!("[数据库] 增加播放次数: movie_id={}", movie_id);

        let existing = self.get_play_history(movie_id)?;

        if let Some(history) = existing {
            self.conn.execute(
                "UPDATE play_history SET play_count = ?1, last_played = CURRENT_TIMESTAMP 
                 WHERE movie_id = ?2",
                params![history.play_count + 1, movie_id],
            )?;
            debug!(
                "[数据库] 播放次数更新成功: movie_id={}, play_count={}",
                movie_id,
                history.play_count + 1
            );
        } else {
            self.conn.execute(
                "INSERT INTO play_history (movie_id, last_position, play_count) VALUES (?1, 0, 1)",
                params![movie_id],
            )?;
            debug!(
                "[数据库] 播放历史创建成功: movie_id={}, play_count=1",
                movie_id
            );
        }

        self.conn.execute(
            "UPDATE movies SET last_accessed = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![movie_id],
        )?;

        Ok(())
    }

    pub fn set_movie_rating(&self, movie_id: i64, rating: Option<f64>) -> Result<()> {
        let rating = sanitize_rating(rating);
        debug!(
            "[数据库] 设置电影评级: movie_id={}, rating={:?}",
            movie_id, rating
        );

        self.conn.execute(
            "UPDATE movies SET rating = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![rating, movie_id],
        )?;

        info!(
            "[数据库] 电影评级设置成功: movie_id={}, rating={:?}",
            movie_id, rating
        );

        Ok(())
    }

    pub fn get_total_count(&self) -> Result<i64> {
        debug!("[数据库] 获取电影总数");

        let count = self
            .conn
            .query_row("SELECT COUNT(*) FROM movies", [], |row| row.get(0));

        match &count {
            Ok(c) => debug!("[数据库] 电影总数: {}", c),
            Err(e) => debug!("[数据库] 获取总数失败: {}", e),
        }

        count
    }

    /// Migrate a movie's file_path (used by watcher when it can prove a rename happened,
    /// so play history / rating / watched state on the existing row are preserved).
    pub fn update_file_path(&self, movie_id: i64, new_path: &str) -> Result<()> {
        let new_path = normalize_path_str(new_path);
        debug!(
            "[数据库] 更新文件路径: id={}, new_path={}",
            movie_id, new_path
        );

        self.conn.execute(
            "UPDATE movies SET file_path = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![new_path, movie_id],
        )?;

        info!("[数据库] 文件路径迁移成功: id={}", movie_id);
        Ok(())
    }

    pub fn delete_movie_by_path(&self, file_path: &str) -> Result<()> {
        let file_path = normalize_path_str(file_path);
        debug!("[数据库] 删除电影: file_path={}", file_path);

        self.conn.execute(
            "DELETE FROM movies WHERE file_path = ?1",
            params![file_path],
        )?;

        info!("[数据库] 电影删除成功: {}", file_path);

        Ok(())
    }

    pub fn delete_invalid_records(&self) -> Result<usize> {
        info!("[数据库] 开始删除失效记录");

        // Phase 1: collect invalid IDs (read-only)
        let mut invalid_ids: Vec<i64> = Vec::new();
        {
            let mut stmt = self.conn.prepare("SELECT id, file_path FROM movies")?;
            let mut rows = stmt.query([])?;

            while let Ok(Some(row)) = rows.next() {
                let id: i64 = row.get(0)?;
                let file_path: String = row.get(1)?;

                let path = std::path::Path::new(&file_path);
                if !path.exists() {
                    debug!("[数据库] 发现失效记录: id={}, file_path={}", id, file_path);
                    invalid_ids.push(id);
                }
            }
        }

        // Phase 2: batch delete in a transaction
        let invalid_count = invalid_ids.len();
        if !invalid_ids.is_empty() {
            let tx = self.conn.unchecked_transaction()?;
            for id in &invalid_ids {
                tx.execute("DELETE FROM movies WHERE id = ?1", params![id])?;
            }
            tx.commit()?;
        }

        info!("[数据库] 删除失效记录完成: {} 条", invalid_count);

        Ok(invalid_count)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_movies_with_filters(
        &self,
        offset: i32,
        limit: i32,
        search_query: Option<String>,
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
        debug!("[数据库] 获取筛选电影列表: offset={}, limit={}, query={:?}, filters={:?}, sort={:?} {:?}",
               offset, limit, search_query, (min_year, max_year, min_rating, max_rating, &actors, &genres, is_watched), sort_by, sort_order);

        let mut where_clauses = Vec::new();
        let mut joins = vec![
            "LEFT JOIN video_groups vg ON m.group_id = vg.id".to_string(),
            "LEFT JOIN play_history ph ON ph.movie_id = m.id".to_string(),
        ];
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let mut order_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let mut order_clause = String::new();

        let normalized_search_query = search_query.as_deref().and_then(normalize_search_query);

        if let Some(query) = normalized_search_query.as_deref() {
            if let Some(fts_query) = build_fts_query(query) {
                joins.insert(0, "JOIN movie_fts ON movie_fts.rowid = m.id".to_string());
                where_clauses.push("movie_fts MATCH ?".to_string());
                params.push(Box::new(fts_query));

                let exact_match = query.to_string();
                let title_prefix_pattern = format!("{}%", escape_like_pattern(query));
                let contains_pattern = format!("%{}%", escape_like_pattern(query));
                let relevance_clause = "CASE
                    WHEN lower(COALESCE(vg.title, m.title)) = ? THEN 0
                    WHEN lower(COALESCE(vg.title, m.title)) LIKE ? ESCAPE '\\' THEN 1
                    WHEN lower(COALESCE(vg.title, m.title)) LIKE ? ESCAPE '\\' THEN 2
                    WHEN lower(COALESCE(vg.actors, m.actors, '')) LIKE ? ESCAPE '\\' THEN 3
                    WHEN lower(COALESCE(vg.director, m.director, '')) LIKE ? ESCAPE '\\' THEN 4
                    ELSE 5
                END";
                let bm25_clause = "bm25(movie_fts, 8.0, 1.0, 3.0, 2.0)";
                let (sorted_col, sort_dir) =
                    resolve_sort_clause(sort_by.as_deref(), sort_order.as_deref());
                let prefers_relevance = sort_by
                    .as_deref()
                    .map(|value| value == "added_at")
                    .unwrap_or(true);
                let is_rating_sort = sort_by.as_deref().map(|v| v == "rating").unwrap_or(false);

                let nulls = nulls_last_suffix(sort_by.as_deref());
                if prefers_relevance {
                    order_clause = format!(
                        "{}, {}, {} {}{}, m.id DESC",
                        relevance_clause, bm25_clause, sorted_col, sort_dir, nulls
                    );
                } else if is_rating_sort {
                    order_clause = format!(
                        "{} {}, m.added_at {}, {}, {}, m.id DESC",
                        sorted_col, sort_dir, sort_dir, relevance_clause, bm25_clause
                    );
                } else {
                    order_clause = format!(
                        "{} {}{}, {}, {}, m.id DESC",
                        sorted_col, sort_dir, nulls, relevance_clause, bm25_clause
                    );
                }

                order_params.push(Box::new(exact_match));
                order_params.push(Box::new(title_prefix_pattern.clone()));
                order_params.push(Box::new(contains_pattern.clone()));
                order_params.push(Box::new(contains_pattern.clone()));
                order_params.push(Box::new(contains_pattern));
            }
        }

        if let Some(min_y) = min_year {
            where_clauses.push("COALESCE(vg.year, m.year) >= ?".to_string());
            params.push(Box::new(min_y));
        }

        if let Some(max_y) = max_year {
            where_clauses.push("COALESCE(vg.year, m.year) <= ?".to_string());
            params.push(Box::new(max_y));
        }

        if let Some(min_r) = min_rating {
            where_clauses.push("COALESCE(vg.rating, m.rating) >= ?".to_string());
            params.push(Box::new(min_r));
        }

        if let Some(max_r) = max_rating {
            where_clauses.push("COALESCE(vg.rating, m.rating) <= ?".to_string());
            params.push(Box::new(max_r));
        }

        if let Some(ref actors_str) = actors {
            if !actors_str.is_empty() {
                where_clauses
                    .push("COALESCE(vg.actors, m.actors, '') LIKE ? ESCAPE '\\'".to_string());
                params.push(Box::new(format!("%{}%", escape_like_pattern(actors_str))));
            }
        }

        if let Some(ref genres_str) = genres {
            if !genres_str.is_empty() {
                where_clauses
                    .push("COALESCE(vg.genres, m.genres, '') LIKE ? ESCAPE '\\'".to_string());
                params.push(Box::new(format!("%{}%", escape_like_pattern(genres_str))));
            }
        }

        if let Some(watched) = is_watched {
            where_clauses.push("m.is_watched = ?".to_string());
            params.push(Box::new(if watched { 1 } else { 0 }));
        }

        let where_clause = if where_clauses.is_empty() {
            "WHERE m.group_id IS NULL OR m.id = (
                 SELECT movie_id FROM video_parts WHERE group_id = m.group_id ORDER BY part_number LIMIT 1
             )".to_string()
        } else {
            format!("WHERE ({}) AND (m.group_id IS NULL OR m.id = (
                 SELECT movie_id FROM video_parts WHERE group_id = m.group_id ORDER BY part_number LIMIT 1
             ))", where_clauses.join(" AND "))
        };

        if order_clause.is_empty() {
            order_clause = build_order_clause(sort_by.as_deref(), sort_order.as_deref());
        }

        let join_clause = joins.join("\n             ");

        let query = format!(
            "SELECT m.id, m.file_path, 
                    COALESCE(vg.title, m.title) as title, 
                    COALESCE(vg.year, m.year) as year, 
                    COALESCE(vg.plot, m.plot) as plot, 
                    COALESCE(vg.rating, m.rating) as rating, 
                    COALESCE(vg.genres, m.genres) as genres, 
                    COALESCE(vg.director, m.director) as director, 
                    COALESCE(vg.actors, m.actors) as actors, 
                    COALESCE(vg.poster_path, m.thumbnail_path) as thumbnail_path, 
                    m.file_size, 
                     COALESCE(vg.total_duration, m.duration_seconds) as duration_seconds,
                     m.width, m.height, m.added_at, m.updated_at, m.last_accessed, m.last_checked_at, m.scan_state, m.is_watched, m.group_id,
                     COALESCE(ph.play_count, 0) as play_count
              FROM movies m
             {}
              {}
             ORDER BY {}
              LIMIT ? OFFSET ?",
             join_clause, where_clause, order_clause
        );

        params.extend(order_params);
        params.push(Box::new(limit));
        params.push(Box::new(offset));

        let mut stmt = self.conn.prepare(&query)?;

        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let movies = stmt.query_map(param_refs.as_slice(), map_movie_row)?;

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
            "SELECT DISTINCT genres FROM movies WHERE genres IS NOT NULL AND genres != ''",
        )?;

        let genres_iter = stmt.query_map([], |row| {
            let genres_str: String = row.get(0)?;
            Ok(genres_str)
        })?;

        let mut all_genres: HashSet<String> = HashSet::new();
        for genres_str in genres_iter.flatten() {
            for genre in genres_str.split(',') {
                let genre = genre.trim();
                if !genre.is_empty() {
                    all_genres.insert(genre.to_string());
                }
            }
        }

        let mut all_genres: Vec<String> = all_genres.into_iter().collect();
        all_genres.sort();
        debug!("[数据库] 获取类型成功: {} 个类型", all_genres.len());

        Ok(all_genres)
    }

    pub fn get_unique_actors(&self) -> Result<Vec<String>> {
        debug!("[数据库] 获取所有演员");

        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT actors FROM movies WHERE actors IS NOT NULL AND actors != ''",
        )?;

        let actors_iter = stmt.query_map([], |row| {
            let actors_str: String = row.get(0)?;
            Ok(actors_str)
        })?;

        let mut all_actors: HashSet<String> = HashSet::new();
        for actors_str in actors_iter.flatten() {
            for actor in actors_str.split(',') {
                let actor = actor.trim();
                if !actor.is_empty() {
                    all_actors.insert(actor.to_string());
                }
            }
        }

        let mut all_actors: Vec<String> = all_actors.into_iter().collect();
        all_actors.sort();
        debug!("[数据库] 获取演员成功: {} 个演员", all_actors.len());

        Ok(all_actors)
    }

    pub fn get_actors_with_counts(&self) -> Result<Vec<crate::models::ActorInfo>> {
        debug!("[数据库] 获取演员及作品数量");

        let mut stmt = self.conn.prepare(
            "SELECT actors, thumbnail_path, rating FROM movies WHERE actors IS NOT NULL AND actors != '' ORDER BY rating DESC NULLS LAST, added_at DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            let actors_str: String = row.get(0)?;
            let thumbnail: Option<String> = row.get(1)?;
            Ok((actors_str, thumbnail))
        })?;

        use std::collections::HashMap;
        let mut actor_map: HashMap<String, (i64, Option<String>)> = HashMap::new();

        for (actors_str, thumbnail) in rows.flatten() {
            for actor in actors_str.split(',') {
                let actor = actor.trim().to_string();
                if actor.is_empty() {
                    continue;
                }
                let entry = actor_map.entry(actor).or_insert((0, None));
                entry.0 += 1;
                // Keep the first (highest-rated) thumbnail as representative
                if entry.1.is_none() {
                    entry.1 = thumbnail.clone();
                }
            }
        }

        let mut actors: Vec<crate::models::ActorInfo> = actor_map
            .into_iter()
            .map(
                |(name, (movie_count, representative_thumbnail))| crate::models::ActorInfo {
                    name,
                    movie_count,
                    representative_thumbnail,
                },
            )
            .collect();

        // Sort by movie count descending, then name ascending
        actors.sort_by(|a, b| b.movie_count.cmp(&a.movie_count).then(a.name.cmp(&b.name)));

        debug!("[数据库] 获取演员成功: {} 个演员", actors.len());

        Ok(actors)
    }

    pub fn clear_all_movies(&self) -> Result<()> {
        info!("[数据库] 清空所有电影数据");

        self.conn.execute("DELETE FROM movies", [])?;
        self.conn.execute("DELETE FROM play_history", [])?;
        self.conn.execute("DELETE FROM video_parts", [])?;
        self.conn.execute("DELETE FROM video_groups", [])?;

        info!("[数据库] 所有电影数据已清空");

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use unicode_normalization::UnicodeNormalization;

    /// Unique temp path per test; the DB file is removed before use.
    fn temp_db_path(name: &str) -> String {
        let path =
            std::env::temp_dir().join(format!("reelfs_test_{}_{}.db", std::process::id(), name));
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{}", path.display(), suffix));
        }
        path.to_string_lossy().to_string()
    }

    fn insert_movie(conn: &Connection, path: &str, title: &str) {
        conn.execute(
            "INSERT INTO movies (file_path, title) VALUES (?1, ?2)",
            params![path, title],
        )
        .unwrap();
    }

    #[test]
    fn pragmas_are_applied_at_open() {
        let path = temp_db_path("pragmas");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        let busy_timeout: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();

        assert_eq!(journal_mode.to_lowercase(), "wal");
        assert_eq!(busy_timeout, 10_000);
        assert_eq!(foreign_keys, 1);
    }

    #[test]
    fn foreign_key_cascade_deletes_dependents() {
        let path = temp_db_path("cascade");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        insert_movie(conn, "/nas/a/movie.mkv", "A");
        let movie_id: i64 = conn
            .query_row("SELECT id FROM movies WHERE title = 'A'", [], |row| {
                row.get(0)
            })
            .unwrap();
        conn.execute(
            "INSERT INTO play_history (movie_id, last_position) VALUES (?1, 12.0)",
            params![movie_id],
        )
        .unwrap();

        conn.execute("DELETE FROM movies WHERE id = ?1", params![movie_id])
            .unwrap();

        let orphans: i64 = conn
            .query_row("SELECT COUNT(*) FROM play_history", [], |row| row.get(0))
            .unwrap();
        assert_eq!(orphans, 0, "play_history row must cascade on movie delete");
    }

    #[test]
    fn unique_genres_and_actors_are_deduped_and_sorted() {
        let path = temp_db_path("unique_terms");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        conn.execute(
            "INSERT INTO movies (file_path, title, genres, actors) VALUES
                ('/nas/1.mkv', 'One', 'Drama, Comedy', 'Alice, Bob'),
                ('/nas/2.mkv', 'Two', 'comedy , Drama', 'bob, Carol')",
            [],
        )
        .unwrap();

        let genres = db.get_unique_genres().unwrap();
        let actors = db.get_unique_actors().unwrap();

        assert_eq!(
            genres,
            vec![
                "Comedy".to_string(),
                "Drama".to_string(),
                "comedy".to_string()
            ]
        );
        assert_eq!(
            actors,
            vec![
                "Alice".to_string(),
                "Bob".to_string(),
                "Carol".to_string(),
                "bob".to_string()
            ]
        );
    }

    #[test]
    fn nfc_migration_merges_duplicate_rows_and_rebinds_dependents() {
        let path = temp_db_path("nfc_merge");
        let nfc_path = "/nas/Café/movie.mkv";
        let nfd_path: String = nfc_path.nfd().collect();

        {
            let db = Database::new(&path).unwrap();
            let conn = db.get_connection();
            insert_movie(conn, &nfd_path, "Duplicate");
            insert_movie(conn, nfc_path, "Keeper");
            conn.execute(
                "INSERT INTO play_history (movie_id, last_position)
                 SELECT id, 42.0 FROM movies WHERE title = 'Duplicate'",
                [],
            )
            .unwrap();
        }

        // Reopening runs the NFC migration pass.
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM movies", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 1, "NFD/NFC duplicates must collapse into one row");

        let rebound: i64 = conn
            .query_row("SELECT COUNT(*) FROM play_history", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rebound, 1, "play_history must survive the merge");

        let dangling = conn
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query_map([], |_| Ok(()))
            .unwrap()
            .count();
        assert_eq!(dangling, 0, "no foreign key violations after the merge");
    }

    /// Covers the FK path flagged in the audit: `movies.group_id` has no
    /// `ON DELETE` action, so deleting a group while a movie still references it
    /// would fail once `foreign_keys=ON`. Also asserts the schema stays clean.
    #[test]
    fn deleting_video_group_leaves_no_foreign_key_violations() {
        use crate::video_group::VideoGroupManager;

        let path = temp_db_path("fk_group_delete");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        insert_movie(conn, "/nas/group/part1.mkv", "Part 1");
        insert_movie(conn, "/nas/group/part2.mkv", "Part 2");
        let ids: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM movies ORDER BY id").unwrap();
            let rows = stmt.query_map([], |row| row.get::<_, i64>(0)).unwrap();
            rows.map(|r| r.unwrap()).collect()
        };

        let manager = VideoGroupManager::new(conn);
        let group_id = manager
            .create_video_group("Trilogy", None, None, None, None, None, None, None)
            .unwrap();
        manager
            .add_video_part(group_id, ids[0], 1, Some("Part 1"))
            .unwrap();
        manager
            .add_video_part(group_id, ids[1], 2, Some("Part 2"))
            .unwrap();

        manager.delete_video_group(group_id).unwrap();

        let violations: Vec<String> = conn
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert!(
            violations.is_empty(),
            "foreign key violations: {:?}",
            violations
        );

        let still_grouped: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM movies WHERE group_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            still_grouped, 0,
            "movies.group_id must be cleared on group delete"
        );
    }

    #[test]
    fn nfc_migration_cost_on_large_library() {
        let path = temp_db_path("nfc_timing");
        const ROWS: i64 = 10_000;

        {
            let db = Database::new(&path).unwrap();
            let conn = db.get_connection();
            let tx = conn.unchecked_transaction().unwrap();
            for i in 0..ROWS {
                tx.execute(
                    "INSERT INTO movies (file_path, title) VALUES (?1, ?2)",
                    params![
                        format!("/nas/library/movie-{:05}.mkv", i),
                        format!("Movie {}", i)
                    ],
                )
                .unwrap();
            }
            tx.commit().unwrap();
        }

        let started = std::time::Instant::now();
        let _db = Database::new(&path).unwrap();
        let elapsed = started.elapsed();

        println!(
            "migrate_path_nfc over {} rows (reopen): {:?}",
            ROWS, elapsed
        );
        assert!(
            elapsed < std::time::Duration::from_secs(5),
            "reopening a {}-row library took {:?}",
            ROWS,
            elapsed
        );
    }

    // ---- SQL-construction pure functions ----

    #[test]
    fn build_fts_query_appends_prefix_wildcards() {
        assert_eq!(
            build_fts_query("the matrix").as_deref(),
            Some("the* matrix*")
        );
        assert_eq!(build_fts_query("a.b c").as_deref(), Some("a* b* c*"));
        // CJK survives: unicode61 treats the run as one token.
        assert_eq!(build_fts_query("流浪地球").as_deref(), Some("流浪地球*"));
    }

    #[test]
    fn build_fts_query_returns_none_without_alphanumerics() {
        assert_eq!(build_fts_query(""), None);
        assert_eq!(build_fts_query("!!! --- ???"), None);
        assert_eq!(build_fts_query("   "), None);
    }

    #[test]
    fn normalize_search_query_collapses_whitespace_and_lowercases() {
        assert_eq!(
            normalize_search_query("  The   MATRIX ").as_deref(),
            Some("the matrix")
        );
        assert_eq!(normalize_search_query("Matrix").as_deref(), Some("matrix"));
        assert_eq!(normalize_search_query(""), None);
        assert_eq!(normalize_search_query("   "), None);
    }

    #[test]
    fn escape_like_pattern_escapes_sql_wildcards() {
        assert_eq!(escape_like_pattern("plain"), "plain");
        assert_eq!(escape_like_pattern("50%_off\\x"), "50\\%\\_off\\\\x");
    }

    #[test]
    fn resolve_sort_clause_maps_columns_and_defaults() {
        assert_eq!(resolve_sort_clause(None, None), ("m.added_at", "DESC"));
        assert_eq!(
            resolve_sort_clause(Some("title"), Some("asc")),
            ("COALESCE(vg.title, m.title)", "ASC")
        );
        assert_eq!(
            resolve_sort_clause(Some("year"), None),
            ("COALESCE(vg.year, m.year)", "DESC")
        );
        assert_eq!(
            resolve_sort_clause(Some("rating"), Some("desc")),
            ("COALESCE(vg.rating, m.rating)", "DESC")
        );
        assert_eq!(
            resolve_sort_clause(Some("duration_seconds"), Some("ASC")),
            ("COALESCE(vg.total_duration, m.duration_seconds)", "ASC")
        );
        assert_eq!(
            resolve_sort_clause(Some("last_accessed"), None),
            ("m.last_accessed", "DESC")
        );
        assert_eq!(
            resolve_sort_clause(Some("play_count"), None),
            ("COALESCE(ph.play_count, 0)", "DESC")
        );
        // Unknown values fall back to the defaults instead of erroring.
        assert_eq!(
            resolve_sort_clause(Some("hacker_column; DROP"), Some("sideways")),
            ("m.added_at", "DESC")
        );
    }

    #[test]
    fn nulls_last_and_order_clause_shape() {
        assert_eq!(nulls_last_suffix(Some("year")), " NULLS LAST");
        assert_eq!(nulls_last_suffix(Some("last_accessed")), " NULLS LAST");
        assert_eq!(nulls_last_suffix(Some("rating")), "");
        assert_eq!(nulls_last_suffix(None), "");

        assert_eq!(
            build_order_clause(Some("year"), Some("ASC")),
            "COALESCE(vg.year, m.year) ASC NULLS LAST, m.id DESC"
        );
        assert_eq!(build_order_clause(None, None), "m.added_at DESC, m.id DESC");
        // Rating sort adds the added_at tie-break twice (same direction).
        assert_eq!(
            build_order_clause(Some("rating"), Some("ASC")),
            "COALESCE(vg.rating, m.rating) ASC, m.added_at ASC, m.id DESC"
        );
    }

    #[test]
    fn sanitize_rating_accepts_only_the_documented_range() {
        assert_eq!(sanitize_rating(Some(3.5)), Some(3.5));
        assert_eq!(sanitize_rating(Some(0.0)), Some(0.0));
        assert_eq!(sanitize_rating(Some(5.0)), Some(5.0));
        assert_eq!(sanitize_rating(Some(-0.1)), None);
        assert_eq!(sanitize_rating(Some(5.1)), None);
        assert_eq!(sanitize_rating(Some(f64::NAN)), None);
        assert_eq!(sanitize_rating(None), None);
    }

    // ---- data layer: filters / sort / pagination ----

    fn insert_full_movie(
        conn: &Connection,
        path: &str,
        title: &str,
        year: Option<i32>,
        rating: Option<f64>,
        actors: Option<&str>,
        genres: Option<&str>,
    ) -> i64 {
        conn.execute(
            "INSERT INTO movies (file_path, title, year, rating, actors, genres)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![path, title, year, rating, actors, genres],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn filters_match_year_rating_and_pagination_is_stable() {
        let path = temp_db_path("filters_year_rating");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        insert_full_movie(
            conn,
            "/nas/1.mkv",
            "Old Low",
            Some(1990),
            Some(6.2),
            None,
            None,
        );
        insert_full_movie(
            conn,
            "/nas/2.mkv",
            "Old High",
            Some(1995),
            Some(4.0),
            None,
            None,
        );
        insert_full_movie(
            conn,
            "/nas/3.mkv",
            "New High",
            Some(2020),
            Some(4.5),
            None,
            None,
        );
        insert_full_movie(conn, "/nas/4.mkv", "No Year", None, Some(4.1), None, None);

        let by_year = db
            .get_movies_with_filters(
                0,
                50,
                None,
                Some(1991),
                Some(2021),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap();
        let mut titles: Vec<&str> = by_year.iter().map(|m| m.title.as_str()).collect();
        titles.sort_unstable();
        assert_eq!(
            titles,
            vec!["New High", "Old High"],
            "year window must be inclusive"
        );

        let by_rating = db
            .get_movies_with_filters(
                0,
                50,
                None,
                None,
                None,
                Some(4.0),
                Some(5.0),
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap();
        assert_eq!(by_rating.len(), 3, "6.2 is outside [4.0, 5.0]");

        // Pagination: stable added_at DESC, id DESC order; page through in slices of 2.
        let page1 = db
            .get_movies_with_filters(
                0, 2, None, None, None, None, None, None, None, None, None, None,
            )
            .unwrap();
        let page2 = db
            .get_movies_with_filters(
                2, 2, None, None, None, None, None, None, None, None, None, None,
            )
            .unwrap();
        let page3 = db
            .get_movies_with_filters(
                4, 2, None, None, None, None, None, None, None, None, None, None,
            )
            .unwrap();

        let mut all: Vec<i64> = page1
            .iter()
            .chain(&page2)
            .chain(&page3)
            .map(|m| m.id)
            .collect();
        assert_eq!(all.len(), 4, "pages must tile the library without overlap");
        all.sort_unstable();
        all.dedup();
        assert_eq!(all.len(), 4, "pages must not repeat rows");
    }

    #[test]
    fn filters_match_actors_genres_and_watched() {
        let path = temp_db_path("filters_terms");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        let a = insert_full_movie(
            conn,
            "/nas/a.mkv",
            "Sci-Fi Flick",
            Some(2000),
            None,
            Some("Keanu Reeves, Bob"),
            Some("Action, Sci-Fi"),
        );
        let b = insert_full_movie(
            conn,
            "/nas/b.mkv",
            "Drama Piece",
            Some(2001),
            None,
            Some("Alice"),
            Some("Drama"),
        );
        insert_full_movie(
            conn,
            "/nas/c.mkv",
            "Wildcard % Movie",
            Some(2002),
            None,
            Some("100%_sure"),
            Some("Comedy"),
        );

        let keanu = db
            .get_movies_with_filters(
                0,
                50,
                None,
                None,
                None,
                None,
                None,
                Some("Keanu".into()),
                None,
                None,
                None,
                None,
            )
            .unwrap();
        assert_eq!(keanu.len(), 1);
        assert_eq!(keanu[0].title, "Sci-Fi Flick");

        let drama = db
            .get_movies_with_filters(
                0,
                50,
                None,
                None,
                None,
                None,
                None,
                None,
                Some("Drama".into()),
                None,
                None,
                None,
            )
            .unwrap();
        assert_eq!(
            drama.len(),
            1,
            "'Drama' must not match 'Sci-Fi' via LIKE quirks"
        );
        assert_eq!(drama[0].title, "Drama Piece");

        // LIKE metacharacters in filter terms are escaped, not wildcards.
        let percent = db
            .get_movies_with_filters(
                0,
                50,
                None,
                None,
                None,
                None,
                None,
                Some("%_".into()),
                None,
                None,
                None,
                None,
            )
            .unwrap();
        assert_eq!(percent.len(), 1);
        assert_eq!(percent[0].title, "Wildcard % Movie");

        db.set_watched_status(a, true).unwrap();
        let watched = db
            .get_movies_with_filters(
                0,
                50,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(true),
            )
            .unwrap();
        assert_eq!(watched.len(), 1);
        assert_eq!(watched[0].id, a);

        let unwatched = db
            .get_movies_with_filters(
                0,
                50,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(false),
            )
            .unwrap();
        assert_eq!(unwatched.len(), 2);
        assert!(unwatched.iter().all(|m| m.id != a));
        let _ = b;
    }

    #[test]
    fn year_sort_ascending_pushes_null_years_last() {
        let path = temp_db_path("sort_nulls_last");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        insert_full_movie(conn, "/nas/n.mkv", "No Year", None, None, None, None);
        insert_full_movie(conn, "/nas/old.mkv", "Old", Some(1977), None, None, None);
        insert_full_movie(conn, "/nas/new.mkv", "New", Some(2019), None, None, None);

        let sorted = db
            .get_movies_with_filters(
                0,
                50,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some("year".into()),
                Some("ASC".into()),
                None,
            )
            .unwrap();
        let titles: Vec<&str> = sorted.iter().map(|m| m.title.as_str()).collect();
        assert_eq!(
            titles,
            vec!["Old", "New", "No Year"],
            "ASC must keep NULL years at the bottom"
        );
    }

    #[test]
    fn search_filter_and_fts_agree_with_search_movies() {
        let path = temp_db_path("filters_search");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        insert_full_movie(conn, "/nas/m1.mkv", "Matrix", Some(1999), None, None, None);
        insert_full_movie(
            conn,
            "/nas/m2.mkv",
            "Matrix Reloaded",
            Some(2003),
            None,
            None,
            None,
        );
        insert_full_movie(
            conn,
            "/nas/m3.mkv",
            "Notebook",
            Some(2004),
            None,
            None,
            None,
        );

        let via_filters = db
            .get_movies_with_filters(
                0,
                50,
                Some("matrix".into()),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap();
        let via_search = db.search_movies("matrix", 0, 50).unwrap();

        let mut a: Vec<&str> = via_filters.iter().map(|m| m.title.as_str()).collect();
        let mut b: Vec<&str> = via_search.iter().map(|m| m.title.as_str()).collect();
        a.sort_unstable();
        b.sort_unstable();
        assert_eq!(a, vec!["Matrix", "Matrix Reloaded"]);
        assert_eq!(a, b, "both entry points must return the same matches");
    }

    // ---- data layer: search ranking ----

    #[test]
    fn search_movies_ranks_exact_title_first() {
        let path = temp_db_path("search_rank");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        insert_movie(conn, "/nas/reloaded.mkv", "Matrix Reloaded");
        insert_movie(conn, "/nas/exact.mkv", "Matrix");
        // Post-hoc updates on FTS-indexed columns are safe since the sync
        // triggers moved to the 'delete' command form (see fts_sync tests).
        conn.execute(
            "INSERT INTO movies (file_path, title, actors) VALUES (?1, ?2, ?3)",
            params!["/nas/other.mkv", "Other Movie", "Keanu Matrix"],
        )
        .unwrap();

        let results = db.search_movies("matrix", 0, 50).unwrap();
        let titles: Vec<&str> = results.iter().map(|m| m.title.as_str()).collect();
        assert_eq!(
            titles,
            vec!["Matrix", "Matrix Reloaded", "Other Movie"],
            "exact title > title prefix > actor containment"
        );

        // Prefix queries reach partially-typed words — across title AND actors
        // ("Keanu Matrix" on the third movie), since FTS indexes both columns.
        let prefix = db.search_movies("matri", 0, 50).unwrap();
        assert_eq!(prefix.len(), 3, "prefix 'matri*' must match all three rows");
    }

    #[test]
    fn search_movies_pagination_and_cjk() {
        let path = temp_db_path("search_paging");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        for i in 0..3 {
            insert_movie(conn, &format!("/nas/{}.mkv", i), &format!("Matrix {}", i));
        }
        insert_movie(conn, "/nas/cjk.mkv", "流浪地球");

        let page = db.search_movies("matrix", 1, 2).unwrap();
        assert_eq!(page.len(), 2, "limit/offset must apply");

        let cjk = db.search_movies("流浪", 0, 50).unwrap();
        assert_eq!(cjk.len(), 1);
        assert_eq!(cjk[0].title, "流浪地球");
    }

    #[test]
    fn search_movies_empty_or_unmatchable_queries_return_empty() {
        let path = temp_db_path("search_empty");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();
        insert_movie(conn, "/nas/a.mkv", "Matrix");

        assert!(
            db.search_movies("", 0, 50).unwrap().is_empty(),
            "blank query short-circuits"
        );
        assert!(
            db.search_movies("!!!", 0, 50).unwrap().is_empty(),
            "no tokens -> no query"
        );
        assert!(db
            .search_movies("nonexistentword", 0, 50)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn fts_sync_triggers_survive_update_null_transition_and_delete() {
        let path = temp_db_path("fts_sync_triggers");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();
        insert_movie(conn, "/nas/a.mkv", "Old Title");

        // NULL -> value on an indexed column used to fail the whole
        // statement with "database disk image is malformed".
        conn.execute(
            "UPDATE movies SET actors = 'Keanu Reeves' WHERE title = 'Old Title'",
            [],
        )
        .unwrap();
        assert_eq!(
            db.search_movies("keanu", 0, 50).unwrap().len(),
            1,
            "NULL->value update must be indexed"
        );

        // value -> value must not leave the old token searchable.
        conn.execute(
            "UPDATE movies SET title = 'New Title' WHERE title = 'Old Title'",
            [],
        )
        .unwrap();
        assert!(
            db.search_movies("old", 0, 50).unwrap().is_empty(),
            "old token must be gone after a rename"
        );
        assert_eq!(db.search_movies("new", 0, 50).unwrap().len(), 1);

        // Deletes must remove the row from the index.
        conn.execute("DELETE FROM movies WHERE title = 'New Title'", [])
            .unwrap();
        let ghosts: i64 = conn
            .query_row(
                "SELECT count(*) FROM movie_fts WHERE movie_fts MATCH 'new'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ghosts, 0, "deleted row must not linger in the index");
    }

    #[test]
    fn migration_replaces_legacy_fts_triggers_and_rebuilds_index() {
        let path = temp_db_path("fts_legacy_migration");
        {
            let db = Database::new(&path).unwrap();
            let conn = db.get_connection();
            insert_movie(conn, "/nas/ghost.mkv", "Ghost");

            // Recreate the pre-fix trigger shapes and produce the ghost token
            // the legacy DELETE trigger was known to leave behind.
            conn.execute_batch(
                "DROP TRIGGER movies_au;
                 DROP TRIGGER movies_ad;
                 CREATE TRIGGER movies_au AFTER UPDATE ON movies BEGIN
                     UPDATE movie_fts SET
                         title = new.title,
                         plot = new.plot,
                         actors = new.actors,
                         director = new.director
                     WHERE rowid = new.id;
                 END;
                 CREATE TRIGGER movies_ad AFTER DELETE ON movies BEGIN
                     DELETE FROM movie_fts WHERE rowid = old.id;
                 END;",
            )
            .unwrap();
            conn.execute("DELETE FROM movies WHERE title = 'Ghost'", [])
                .unwrap();
            let ghosts: i64 = conn
                .query_row(
                    "SELECT count(*) FROM movie_fts WHERE movie_fts MATCH 'ghost'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(ghosts >= 1, "precondition: legacy triggers leave a ghost");
        }

        // Reopening the database reruns migrate_database, which must replace
        // the legacy triggers and rebuild the index.
        let db = Database::new(&path).unwrap();
        let ghosts: i64 = db
            .get_connection()
            .query_row(
                "SELECT count(*) FROM movie_fts WHERE movie_fts MATCH 'ghost'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ghosts, 0, "migration must flush ghost tokens");

        // And the repaired triggers keep working afterwards.
        let conn = db.get_connection();
        insert_movie(conn, "/nas/b.mkv", "Beta");
        conn.execute("UPDATE movies SET title = 'Gamma' WHERE title = 'Beta'", [])
            .unwrap();
        assert!(db.search_movies("beta", 0, 50).unwrap().is_empty());
        assert_eq!(db.search_movies("gamma", 0, 50).unwrap().len(), 1);
    }

    // ---- data layer: play history ----

    #[test]
    fn play_history_round_trip_insert_update_and_increment() {
        let path = temp_db_path("play_history");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();
        insert_movie(conn, "/nas/ph.mkv", "PH");
        let movie_id: i64 = conn
            .query_row("SELECT id FROM movies WHERE title = 'PH'", [], |row| {
                row.get(0)
            })
            .unwrap();

        assert!(db.get_play_history(movie_id).unwrap().is_none());

        db.update_play_history(movie_id, 42.0).unwrap();
        let h = db.get_play_history(movie_id).unwrap().unwrap();
        assert_eq!(h.last_position, 42.0);
        assert_eq!(h.play_count, 1, "fresh history starts at 1");

        db.update_play_history(movie_id, 84.5).unwrap();
        let h = db.get_play_history(movie_id).unwrap().unwrap();
        assert_eq!(
            h.last_position, 84.5,
            "second update overwrites the position"
        );
        assert_eq!(h.play_count, 1, "position updates must not bump the count");

        db.increment_play_count(movie_id).unwrap();
        db.increment_play_count(movie_id).unwrap();
        let h = db.get_play_history(movie_id).unwrap().unwrap();
        assert_eq!(h.play_count, 3);

        let last_accessed: Option<String> = conn
            .query_row(
                "SELECT last_accessed FROM movies WHERE id = ?1",
                params![movie_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            last_accessed.is_some(),
            "increment must stamp movies.last_accessed"
        );
    }

    #[test]
    fn update_file_path_renames_in_place_and_normalizes() {
        let path = temp_db_path("update_file_path");
        let nfd: String = "Moviénaf".nfd().collect();
        let old_path = format!("/nas/{}.mkv", "old");
        let new_path_nfd = format!("/nas/Café {}/film.mkv", nfd);

        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();
        insert_movie(conn, &old_path, "Keep Me");
        let id: i64 = conn
            .query_row("SELECT id FROM movies WHERE title = 'Keep Me'", [], |row| {
                row.get(0)
            })
            .unwrap();
        conn.execute(
            "INSERT INTO play_history (movie_id, last_position) VALUES (?1, 5.0)",
            params![id],
        )
        .unwrap();

        db.update_file_path(id, &new_path_nfd).unwrap();

        assert!(
            db.get_movie_by_path(&old_path).unwrap().is_none(),
            "old path must be gone"
        );
        let moved = db
            .get_movie_by_path(&new_path_nfd)
            .unwrap()
            .expect("row must live under the new path");
        assert_eq!(moved.id, id, "rename must reuse the row");

        let stored: String = conn
            .query_row(
                "SELECT file_path FROM movies WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        let new_path_nfc: String = new_path_nfd.nfc().collect();
        assert_eq!(stored, new_path_nfc, "update_file_path must store NFC");

        let history: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM play_history WHERE movie_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(history, 1, "play history must survive a rename");
    }

    #[test]
    fn delete_invalid_records_removes_only_rows_whose_file_is_gone() {
        let path = temp_db_path("delete_invalid");
        let db = Database::new(&path).unwrap();
        let conn = db.get_connection();

        let real_dir = std::env::temp_dir().join(format!("reelfs_invalid_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&real_dir);
        std::fs::create_dir_all(&real_dir).unwrap();
        let real_file = real_dir.join("still_here.mkv");
        std::fs::write(&real_file, b"data").unwrap();

        insert_movie(conn, &real_file.to_string_lossy(), "Alive");
        insert_movie(conn, "/nas/vanished/dead.mkv", "Dead");

        let deleted = db.delete_invalid_records().unwrap();
        assert_eq!(deleted, 1, "only the missing file's row may be deleted");
        assert!(db
            .get_movie_by_path(&real_file.to_string_lossy())
            .unwrap()
            .is_some());
        assert!(db
            .get_movie_by_path("/nas/vanished/dead.mkv")
            .unwrap()
            .is_none());

        let _ = std::fs::remove_dir_all(&real_dir);
    }
}
