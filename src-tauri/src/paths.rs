use std::{
    ffi::OsStr,
    path::{Component, Path, PathBuf},
};

pub const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub const WORKSPACE_FILE_LIMIT: usize = 50;

const IGNORED_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "__pycache__",
    "dist",
    "target",
    "output",
];

pub fn is_ignored_name(name: &str) -> bool {
    IGNORED_NAMES
        .iter()
        .any(|ignored| ignored.eq_ignore_ascii_case(name))
}

pub fn canonical_dir(path: &Path) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|err| format!("Invalid directory '{}': {err}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!("Path is not a directory: {}", canonical.display()));
    }
    Ok(canonical)
}

pub fn canonical_file(path: &Path) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|err| format!("Invalid file '{}': {err}", path.display()))?;
    if !canonical.is_file() {
        return Err(format!("Path is not a file: {}", canonical.display()));
    }
    Ok(canonical)
}

pub fn validate_existing_file_in_workspace(
    path: &Path,
    workspace: &Path,
) -> Result<PathBuf, String> {
    let canonical_workspace = canonical_dir(workspace)?;
    let canonical_file = canonical_file(path)?;
    if !canonical_file.starts_with(&canonical_workspace) {
        return Err(format!(
            "File is outside the active workspace: {}",
            canonical_file.display()
        ));
    }
    Ok(canonical_file)
}

pub fn validate_writable_file_in_workspace(
    path: &Path,
    workspace: &Path,
) -> Result<PathBuf, String> {
    let canonical_workspace = canonical_dir(workspace)?;
    if path.exists() {
        return validate_existing_file_in_workspace(path, &canonical_workspace);
    }

    let parent = path
        .parent()
        .ok_or_else(|| format!("File path has no parent: {}", path.display()))?;
    let canonical_parent = canonical_dir(parent)?;
    if !canonical_parent.starts_with(&canonical_workspace) {
        return Err(format!(
            "File parent is outside the active workspace: {}",
            canonical_parent.display()
        ));
    }

    let file_name = path
        .file_name()
        .ok_or_else(|| format!("File path has no file name: {}", path.display()))?;
    Ok(canonical_parent.join(file_name))
}

pub fn validate_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err("Path must be relative to the active workspace".to_string());
    }
    if relative_path.trim().is_empty() {
        return Err("Path cannot be empty".to_string());
    }

    for component in path.components() {
        match component {
            Component::Normal(part) if !is_invalid_component(part) => {}
            _ => return Err("Path contains invalid components".to_string()),
        }
    }

    Ok(path.to_path_buf())
}

fn is_invalid_component(component: &OsStr) -> bool {
    component
        .to_str()
        .map(|value| value.trim().is_empty() || value == "." || value == "..")
        .unwrap_or(true)
}

pub fn path_from_args(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .filter(|arg| !arg.starts_with("--"))
        .filter(|arg| arg.as_str() != ".")
        .filter(|arg| {
            let lower = arg.to_ascii_lowercase();
            !(lower.ends_with("axiowl.exe")
                || lower.ends_with("axiowl-desktop.exe")
                || lower.ends_with("axiowl-desktop")
                || lower.ends_with("qexow.exe")
                || lower.ends_with("qexow-desktop.exe")
                || lower.ends_with("qexow-desktop")
                || lower.ends_with("axiowl")
                || lower.ends_with("qexow"))
        })
        .map(PathBuf::from)
        .find(|path| path.exists())
}

pub fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_absolute_relative_paths() {
        let path = if cfg!(windows) {
            "C:\\temp\\a.txt"
        } else {
            "/tmp/a.txt"
        };
        assert!(validate_relative_path(path).is_err());
    }

    #[test]
    fn rejects_parent_dir_components() {
        assert!(validate_relative_path("../secret.txt").is_err());
        assert!(validate_relative_path("safe/../../secret.txt").is_err());
    }

    #[test]
    fn accepts_plain_relative_paths() {
        assert_eq!(
            validate_relative_path("src/main.rs").unwrap(),
            PathBuf::from("src/main.rs")
        );
    }

    #[test]
    fn ignores_desktop_executable_paths_in_args() {
        let args = vec![
            "C:\\Users\\kjhgf\\AppData\\Local\\AxiOwl\\axiowl-desktop.exe".to_string(),
            "--flag".to_string(),
        ];
        assert!(path_from_args(&args).is_none());
    }
}
