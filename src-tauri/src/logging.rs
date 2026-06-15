use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const MAX_BACKUPS: usize = 5;

pub fn info(message: impl AsRef<str>) {
    write_log("INFO", message.as_ref());
}

pub fn warn(message: impl AsRef<str>) {
    write_log("WARN", message.as_ref());
}

pub fn error(message: impl AsRef<str>) {
    write_log("ERROR", message.as_ref());
}

fn write_log(level: &str, message: &str) {
    let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC");
    let line = format!("[{timestamp}] [{level}] [RUST] {message}\n");
    eprint!("{line}");

    let Some(path) = log_path() else {
        return;
    };

    if let Some(parent) = path.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            eprintln!(
                "[AxiOwl] Failed to create log directory '{}': {err}",
                parent.display()
            );
            return;
        }
    }

    if let Err(err) = rotate_if_needed(&path) {
        eprintln!("[AxiOwl] Failed to rotate log '{}': {err}", path.display());
    }

    match fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(err) = file.write_all(line.as_bytes()) {
                eprintln!("[AxiOwl] Failed to write log '{}': {err}", path.display());
            }
        }
        Err(err) => eprintln!("[AxiOwl] Failed to open log '{}': {err}", path.display()),
    }
}

fn log_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".codex").join("logs").join("qexow.log"))
}

fn rotate_if_needed(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if metadata.len() < MAX_LOG_BYTES {
        return Ok(());
    }

    for index in (1..=MAX_BACKUPS).rev() {
        let current = backup_path(path, index);
        let next = backup_path(path, index + 1);
        if current.exists() {
            if index == MAX_BACKUPS {
                fs::remove_file(&current).map_err(|err| err.to_string())?;
            } else {
                fs::rename(&current, &next).map_err(|err| err.to_string())?;
            }
        }
    }

    fs::rename(path, backup_path(path, 1)).map_err(|err| err.to_string())?;
    Ok(())
}

fn backup_path(path: &Path, index: usize) -> PathBuf {
    PathBuf::from(format!("{}.{}", path.display(), index))
}
