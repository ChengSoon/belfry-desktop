//! 配置文件的原子替换。
//!
//! 这些文件是用户的真家伙——`~/.claude/settings.json` 里有 hooks，
//! `~/.codex/config.toml` 里有 MCP 定义和项目信任记录。写到一半断电或崩溃
//! 而留下一个截断的文件是不可接受的，所以一律先写同目录临时文件再 rename。
//!
//! 临时文件必须和目标同目录：跨文件系统的 rename 会失败，而 `/tmp` 与用户
//! home 在 macOS 上经常就不是一个卷。

use std::fs;
use std::path::{Path, PathBuf};

use crate::terminal::AppError;

/// 目标文件不存在时创建用的权限。存密钥的文件传 `true`。
pub(super) fn write_atomic(path: &Path, contents: &str, private: bool) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid_argument("配置文件路径没有父目录"))?;
    fs::create_dir_all(parent)
        .map_err(|err| AppError::io(format!("建不了目录 {}：{err}", parent.display())))?;

    // 已存在就沿用它的权限：用户把 settings.json 设成什么样是他的事，
    // 我们只是改其中几个字段，不该顺手改权限。
    let existing_mode = current_mode(path);

    let temp = temp_path(path);
    fs::write(&temp, contents)
        .map_err(|err| AppError::io(format!("写不了临时文件 {}：{err}", temp.display())))?;

    if let Err(error) = apply_mode(&temp, existing_mode, private) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }

    // Windows 上 std 的 rename 走 MoveFileExW + MOVEFILE_REPLACE_EXISTING，
    // 和 Unix 一样能覆盖已存在的目标，不需要先删。
    fs::rename(&temp, path).map_err(|err| {
        let _ = fs::remove_file(&temp);
        AppError::io(format!("替换不了 {}：{err}", path.display()))
    })
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
        let dir = std::env::temp_dir().join(format!("belfry-provider-atomic-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
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
