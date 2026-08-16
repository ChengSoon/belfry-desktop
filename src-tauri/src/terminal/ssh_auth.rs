//! SSH 密码的系统级存储：macOS 登录钥匙串 / Windows 凭据管理器。
//!
//! 密码不随工作区状态持久化（localStorage 明文可读），只存在系统凭据库里，
//! 按 `service + 账号` 键存取；换密码时用新密码重连并勾选记住即可覆盖。

use super::contracts::SshTarget;

/// 凭据条目的 service 段。账号段是 `user@host:port`，两者组合后唯一。
const SSH_SERVICE: &str = "belfry-desktop.ssh";

pub fn account_key(target: &SshTarget) -> String {
    let user = target.user.as_deref().unwrap_or("");
    let port = target.port.unwrap_or(22);
    format!("{user}@{}:{port}", target.host)
}

/// 解析本次会话要自动填入的密码：请求里带的优先，其次钥匙串里保存的。
/// `remember_password` 为真且带了新密码时，先把新密码写进钥匙串（覆盖旧值）；
/// 没带密码则视为"用已保存的"，不作保存也不报错。
pub fn resolve_password(target: &SshTarget) -> Option<String> {
    let typed = target.password.as_deref().filter(|value| !value.is_empty());
    if target.remember_password == Some(true) {
        if let Some(password) = typed {
            if let Err(error) = save(target, password) {
                // 保存失败不拦会话：这次连接照常（用刚输入的密码），只是没记住。
                eprintln!("[belfry] failed to save ssh password: {error}");
            }
        }
    }
    typed.map(str::to_string).or_else(|| load(target))
}

#[cfg(target_os = "macos")]
pub fn save(target: &SshTarget, password: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(
        SSH_SERVICE,
        &account_key(target),
        password.as_bytes(),
    )
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub fn load(target: &SshTarget) -> Option<String> {
    security_framework::passwords::get_generic_password(SSH_SERVICE, &account_key(target))
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

#[cfg(target_os = "macos")]
fn remove_impl(target: &SshTarget) -> Result<(), String> {
    security_framework::passwords::delete_generic_password(SSH_SERVICE, &account_key(target))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
pub fn save(target: &SshTarget, password: &str) -> Result<(), String> {
    use windows_sys::Win32::Security::Credentials::{
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredWriteW,
    };
    use windows_sys::core::PWSTR;

    let account = account_key(target);
    let target_name = wide(&format!("{SSH_SERVICE}/{account}"));
    let user_name = wide(&account);
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target_name.as_ptr() as PWSTR,
        CredentialBlobSize: password.len() as u32,
        CredentialBlob: password.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: user_name.as_ptr() as PWSTR,
        ..Default::default()
    };
    if unsafe { CredWriteW(&credential, 0) } == 0 {
        Err(last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub fn load(target: &SshTarget) -> Option<String> {
    use windows_sys::Win32::Security::Credentials::{CRED_TYPE_GENERIC, CredFree, CredReadW};
    use windows_sys::core::PWSTR;

    let target_name = wide(&format!("{SSH_SERVICE}/{}", account_key(target)));
    let mut credential: *mut windows_sys::Win32::Security::Credentials::CREDENTIALW =
        std::ptr::null_mut();
    if unsafe {
        CredReadW(
            target_name.as_ptr() as PWSTR,
            CRED_TYPE_GENERIC,
            0,
            &mut credential,
        )
    } == 0
    {
        return None;
    }
    let entry = unsafe { &*credential };
    let password = if entry.CredentialBlobSize > 0 && !entry.CredentialBlob.is_null() {
        let bytes = unsafe {
            std::slice::from_raw_parts(entry.CredentialBlob, entry.CredentialBlobSize as usize)
        };
        String::from_utf8(bytes.to_vec()).ok()
    } else {
        None
    };
    unsafe { CredFree(credential as *const core::ffi::c_void) };
    password
}

#[cfg(target_os = "windows")]
fn remove_impl(target: &SshTarget) -> Result<(), String> {
    use windows_sys::Win32::Security::Credentials::{CRED_TYPE_GENERIC, CredDeleteW};
    use windows_sys::core::PWSTR;

    let target_name = wide(&format!("{SSH_SERVICE}/{}", account_key(target)));
    if unsafe { CredDeleteW(target_name.as_ptr() as PWSTR, CRED_TYPE_GENERIC, 0) } == 0 {
        Err(last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn last_os_error() -> String {
    std::io::Error::last_os_error().to_string()
}

#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 清除保存的密码。没有存过也算成功，前端「清除」按钮因此是幂等的。
pub fn remove(target: &SshTarget) -> Result<(), String> {
    if load(target).is_none() {
        return Ok(());
    }
    remove_impl(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_keys_are_unique_per_user_host_and_port() {
        let base = SshTarget {
            host: "example.com".to_string(),
            user: Some("root".to_string()),
            port: Some(22),
            password: None,
            remember_password: None,
        };
        assert_eq!(account_key(&base), "root@example.com:22");
        assert_eq!(
            account_key(&SshTarget {
                user: None,
                ..base.clone()
            }),
            "@example.com:22"
        );
        assert_eq!(
            account_key(&SshTarget {
                port: Some(2222),
                ..base
            }),
            "root@example.com:2222"
        );
    }

    #[test]
    fn typed_password_wins_over_saved_one() {
        let target = SshTarget {
            host: "example.com".to_string(),
            user: None,
            port: None,
            password: Some("typed".to_string()),
            remember_password: Some(false),
        };
        assert_eq!(resolve_password(&target), Some("typed".to_string()));
    }

    #[test]
    fn typed_password_preserves_surrounding_whitespace() {
        let target = SshTarget {
            host: "example.com".to_string(),
            user: None,
            port: None,
            password: Some(" secret ".to_string()),
            remember_password: Some(false),
        };
        assert_eq!(resolve_password(&target), Some(" secret ".to_string()));
    }
}
