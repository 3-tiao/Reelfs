use std::process::Command;

pub fn play_movie(file_path: &str, start_position: Option<f64>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(pos) = start_position {
            if pos > 0.0 && command_exists("mpv") {
                Command::new("mpv")
                    .arg(format!("--start={}", pos))
                    .arg(file_path)
                    .spawn()
                    .map_err(|e| format!("Failed to launch mpv: {}", e))?;
            } else {
                Command::new("open")
                    .arg(file_path)
                    .spawn()
                    .map_err(|e| format!("Failed to open file: {}", e))?;
            }
        } else {
            Command::new("open")
                .arg(file_path)
                .spawn()
                .map_err(|e| format!("Failed to open file: {}", e))?;
        }
    }
    
    #[cfg(target_os = "linux")]
    {
        if command_exists("mpv") {
            let mut cmd = Command::new("mpv");
            if let Some(pos) = start_position {
                if pos > 0.0 {
                    cmd.arg(format!("--start={}", pos));
                }
            }
            cmd.arg(file_path)
                .spawn()
                .map_err(|e| format!("Failed to launch mpv: {}", e))?;
        } else {
            Command::new("xdg-open")
                .arg(file_path)
                .spawn()
                .map_err(|e| format!("Failed to open file: {}", e))?;
        }
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
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
