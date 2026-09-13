use super::protocol::{Endpoint, VERSION};
use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};

pub struct Owner {
    _file: File,
}

pub fn private_directory(root: &Path) -> Result<(), String> {
    if root
        .symlink_metadata()
        .is_ok_and(|meta| meta.file_type().is_symlink())
    {
        return Err("后台目录不能是符号链接".into());
    }
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(root).map_err(io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700)).map_err(io)?;
    }
    Ok(())
}

impl Owner {
    pub fn acquire(root: &Path) -> Result<Self, String> {
        private_directory(root)?;
        let path = root.join("owner.lock");
        if path
            .symlink_metadata()
            .is_ok_and(|meta| meta.file_type().is_symlink())
        {
            return Err("后台锁文件不能是符号链接".into());
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        let file = options.open(path).map_err(io)?;
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            unsafe extern "C" {
                fn flock(fd: i32, operation: i32) -> i32;
            }
            const EXCLUSIVE_NONBLOCK: i32 = 2 | 4;
            if unsafe { flock(file.as_raw_fd(), EXCLUSIVE_NONBLOCK) } != 0 {
                return Err("后台实例已经运行".into());
            }
        }
        Ok(Self { _file: file })
    }
}

pub fn read(root: &Path) -> Result<Endpoint, String> {
    let path = root.join("endpoint.json");
    let meta = path.symlink_metadata().map_err(io)?;
    if !meta.is_file() || meta.len() > 4096 {
        return Err("后台端点文件无效".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o077 != 0 {
            return Err("后台端点权限过宽".into());
        }
    }
    let endpoint: Endpoint =
        serde_json::from_str(&fs::read_to_string(path).map_err(io)?).map_err(io)?;
    if endpoint.version != VERSION || endpoint.port == 0 || endpoint.token.len() < 40 {
        return Err("后台版本或身份无效，请结束旧后台后重试".into());
    }
    Ok(endpoint)
}

pub fn save(root: &Path, endpoint: &Endpoint) -> Result<(), String> {
    let contents = serde_json::to_string(endpoint).map_err(io)?;
    let path = root.join("endpoint.json");
    crate::atomic::write_atomic(&path, &contents, true).map_err(|error| error.message)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(io)?;
    }
    Ok(())
}

fn io(error: impl std::fmt::Display) -> String {
    format!("后台存储不可用：{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_one_owner_can_hold_the_same_daemon_directory() {
        let root =
            std::env::temp_dir().join(format!("belfry-daemon-lock-{}", ulid::Ulid::generate()));
        let owner = Owner::acquire(&root).unwrap();
        assert!(Owner::acquire(&root).is_err());
        drop(owner);
        drop(Owner::acquire(&root).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
}
