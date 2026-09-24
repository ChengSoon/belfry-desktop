#[cfg(target_os = "windows")]
use std::ffi::c_void;

#[cfg(target_os = "windows")]
#[link(name = "shell32")]
unsafe extern "system" {
    #[link_name = "ShellExecuteW"]
    fn shell_execute(
        window: *mut c_void,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show: i32,
    ) -> *mut c_void;
}

#[cfg(target_os = "windows")]
pub(super) fn open(url: &str) -> Result<(), String> {
    const SW_SHOWNORMAL: i32 = 1;
    let target = encode_url(url)?;
    let operation = [b'o' as u16, b'p' as u16, b'e' as u16, b'n' as u16, 0];
    // 两个 UTF-16 字符串均以 NUL 结尾，且在同步调用期间保持有效。
    // URL 直接交给协议处理器，不经过 cmd，也不附加命令行引号。
    let status = unsafe {
        shell_execute(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    check_status(status as isize)
}

fn encode_url(url: &str) -> Result<Vec<u16>, String> {
    if url.contains('\0') {
        return Err("URL 不能包含 NUL 字符".into());
    }
    Ok(url.encode_utf16().chain(std::iter::once(0)).collect())
}

fn check_status(status: isize) -> Result<(), String> {
    // ShellExecuteW 返回大于 32 的值表示成功，其余为 Shell 错误码。
    const SHELL_ERROR_MAX: isize = 32;
    if status > SHELL_ERROR_MAX {
        Ok(())
    } else {
        Err(format!(
            "打开默认浏览器失败（ShellExecuteW 错误码 {status}）"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_url_has_no_command_line_quotes_or_backslashes() {
        let url = "https://chengsoon.github.io/belfry-desktop/";
        let encoded = encode_url(url).unwrap();
        assert_eq!(Some(&0), encoded.last());
        assert_eq!(
            url,
            String::from_utf16(&encoded[..encoded.len() - 1]).unwrap()
        );
    }

    #[test]
    fn query_unicode_and_shell_characters_are_preserved_as_url_data() {
        let url = "https://example.com/手册/🦇?a=1&b=%20&c=\"text\"&d=^!|#章节";
        let encoded = encode_url(url).unwrap();
        assert_eq!(
            url,
            String::from_utf16(&encoded[..encoded.len() - 1]).unwrap()
        );
        assert_eq!(Some(&0), encoded.last());
    }

    #[test]
    fn embedded_nul_is_rejected_instead_of_truncating_the_url() {
        assert!(encode_url("https://example.com/\0ignored").is_err());
    }

    #[test]
    fn native_failures_are_reported_including_missing_protocol_handler() {
        for status in [0, 2, 3, 5, 8, 26, 27, 28, 29, 30, 31, 32] {
            assert!(
                check_status(status)
                    .unwrap_err()
                    .contains(&status.to_string())
            );
        }
        assert_eq!(Ok(()), check_status(33));
        assert_eq!(Ok(()), check_status(isize::MAX));
    }
}
