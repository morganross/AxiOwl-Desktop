use std::path::PathBuf;

use crate::{
    app_state::AppState,
    dto::FilePayload,
    events::{self, AppEvent},
    paths::{self, MAX_TEXT_FILE_BYTES},
    workspace_store::{self, WorkspaceStore},
};

pub fn read_file(state: &AppState, path: String) -> Result<FilePayload, String> {
    let store = workspace_store::local();
    let workspace = state.active_workspace()?;
    let path = paths::validate_existing_file_in_workspace(&PathBuf::from(path), &workspace)?;
    let file_len = store.file_len(&path)?;
    if file_len > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "File is too large for the MVP text editor: {} bytes",
            file_len
        ));
    }

    let bytes = store.read(&path)?;
    if bytes.contains(&0) {
        return Err("Binary files are not supported by the MVP text editor".to_string());
    }

    let content =
        String::from_utf8(bytes).map_err(|err| format!("File is not valid UTF-8: {err}"))?;
    Ok(FilePayload {
        success: true,
        path: paths::display_path(&path),
        content: Some(content),
    })
}

pub fn write_file(state: &AppState, path: String, content: String) -> Result<FilePayload, String> {
    if content.as_bytes().len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("File content is too large for the MVP text editor".to_string());
    }

    let store = workspace_store::local();
    let workspace = state.active_workspace()?;
    let path = paths::validate_writable_file_in_workspace(&PathBuf::from(path), &workspace)?;
    store.write(&path, content.as_bytes())?;
    events::publish(AppEvent::FileSaved {
        path: paths::display_path(&path),
        content_hash: events::content_hash(&content),
    });
    Ok(FilePayload {
        success: true,
        path: paths::display_path(&path),
        content: None,
    })
}

pub fn create_file(state: &AppState, relative_path: String) -> Result<FilePayload, String> {
    let store = workspace_store::local();
    let relative = paths::validate_relative_path(&relative_path)?;
    let workspace = state.active_workspace()?;
    let path = workspace.join(relative);
    let parent = path
        .parent()
        .ok_or_else(|| "File path has no parent".to_string())?;

    store.create_dir_all(parent)?;
    let path = paths::validate_writable_file_in_workspace(&path, &workspace)?;
    if store.exists(&path) {
        return Err(format!("File already exists: {}", path.display()));
    }
    store.write(&path, b"")?;
    events::publish(AppEvent::FileCreated {
        path: paths::display_path(&path),
    });

    Ok(FilePayload {
        success: true,
        path: paths::display_path(&path),
        content: Some(String::new()),
    })
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{create_file, read_file, write_file};
    use crate::app_state::{AppPaths, AppState};

    #[test]
    fn create_and_read_file_round_trip() {
        let state = temp_state();
        let created = create_file(&state, "notes/todo.txt".to_string()).unwrap();
        assert!(
            created.path.ends_with("notes\\todo.txt") || created.path.ends_with("notes/todo.txt")
        );
        assert_eq!(created.content.as_deref(), Some(""));

        write_file(&state, created.path.clone(), "hello world".to_string()).unwrap();
        let loaded = read_file(&state, created.path).unwrap();
        assert_eq!(loaded.content.as_deref(), Some("hello world"));
    }

    #[test]
    fn rejects_binary_files() {
        let state = temp_state();
        let binary_path = state.active_workspace().unwrap().join("image.bin");
        fs::write(&binary_path, [0_u8, 1_u8, 2_u8]).unwrap();

        let error = read_file(&state, binary_path.to_string_lossy().to_string()).unwrap_err();
        assert!(error.contains("Binary files are not supported"));
    }

    #[test]
    fn rejects_outside_workspace_reads() {
        let state = temp_state();
        let outside = state.paths.home_dir.join("outside.txt");
        fs::write(&outside, "secret").unwrap();

        let error = read_file(&state, outside.to_string_lossy().to_string()).unwrap_err();
        assert!(error.contains("outside the active workspace"));
    }

    fn temp_state() -> AppState {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        let base = std::env::temp_dir().join(format!("axiowl_files_test_{unique}"));
        let codex_dir = base.join(".codex");
        let workspace = base.join("workspace");
        fs::create_dir_all(&codex_dir).unwrap();
        fs::create_dir_all(&workspace).unwrap();

        AppState {
            paths: AppPaths {
                home_dir: base.clone(),
                codex_dir,
                qexow_main_dir: base,
            },
            active_workspace: std::sync::Mutex::new(workspace),
            initial_file_to_open: std::sync::Mutex::new(None),
            runs_by_id: std::sync::Mutex::new(HashMap::new()),
            runs_by_session: std::sync::Mutex::new(HashMap::new()),
        }
    }
}
