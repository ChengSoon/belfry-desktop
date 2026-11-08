//! 文件的原子替换。
//!
//! 这些文件是用户的真家伙——`~/.claude/settings.json` 里有 hooks，
//! `~/.codex/config.toml` 里有 MCP 定义和项目信任记录。写到一半断电或崩溃
//! 而留下一个截断的文件是不可接受的，所以一律先写同目录临时文件再 rename。
//!
//! 临时文件必须和目标同目录：跨文件系统的 rename 会失败，而 `/tmp` 与用户
//! home 在 macOS 上经常就不是一个卷。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::terminal::AppError;

/// 读文件原文。文件不存在时返回空串，而不是报错——全新机器上还没建配置文件是常态。
pub(crate) fn read_text_optional(path: &Path) -> Result<String, AppError> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(AppError::io(format!("读不了 {}：{err}", path.display()))),
    }
}

/// 目标文件不存在时创建用的权限。存密钥的文件传 `true`。
pub(crate) fn write_atomic(path: &Path, contents: &str, private: bool) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid_argument("文件路径没有父目录"))?;
    fs::create_dir_all(parent)
        .map_err(|err| AppError::io(format!("建不了目录 {}：{err}", parent.display())))?;

    // 已存在就沿用它的权限：用户把 settings.json 设成什么样是他的事，
    // 我们只是改其中几个字段，不该顺手改权限。
    let existing_mode = current_mode(path);

    let temp = temp_path(path);
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(if private { 0o600 } else { 0o644 }); }
    let mut file = options.open(&temp)
        .map_err(|err| AppError::io(format!("写不了临时文件 {}：{err}", temp.display())))?;
    if let Err(error) = file.write_all(contents.as_bytes()) {
        drop(file);
        let _ = fs::remove_file(&temp);
        return Err(AppError::io(format!("写不了临时文件：{error}")));
    }

    if let Err(error) = apply_mode(&temp, existing_mode, private) {
        drop(file);
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    if let Err(error) = file.sync_all() {
        drop(file);
        let _ = fs::remove_file(&temp);
        return Err(AppError::io(format!("同步不了临时文件：{error}")));
    }
    drop(file);

    // Windows 上 std 的 rename 走 MoveFileExW + MOVEFILE_REPLACE_EXISTING，
    // 和 Unix 一样能覆盖已存在的目标，不需要先删。
    fs::rename(&temp, path).map_err(|err| {
        let _ = fs::remove_file(&temp);
        AppError::io(format!("替换不了 {}：{err}", path.display()))
    })?;
    // rename 是可见性提交点。目录同步失败不能再谎报“未提交”并诱导重试。
    #[cfg(unix)]
    if let Err(error) = fs::File::open(parent).and_then(|directory| directory.sync_all()) {
        log::warn!("File replacement committed but directory sync failed: {error}");
    }
    Ok(())
}

/// 短事务的跨进程写锁；由内核回收，不留下崩溃后永远打不开的 PID 锁。
pub(crate) struct FileLock { _file: fs::File }
impl FileLock {
    pub fn acquire(path: &Path) -> Result<Self, AppError> {
        if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| AppError::io(error.to_string()))?; }
        let mut options = fs::OpenOptions::new();
        options.create(true).read(true).write(true).truncate(false);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; options.share_mode(0); }
        let file = options.open(path).map_err(|error| AppError::io(format!("存储正在被使用或不可写：{error}")))?;
        #[cfg(unix)] {
            flock_retry(&file, 2 | 4).map_err(|error| {
                if error.kind() == std::io::ErrorKind::WouldBlock {
                    AppError::io("另一实例正在保存，请稍后重试")
                } else {
                    AppError::io(format!("存储正在被使用或不可写：{error}"))
                }
            })?;
        }
        Ok(Self { _file: file })
    }
}

#[cfg(unix)]
impl Drop for FileLock {
    fn drop(&mut self) {
        // fork inherits the open file description. Closing only our descriptor
        // lets a child awaiting exec keep the completed transaction locked.
        if let Err(error) = flock_retry(&self._file, 8) {
            log::warn!("Cannot release the storage lock: {error}");
        }
    }
}

#[cfg(unix)]
fn flock_retry(file: &fs::File, operation: i32) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    unsafe extern "C" { fn flock(fd: i32, operation: i32) -> i32; }
    loop {
        if unsafe { flock(file.as_raw_fd(), operation) } == 0 { return Ok(()); }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::Interrupted { return Err(error); }
    }
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("config");
    // 前导点让它在目录列表里不碍眼；ulid 避免两次切换撞车。
    path.with_file_name(format!(".{name}.belfry-{}.tmp", ulid::Ulid::generate()))
}

#[cfg(unix)]
fn current_mode(path: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .ok()
        .map(|meta| meta.permissions().mode() & 0o777)
}

#[cfg(windows)]
fn current_mode(_path: &Path) -> Option<u32> {
    None
}

#[cfg(unix)]
fn apply_mode(temp: &Path, existing: Option<u32>, private: bool) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;
    let mode = match existing {
        Some(mode) => mode,
        None if private => 0o600,
        None => 0o644,
    };
    fs::set_permissions(temp, fs::Permissions::from_mode(mode))
        .map_err(|err| AppError::io(format!("设不了文件权限：{err}")))
}

/// Windows 的访问控制不是权限位，靠的是目录本身的 ACL 继承。
#[cfg(windows)]
fn apply_mode(_temp: &Path, _existing: Option<u32>, _private: bool) -> Result<(), AppError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "belfry-provider-atomic-{tag}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    #[test]
    fn regression_dropping_a_lock_releases_it_while_an_inherited_descriptor_is_open() {
        let dir = temp_dir("inherited-lock");
        let path = dir.join("store.lock");
        let lock = FileLock::acquire(&path).unwrap();
        // dup/try_clone shares the open file description just as fork does. A child
        // awaiting exec must not prolong a transaction after the parent drops it.
        let inherited = lock._file.try_clone().unwrap();
        assert!(FileLock::acquire(&path).is_err(), "a live guard must exclude other writers");
        drop(lock);
        let next = FileLock::acquire(&path);
        drop(inherited);
        let _ = fs::remove_dir_all(dir);
        assert!(next.is_ok(), "the completed transaction still holds its lock: {:?}", next.err());
    }

    #[test]
    fn writes_a_new_file_and_leaves_no_temp_behind() {
        let dir = temp_dir("create");
        let target = dir.join("config.json");

        write_atomic(&target, "{\"a\":1}", true).unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"a\":1}");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "临时文件没清干净：{leftovers:?}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_brand_new_private_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("private");
        let target = dir.join("auth.json");

        write_atomic(&target, "{}", true).unwrap();

        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "存密钥的新文件必须是 0600");

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn rewriting_keeps_whatever_permission_the_user_had() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("preserve");
        let target = dir.join("settings.json");
        fs::write(&target, "old").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();

        write_atomic(&target, "new", true).unwrap();

        // 用户自己把文件设成 0640 是他的决定，改几个字段不该顺手收紧。
        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o640);
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");

        let _ = fs::remove_dir_all(&dir);
    }
}
