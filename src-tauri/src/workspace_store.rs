use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug)]
pub struct StoreEntry {
    pub path: PathBuf,
    pub name: String,
    pub is_dir: bool,
    pub is_file: bool,
}

pub trait WorkspaceStore {
    fn create_dir_all(&self, path: &Path) -> Result<(), String>;
    fn exists(&self, path: &Path) -> bool;
    fn file_len(&self, path: &Path) -> Result<u64, String>;
    fn read(&self, path: &Path) -> Result<Vec<u8>, String>;
    fn read_dir(&self, path: &Path) -> Result<Vec<StoreEntry>, String>;
    fn write(&self, path: &Path, content: &[u8]) -> Result<(), String>;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct LocalWorkspaceStore;

pub fn local() -> LocalWorkspaceStore {
    LocalWorkspaceStore
}

impl WorkspaceStore for LocalWorkspaceStore {
    fn create_dir_all(&self, path: &Path) -> Result<(), String> {
        fs::create_dir_all(path)
            .map_err(|err| format!("Cannot create directory '{}': {err}", path.display()))
    }

    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn file_len(&self, path: &Path) -> Result<u64, String> {
        fs::metadata(path)
            .map(|metadata| metadata.len())
            .map_err(|err| format!("Cannot inspect file '{}': {err}", path.display()))
    }

    fn read(&self, path: &Path) -> Result<Vec<u8>, String> {
        fs::read(path).map_err(|err| format!("Cannot read file '{}': {err}", path.display()))
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<StoreEntry>, String> {
        let mut entries = Vec::new();
        let dir = fs::read_dir(path)
            .map_err(|err| format!("Cannot list directory '{}': {err}", path.display()))?;

        for entry in dir {
            let entry = entry.map_err(|err| {
                format!("Cannot read directory entry '{}': {err}", path.display())
            })?;
            let file_type = entry.file_type().map_err(|err| {
                format!("Cannot inspect entry '{}': {err}", entry.path().display())
            })?;
            entries.push(StoreEntry {
                path: entry.path(),
                name: entry.file_name().to_string_lossy().to_string(),
                is_dir: file_type.is_dir(),
                is_file: file_type.is_file(),
            });
        }

        Ok(entries)
    }

    fn write(&self, path: &Path, content: &[u8]) -> Result<(), String> {
        fs::write(path, content)
            .map_err(|err| format!("Cannot write file '{}': {err}", path.display()))
    }
}
