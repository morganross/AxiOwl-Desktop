use std::{collections::HashMap, env, fs, path::PathBuf, sync::Mutex};

use crate::{paths, process::ManagedRun};

pub struct AppPaths {
    #[allow(dead_code)]
    pub home_dir: PathBuf,
    pub codex_dir: PathBuf,
    pub qexow_main_dir: PathBuf,
}

pub struct AppState {
    pub paths: AppPaths,
    pub active_workspace: Mutex<PathBuf>,
    pub initial_file_to_open: Mutex<Option<PathBuf>>,
    pub runs_by_id: Mutex<HashMap<String, ManagedRun>>,
    pub runs_by_session: Mutex<HashMap<String, String>>,
}

impl AppState {
    pub fn initialize() -> Result<Self, String> {
        let home_dir = resolve_home_dir().ok_or("Could not determine home directory")?;
        let codex_dir = home_dir.join(".codex");
        let qexow_main_dir = env::var_os("AXIOWL_MAIN_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir.join("AxiOwl"));

        fs::create_dir_all(&codex_dir)
            .map_err(|err| format!("Failed to create Codex profile directory: {err}"))?;
        fs::create_dir_all(&qexow_main_dir)
            .map_err(|err| format!("Failed to create workspace parent: {err}"))?;

        let initial_arg_path = paths::path_from_args(env::args().collect::<Vec<_>>().as_slice());
        let mut initial_file = env::var_os("INITIAL_FILE").map(PathBuf::from).or_else(|| {
            initial_arg_path
                .as_ref()
                .filter(|path| path.is_file())
                .cloned()
        });

        let initial_workspace = env::var_os("INITIAL_WORKSPACE")
            .map(PathBuf::from)
            .or_else(|| {
                initial_arg_path.as_ref().and_then(|path| {
                    if path.is_file() {
                        path.parent().map(|parent| parent.to_path_buf())
                    } else if path.is_dir() {
                        Some(path.to_path_buf())
                    } else {
                        None
                    }
                })
            });

        let active_workspace = if let Some(path) = initial_workspace {
            paths::canonical_dir(&path)?
        } else {
            ensure_default_workspace(&qexow_main_dir)?
        };

        if let Some(path) = initial_file.take() {
            initial_file = Some(paths::canonical_file(&path)?);
        }

        Ok(Self {
            paths: AppPaths {
                home_dir,
                codex_dir,
                qexow_main_dir,
            },
            active_workspace: Mutex::new(active_workspace),
            initial_file_to_open: Mutex::new(initial_file),
            runs_by_id: Mutex::new(HashMap::new()),
            runs_by_session: Mutex::new(HashMap::new()),
        })
    }

    pub fn active_workspace(&self) -> Result<PathBuf, String> {
        self.active_workspace
            .lock()
            .map_err(|_| "Workspace state lock poisoned".to_string())
            .map(|guard| guard.clone())
    }

    pub fn set_active_workspace(&self, path: PathBuf) -> Result<(), String> {
        let mut guard = self
            .active_workspace
            .lock()
            .map_err(|_| "Workspace state lock poisoned".to_string())?;
        *guard = path;
        Ok(())
    }

    pub fn take_initial_file(&self) -> Result<Option<PathBuf>, String> {
        self.initial_file_to_open
            .lock()
            .map_err(|_| "Startup state lock poisoned".to_string())
            .map(|mut guard| guard.take())
    }

    pub fn insert_run(&self, run: ManagedRun) -> Result<(), String> {
        let mut runs = self
            .runs_by_id
            .lock()
            .map_err(|_| "Run registry lock poisoned".to_string())?;
        if let Some(session) = &run.session_uuid {
            self.runs_by_session
                .lock()
                .map_err(|_| "Run session registry lock poisoned".to_string())?
                .insert(session.clone(), run.run_id.clone());
        }
        runs.insert(run.run_id.clone(), run);
        Ok(())
    }

    pub fn get_run(&self, run_id: &str) -> Result<Option<ManagedRun>, String> {
        self.runs_by_id
            .lock()
            .map_err(|_| "Run registry lock poisoned".to_string())
            .map(|runs| runs.get(run_id).cloned())
    }

    pub fn set_run_session(&self, run_id: &str, session_uuid: &str) -> Result<(), String> {
        let mut by_session = self
            .runs_by_session
            .lock()
            .map_err(|_| "Run session registry lock poisoned".to_string())?;
        by_session.insert(session_uuid.to_string(), run_id.to_string());
        Ok(())
    }

    pub fn remove_run(&self, run_id: &str) -> Result<(), String> {
        let mut runs = self
            .runs_by_id
            .lock()
            .map_err(|_| "Run registry lock poisoned".to_string())?;
        runs.remove(run_id);

        let mut by_session = self
            .runs_by_session
            .lock()
            .map_err(|_| "Run session registry lock poisoned".to_string())?;
        by_session.retain(|_, id| id != run_id);
        Ok(())
    }

    pub fn is_session_running(&self, session_uuid: &str) -> bool {
        self.runs_by_session
            .lock()
            .map(|runs| runs.contains_key(session_uuid))
            .unwrap_or(false)
    }
}

fn ensure_default_workspace(parent: &PathBuf) -> Result<PathBuf, String> {
    let mut folders = fs::read_dir(parent)
        .map_err(|err| format!("Failed to read workspace parent: {err}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|ty| ty.is_dir()).unwrap_or(false))
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| !paths::is_ignored_name(name))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    folders.sort();
    if let Some(first) = folders.first() {
        return paths::canonical_dir(first);
    }

    let default_path = parent.join("workspace");
    fs::create_dir_all(&default_path)
        .map_err(|err| format!("Failed to create default workspace: {err}"))?;
    paths::canonical_dir(&default_path)
}

fn resolve_home_dir() -> Option<PathBuf> {
    env::var_os("AXIOWL_HOME_DIR")
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
}

#[cfg(test)]
mod tests {
    use std::{path::PathBuf, sync::Mutex};

    use super::resolve_home_dir;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn prefers_axiowl_home_dir_override() {
        let _guard = ENV_LOCK.lock().unwrap();
        let original = std::env::var_os("AXIOWL_HOME_DIR");
        let expected = if cfg!(windows) {
            PathBuf::from(r"C:\axiowl-home-override")
        } else {
            PathBuf::from("/tmp/axiowl-home-override")
        };

        std::env::set_var("AXIOWL_HOME_DIR", &expected);
        let resolved = resolve_home_dir().unwrap();

        match original {
            Some(value) => std::env::set_var("AXIOWL_HOME_DIR", value),
            None => std::env::remove_var("AXIOWL_HOME_DIR"),
        }

        assert_eq!(resolved, expected);
    }
}
