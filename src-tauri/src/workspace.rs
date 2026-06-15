use std::path::PathBuf;

use crate::{
    app_state::AppState,
    dto::{WorkspaceFiles, WorkspaceInfo, WorkspaceList},
    events::{self, AppEvent},
    paths,
    workspace_store::{self, WorkspaceStore},
};

pub fn startup_options(state: &AppState) -> Result<crate::dto::StartupOptions, String> {
    let workspace = state.active_workspace()?;
    let initial_file = state.take_initial_file()?;
    Ok(crate::dto::StartupOptions {
        workspace: paths::display_path(&workspace),
        initial_file: initial_file.as_deref().map(paths::display_path),
    })
}

pub fn open_path(state: &AppState, target_path: String) -> Result<WorkspaceInfo, String> {
    let path = PathBuf::from(target_path);
    let canonical = std::fs::canonicalize(&path)
        .map_err(|err| format!("Invalid path '{}': {err}", path.display()))?;

    let (workspace, file) = if canonical.is_file() {
        let parent = canonical
            .parent()
            .ok_or_else(|| "File has no parent directory".to_string())?
            .to_path_buf();
        (paths::canonical_dir(&parent)?, Some(canonical))
    } else if canonical.is_dir() {
        (paths::canonical_dir(&canonical)?, None)
    } else {
        return Err(format!(
            "Path is not a file or directory: {}",
            canonical.display()
        ));
    };

    state.set_active_workspace(workspace.clone())?;
    events::publish(AppEvent::WorkspaceChanged {
        root: paths::display_path(&workspace),
    });
    Ok(workspace_info_for_path(workspace, file))
}

pub fn workspace_info(state: &AppState) -> Result<WorkspaceInfo, String> {
    let workspace = state.active_workspace()?;
    Ok(workspace_info_for_path(workspace, None))
}

pub fn list_sibling_workspaces(state: &AppState) -> Result<WorkspaceList, String> {
    let store = workspace_store::local();
    let active = state.active_workspace()?;
    let parent = &state.paths.qexow_main_dir;
    let mut workspaces = store
        .read_dir(parent)?
        .into_iter()
        .filter(|entry| entry.is_dir)
        .map(|entry| entry.name)
        .filter(|name| !paths::is_ignored_name(name))
        .collect::<Vec<_>>();
    workspaces.sort();

    Ok(WorkspaceList {
        workspaces,
        active: basename(&active),
        root: paths::display_path(&active),
        parent: paths::display_path(parent),
    })
}

pub fn select_workspace(state: &AppState, name: String) -> Result<WorkspaceInfo, String> {
    validate_workspace_name(&name)?;
    let parent = paths::canonical_dir(&state.paths.qexow_main_dir)?;
    let selected = paths::canonical_dir(&parent.join(name))?;
    if !selected.starts_with(&parent) {
        return Err("Selected workspace is outside the workspace parent".to_string());
    }
    state.set_active_workspace(selected.clone())?;
    events::publish(AppEvent::WorkspaceChanged {
        root: paths::display_path(&selected),
    });
    Ok(workspace_info_for_path(selected, None))
}

pub fn create_workspace(state: &AppState, name: String) -> Result<WorkspaceInfo, String> {
    let store = workspace_store::local();
    validate_workspace_name(&name)?;
    let parent = paths::canonical_dir(&state.paths.qexow_main_dir)?;
    let selected = parent.join(name);
    if !selected.starts_with(&parent) {
        return Err("Workspace path is outside the workspace parent".to_string());
    }
    store.create_dir_all(&selected)?;
    let selected = paths::canonical_dir(&selected)?;
    state.set_active_workspace(selected.clone())?;
    events::publish(AppEvent::WorkspaceChanged {
        root: paths::display_path(&selected),
    });
    Ok(workspace_info_for_path(selected, None))
}

pub fn list_files(state: &AppState) -> Result<WorkspaceFiles, String> {
    let root = state.active_workspace()?;
    let mut files = Vec::new();
    collect_files(&root, &root, &mut files)?;
    files.sort();
    let truncated = files.len() > paths::WORKSPACE_FILE_LIMIT;
    files.truncate(paths::WORKSPACE_FILE_LIMIT);
    Ok(WorkspaceFiles {
        files,
        truncated,
        root: paths::display_path(&root),
    })
}

fn workspace_info_for_path(workspace: PathBuf, file: Option<PathBuf>) -> WorkspaceInfo {
    WorkspaceInfo {
        success: true,
        name: basename(&workspace),
        root: paths::display_path(&workspace),
        file: file.as_deref().map(paths::display_path),
    }
}

fn basename(path: &PathBuf) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.display().to_string())
}

fn validate_workspace_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Workspace name cannot be empty".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Workspace name contains invalid characters".to_string());
    }
    Ok(())
}

fn collect_files(root: &PathBuf, dir: &PathBuf, files: &mut Vec<String>) -> Result<(), String> {
    let store = workspace_store::local();
    for entry in store.read_dir(dir)? {
        if paths::is_ignored_name(&entry.name) {
            continue;
        }

        if entry.is_dir {
            collect_files(root, &entry.path, files)?;
        } else if entry.is_file {
            if let Ok(relative) = entry.path.strip_prefix(root) {
                files.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }

        if files.len() > paths::WORKSPACE_FILE_LIMIT {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{create_workspace, list_files, open_path, select_workspace};
    use crate::app_state::{AppPaths, AppState};

    #[test]
    fn create_workspace_sets_active_workspace() {
        let state = temp_state();
        let info = create_workspace(&state, "client-a".to_string()).unwrap();
        assert_eq!(info.name, "client-a");
        assert!(state.active_workspace().unwrap().ends_with("client-a"));
    }

    #[test]
    fn select_workspace_rejects_invalid_name() {
        let state = temp_state();
        let error = select_workspace(&state, "..\\secret".to_string()).unwrap_err();
        assert!(error.contains("invalid characters"));
    }

    #[test]
    fn open_path_sets_workspace_to_file_parent() {
        let state = temp_state();
        let project = state.paths.qexow_main_dir.join("project-a");
        fs::create_dir_all(&project).unwrap();
        let file = project.join("main.rs");
        fs::write(&file, "fn main() {}\n").unwrap();
        let canonical_file = file.canonicalize().unwrap();
        let canonical_project = project.canonicalize().unwrap();

        let info = open_path(&state, file.to_string_lossy().to_string()).unwrap();
        assert_eq!(
            info.file.as_deref(),
            Some(canonical_file.to_string_lossy().as_ref())
        );
        assert_eq!(info.root, canonical_project.to_string_lossy());
        assert_eq!(state.active_workspace().unwrap(), canonical_project);
    }

    #[test]
    fn list_files_ignores_ignored_directories() {
        let state = temp_state();
        let root = state.active_workspace().unwrap();
        fs::write(root.join("README.md"), "# hi").unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::write(root.join("node_modules").join("ignored.js"), "alert(1)").unwrap();

        let files = list_files(&state).unwrap();
        assert_eq!(files.files, vec!["README.md".to_string()]);
        assert!(!files.truncated);
    }

    fn temp_state() -> AppState {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_string();
        let base = std::env::temp_dir().join(format!("axiowl_workspace_test_{unique}"));
        let codex_dir = base.join(".codex");
        let workspace_parent = base.join("AxiOwl");
        let workspace = workspace_parent.join("workspace");
        fs::create_dir_all(&codex_dir).unwrap();
        fs::create_dir_all(&workspace).unwrap();

        AppState {
            paths: AppPaths {
                home_dir: base,
                codex_dir,
                qexow_main_dir: workspace_parent,
            },
            active_workspace: std::sync::Mutex::new(workspace),
            initial_file_to_open: std::sync::Mutex::new(None),
            runs_by_id: std::sync::Mutex::new(HashMap::new()),
            runs_by_session: std::sync::Mutex::new(HashMap::new()),
        }
    }
}
