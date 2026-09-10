use std::fs::{File, OpenOptions};
use std::path::Path;

pub struct PluginOwner {
    file: File,
}

impl PluginOwner {
    pub fn acquire(path: &Path) -> Result<Self, String> {
        let file = open_file(path)?;
        lock_file(&file)?;
        Ok(Self { file })
    }
}

impl Drop for PluginOwner {
    fn drop(&mut self) {
        unlock_file(&self.file);
    }
}

#[cfg(unix)]
fn lock_file(file: &File) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    unsafe extern "C" {
        fn flock(fd: i32, operation: i32) -> i32;
    }
    let result = unsafe { flock(file.as_raw_fd(), 2 | 4) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().to_string())
    }
}
#[cfg(unix)]
fn unlock_file(file: &File) {
    use std::os::fd::AsRawFd;
    unsafe extern "C" {
        fn flock(fd: i32, operation: i32) -> i32;
    }
    unsafe {
        flock(file.as_raw_fd(), 8);
    }
}

#[cfg(windows)]
fn lock_file(_file: &File) -> Result<(), String> {
    Ok(())
}
#[cfg(windows)]
fn unlock_file(_file: &File) {}

#[cfg(windows)]
fn open_file(path: &Path) -> Result<File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .share_mode(0)
        .open(path)
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn open_file(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())
}

#[cfg(not(any(unix, windows)))]
fn lock_file(_file: &File) -> Result<(), String> {
    Ok(())
}
#[cfg(not(any(unix, windows)))]
fn unlock_file(_file: &File) {}
