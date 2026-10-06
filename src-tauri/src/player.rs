use log::{debug, error, info, warn};
use std::process::Command;

pub fn play_movie(file_path: &str, start_position: Option<f64>) -> Result<(), String> {
    info!("[播放器] 开始播放电影: {}", file_path);
    debug!("[播放器] 播放位置: {:?}", start_position);

    #[cfg(target_os = "macos")]
    {
        debug!("[播放器] 检测到macOS平台");

        if let Some(pos) = start_position {
            if pos > 0.0 && command_exists("mpv") {
                debug!("[播放器] 检查播放器: mpv exists=true");
                debug!("[播放器] 使用断点续播: start_from={}s", pos);

                Command::new("mpv")
                    .arg(format!("--start={}", pos))
                    .arg(file_path)
                    .spawn()
                    .map_err(|e| {
                        error!("[播放器] 启动mpv失败: {}", e);
                        format!("Failed to launch mpv: {}", e)
                    })?;

                info!("[播放器] mpv播放器启动成功: {}", file_path);
            } else {
                if pos > 0.0 {
                    debug!("[播放器] 检查播放器: mpv exists=false");
                    warn!("[播放器] mpv未安装，无法使用断点续播");
                }

                Command::new("open").arg(file_path).spawn().map_err(|e| {
                    error!("[播放器] 启动系统播放器失败: {}", e);
                    format!("Failed to open file: {}", e)
                })?;

                info!("[播放器] 系统播放器启动成功: {}", file_path);
            }
        } else {
            Command::new("open").arg(file_path).spawn().map_err(|e| {
                error!("[播放器] 启动系统播放器失败: {}", e);
                format!("Failed to open file: {}", e)
            })?;

            info!("[播放器] 系统播放器启动成功: {}", file_path);
        }
    }

    #[cfg(target_os = "linux")]
    {
        debug!("[播放器] 检测到Linux平台");

        if command_exists("mpv") {
            debug!("[播放器] 检查播放器: mpv exists=true");

            let mut cmd = Command::new("mpv");
            if let Some(pos) = start_position {
                if pos > 0.0 {
                    debug!("[播放器] 使用断点续播: start_from={}s", pos);
                    cmd.arg(format!("--start={}", pos));
                }
            }
            cmd.arg(file_path).spawn().map_err(|e| {
                error!("[播放器] 启动mpv失败: {}", e);
                format!("Failed to launch mpv: {}", e)
            })?;

            info!("[播放器] mpv播放器启动成功: {}", file_path);
        } else {
            debug!("[播放器] 检查播放器: mpv exists=false");
            warn!("[播放器] mpv未安装，使用xdg-open");

            Command::new("xdg-open")
                .arg(file_path)
                .spawn()
                .map_err(|e| {
                    error!("[播放器] 启动xdg-open失败: {}", e);
                    format!("Failed to open file: {}", e)
                })?;

            info!("[播放器] xdg-open启动成功: {}", file_path);
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        error!("[播放器] 不支持的操作系统");
        return Err("Unsupported operating system".to_string());
    }

    Ok(())
}

fn command_exists(command: &str) -> bool {
    #[cfg(unix)]
    {
        Command::new("which")
            .arg(command)
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    #[cfg(windows)]
    {
        Command::new("where")
            .arg(command)
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke test only: play_movie spawns real players (mpv / open / xdg-open),
    /// which cannot be unit-tested without launching GUI processes. This pins
    /// the PATH-probing primitive the mpv resume branch depends on.
    #[test]
    fn command_exists_probes_path() {
        #[cfg(unix)]
        {
            assert!(command_exists("ls"), "which must find ls on any unix box");
        }
        #[cfg(windows)]
        {
            assert!(command_exists("cmd"), "where must find cmd on windows");
        }
        assert!(
            !command_exists("reelfs-definitely-not-a-real-command-424242"),
            "a nonexistent command must not be reported as present"
        );
    }
}
