use super::{RegistryError, RegistryResult};
use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};
#[cfg(windows)]
use std::{
    path::PathBuf,
    thread,
    time::{Duration, Instant},
};

pub struct RegistryOwner {
    file: File,
    #[cfg(windows)]
    path: PathBuf,
}
impl RegistryOwner {
    pub fn acquire(registry: &Path) -> RegistryResult<Self> {
        let parent = registry
            .parent()
            .ok_or_else(|| RegistryError::new("STORE_LOCK_FAILED", "registry path is invalid"))?;
        fs::create_dir_all(parent)
            .map_err(|_| RegistryError::new("STORE_LOCK_FAILED", "registry directory failed"))?;
        let path = registry.with_extension("lock");
        acquire_file(&path)
    }
}
impl Drop for RegistryOwner {
    fn drop(&mut self) {
        #[cfg(unix)]
        unlock(&self.file);
        #[cfg(windows)]
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(unix)]
fn acquire_file(path: &Path) -> RegistryResult<RegistryOwner> {
    use std::os::fd::AsRawFd;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(path)
        .map_err(|_| RegistryError::new("STORE_LOCK_FAILED", "registry lock open failed"))?;
    unsafe extern "C" {
        fn flock(fd: i32, operation: i32) -> i32;
    }
    if unsafe { flock(file.as_raw_fd(), 2) } != 0 {
        return Err(RegistryError::new(
            "STORE_LOCK_FAILED",
            "registry lock failed",
        ));
    }
    Ok(RegistryOwner { file })
}
#[cfg(unix)]
fn unlock(file: &File) {
    use std::os::fd::AsRawFd;
    unsafe extern "C" {
        fn flock(fd: i32, operation: i32) -> i32;
    }
    let _ = unsafe { flock(file.as_raw_fd(), 8) };
}

#[cfg(windows)]
fn acquire_file(path: &Path) -> RegistryResult<RegistryOwner> {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match OpenOptions::new().write(true).create_new(true).open(path) {
            Ok(file) => {
                return Ok(RegistryOwner {
                    file,
                    path: path.to_owned(),
                });
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::AlreadyExists
                    && Instant::now() < deadline =>
            {
                thread::sleep(Duration::from_millis(10))
            }
            Err(_) => {
                return Err(RegistryError::new(
                    "STORE_LOCK_FAILED",
                    "registry lock failed",
                ));
            }
        }
    }
}
