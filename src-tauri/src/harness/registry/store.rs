use super::types::{RegistryError, RegistryResult, RegistryState};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub struct RegistryStore {
    path: PathBuf,
}
impl RegistryStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    pub fn load(&self) -> RegistryResult<RegistryState> {
        match fs::read_to_string(&self.path) {
            Ok(text) => serde_json::from_str(&text)
                .map_err(|_| RegistryError::new("STORE_INVALID", "registry store is invalid")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(RegistryState::default())
            }
            Err(_) => Err(RegistryError::new(
                "STORE_READ_FAILED",
                "registry store read failed",
            )),
        }
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn save(&self, state: &RegistryState) -> RegistryResult<()> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| RegistryError::new("STORE_WRITE_FAILED", "registry path is invalid"))?;
        fs::create_dir_all(parent)
            .map_err(|_| RegistryError::new("STORE_WRITE_FAILED", "registry directory failed"))?;
        let temp = parent.join(format!(".registry-{}.tmp", ulid::Ulid::generate()));
        let result = self.write_temp(&temp, state).and_then(|_| {
            fs::rename(&temp, &self.path)
                .map_err(|_| RegistryError::new("STORE_WRITE_FAILED", "registry commit failed"))
        });
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
    fn write_temp(&self, path: &Path, state: &RegistryState) -> RegistryResult<()> {
        let bytes = serde_json::to_vec_pretty(state).map_err(|_| {
            RegistryError::new("STORE_WRITE_FAILED", "registry serialization failed")
        })?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|_| RegistryError::new("STORE_WRITE_FAILED", "registry temp failed"))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| RegistryError::new("STORE_WRITE_FAILED", "registry sync failed"))
    }
}
