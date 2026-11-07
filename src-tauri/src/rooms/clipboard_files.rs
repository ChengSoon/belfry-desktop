//! 浏览器没有暴露 Finder / 资源管理器复制的文件时，读取原生文件列表。
//! 只在用户粘贴时调用；不监听剪贴板，也不改写其中的内容。

use crate::terminal::AppError;

#[cfg(target_os = "macos")]
pub fn read() -> Result<Vec<String>, AppError> {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSString, NSURL};
    let board = NSPasteboard::generalPasteboard();
    let Some(items) = board.pasteboardItems() else {
        return Ok(Vec::new());
    };
    let file_type = NSString::from_str("public.file-url");
    Ok(items
        .iter()
        .take(super::attachments::MAX_ATTACHMENTS + 1)
        .filter_map(|item| {
            let value = item.stringForType(&file_type)?;
            let url = NSURL::URLWithString(&value)?;
            if !url.isFileURL() {
                return None;
            }
            url.path().map(|path| path.to_string())
        })
        .collect())
}

#[cfg(target_os = "windows")]
pub fn read() -> Result<Vec<String>, AppError> {
    use std::ptr;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard,
    };
    use windows_sys::Win32::UI::Shell::DragQueryFileW;
    struct Clipboard;
    impl Drop for Clipboard {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }
    // CF_HDROP = 15。没有文件时正常返回空列表，让正文按普通文本粘贴。
    unsafe {
        if OpenClipboard(ptr::null_mut()) == 0 {
            return Err(AppError::io("剪贴板正被占用，请重试粘贴"));
        }
        let _clipboard = Clipboard;
        let handle = GetClipboardData(15);
        if handle.is_null() {
            return Ok(Vec::new());
        }
        let count = DragQueryFileW(handle, u32::MAX, ptr::null_mut(), 0)
            .min((super::attachments::MAX_ATTACHMENTS + 1) as u32);
        let mut files = Vec::new();
        for index in 0..count {
            let length = DragQueryFileW(handle, index, ptr::null_mut(), 0);
            let mut path = vec![0u16; length as usize + 1];
            let copied = DragQueryFileW(handle, index, path.as_mut_ptr(), path.len() as u32);
            if copied > 0 {
                files.push(String::from_utf16_lossy(&path[..copied as usize]));
            }
        }
        Ok(files)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn read() -> Result<Vec<String>, AppError> {
    Ok(Vec::new())
}
