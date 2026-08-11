//! 路径与 file URI 的互转，以及跨平台的路径规范化。
//!
//! Windows 上 `std::fs::canonicalize` 返回 verbatim 形式 `\\?\C:\work\belfry`。
//! 这个前缀会一路污染下游：`CreateProcessW` 的 `lpCurrentDirectory` 不接受它，
//! `cmd.exe` 不认它，文件对话框的 `defaultPath` 不认它，UI 上显示出来也是噪声。
//! 所以规范化统一走本模块的 [`canonicalize`]，在最上游就把前缀剥掉。
//!
//! URI 这一侧只用作前后端之间的不透明标识，不做百分号编解码：
//! 两端都是纯字符串操作且严格对称，往返无损，路径里的 `%`、`#`、空格都不受影响。
//!
//! Windows 分支的字符串变换刻意写成不带 `cfg` 的独立函数，用 `cfg!` 在运行时选择。
//! 这样在 macOS 上也能对它跑测试——历史上这里的 bug 恰恰是因为
//! 往返测试只喂了本平台路径，Windows 分支从来没被执行过。

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use crate::terminal::AppError;

/// 规范化路径，并在 Windows 上还原成不带 `\\?\` 前缀的普通形式。
///
/// 能用普通形式表达的路径都会被还原；超长路径等必须保留 verbatim 的极端情况
/// 由 `dunce` 原样保留，此时后续 spawn 仍会失败，但那已经是系统本身的限制。
pub(crate) fn canonicalize(path: &Path) -> std::io::Result<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        dunce::canonicalize(path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.canonicalize()
    }
}

pub(crate) fn file_uri_to_path(uri: &str) -> Result<PathBuf, AppError> {
    let raw = uri
        .strip_prefix("file://")
        .ok_or_else(|| AppError::invalid_argument("resource must be a file URI"))?;
    if raw.is_empty() {
        return Err(AppError::invalid_argument("resource file URI has no path"));
    }
    Ok(PathBuf::from(if cfg!(target_os = "windows") {
        windows_uri_body_to_path(raw)
    } else {
        raw.to_string()
    }))
}

pub(crate) fn path_to_file_uri(path: &Path) -> String {
    let text = path.to_string_lossy();
    if cfg!(target_os = "windows") {
        windows_path_to_uri(&text)
    } else {
        format!("file://{text}")
    }
}

/// 去掉 Windows 的 `\\?\` verbatim 前缀，`\\?\UNC\server\share` 还原成 `\\server\share`。
/// 已经是普通形式的路径原样返回。
pub(crate) fn strip_verbatim_prefix(path: &str) -> Cow<'_, str> {
    let Some(rest) = path.strip_prefix(r"\\?\") else {
        return Cow::Borrowed(path);
    };
    match rest.strip_prefix(r"UNC\") {
        // `UNC\server\share` 里主机名前只有一个反斜杠，补齐成 UNC 的双反斜杠。
        Some(unc) => Cow::Owned(format!(r"\\{unc}")),
        None => Cow::Borrowed(rest),
    }
}

/// Windows 路径 → `file://` URI。
fn windows_path_to_uri(path: &str) -> String {
    let normalized = strip_verbatim_prefix(path).replace('\\', "/");
    match normalized.strip_prefix("//") {
        // UNC 的主机名属于 authority 段：`\\server\share` → `file://server/share`。
        Some(unc) => format!("file://{unc}"),
        // 盘符路径的 authority 段为空：`C:\work` → `file:///C:/work`。
        None => format!("file:///{}", normalized.trim_start_matches('/')),
    }
}

/// `file://` 之后的部分 → Windows 路径。[`windows_path_to_uri`] 的逆变换。
fn windows_uri_body_to_path(raw: &str) -> String {
    // 空 authority + 盘符：`/C:/work` → `C:\work`。
    if let Some(drive) = raw.strip_prefix('/').filter(|value| starts_with_drive(value)) {
        return drive.replace('/', "\\");
    }
    // 非空 authority 就是 UNC 主机名：`server/share` → `\\server\share`。
    if !raw.starts_with('/') {
        return format!("\\\\{}", raw.replace('/', "\\"));
    }
    raw.replace('/', "\\")
}

/// `C:/work` 这样的盘符开头路径（也接受裸盘符 `C:`）。
fn starts_with_drive(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_uri_round_trips_current_platform_path() {
        let path = std::env::current_dir().unwrap();
        let uri = path_to_file_uri(&path);
        assert_eq!(path, file_uri_to_path(&uri).unwrap());
    }

    #[test]
    fn file_uri_round_trips_the_canonicalized_path() {
        // 真实链路喂给 URI 的是 canonicalize 的产物，Windows 上它曾是 `\\?\C:\...`。
        let path = canonicalize(&std::env::current_dir().unwrap()).unwrap();
        let uri = path_to_file_uri(&path);
        assert_eq!(path, file_uri_to_path(&uri).unwrap());
    }

    #[test]
    fn rejects_a_uri_without_a_usable_path() {
        assert!(file_uri_to_path("/work/belfry").is_err());
        assert!(file_uri_to_path("file://").is_err());
    }

    /// 下面这组直接测 Windows 分支的字符串逻辑，在任意平台上都会跑。
    fn windows_round_trip(path: &str) -> String {
        let uri = windows_path_to_uri(path);
        windows_uri_body_to_path(uri.strip_prefix("file://").unwrap())
    }

    #[test]
    fn windows_drive_paths_round_trip() {
        assert_eq!(windows_path_to_uri(r"C:\work\belfry"), "file:///C:/work/belfry");
        assert_eq!(windows_round_trip(r"C:\work\belfry"), r"C:\work\belfry");
        assert_eq!(windows_round_trip(r"C:\"), r"C:\");
    }

    /// 回归：canonicalize 的 verbatim 产物曾被压成 `file:///?/D:/...`，
    /// 反解得到 `/?/D:/...`，最终以 os error 123 冒出来。
    #[test]
    fn windows_verbatim_prefix_never_reaches_the_uri() {
        let uri = windows_path_to_uri(r"\\?\D:\ChengSystem\Project\belfry");
        assert_eq!(uri, "file:///D:/ChengSystem/Project/belfry");
        assert_eq!(
            windows_uri_body_to_path(uri.strip_prefix("file://").unwrap()),
            r"D:\ChengSystem\Project\belfry"
        );
    }

    #[test]
    fn windows_unc_paths_keep_their_host() {
        assert_eq!(
            windows_path_to_uri(r"\\server\share\dir"),
            "file://server/share/dir"
        );
        assert_eq!(windows_round_trip(r"\\server\share\dir"), r"\\server\share\dir");
        // verbatim 形式的 UNC 要还原成普通 UNC，不能退化成 `UNC\server\...`
        assert_eq!(windows_round_trip(r"\\?\UNC\server\share"), r"\\server\share");
    }

    #[test]
    fn windows_non_ascii_paths_round_trip_without_encoding() {
        assert_eq!(
            windows_round_trip(r"D:\ChengSystem\我的 项目"),
            r"D:\ChengSystem\我的 项目"
        );
    }

    #[test]
    fn strip_verbatim_prefix_leaves_plain_paths_alone() {
        assert_eq!(strip_verbatim_prefix(r"C:\work"), r"C:\work");
        assert_eq!(strip_verbatim_prefix(r"\\server\share"), r"\\server\share");
        assert_eq!(strip_verbatim_prefix(r"\\?\C:\work"), r"C:\work");
        assert_eq!(strip_verbatim_prefix(r"\\?\UNC\server\share"), r"\\server\share");
    }
}
