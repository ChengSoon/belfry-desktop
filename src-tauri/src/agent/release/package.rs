//! 从 Agent CLI 的可执行文件反查它所属的 npm 包。
//!
//! 用户装的不一定是官方包：本机的 `claude` 可能是 `@cometix/claude-code` 这类
//! 第三方镜像。按 `AgentKind` 硬编码包名去升级，会静默把用户的镜像换成官方包。
//! 所以包名一律从可执行文件的位置反查，只有「完全没装」时才退回默认包名。

use std::path::Path;

use crate::agent::AgentKind;

const NODE_MODULES: &str = "node_modules";
const PACKAGE_JSON: &str = "package.json";
/// package.json 的大小上限。正常的 npm 包远不到这个数，超出就当它不是 npm 包。
const MAX_MANIFEST_BYTES: usize = 256 * 1024;

/// 反查结果：真实包名 + 本地版本。
pub(crate) struct Resolved {
    pub package: String,
    pub version: Option<String>,
}

/// 从可执行文件反查包名与本地版本。返回 `None` 表示它不是 npm 全局包
/// （Homebrew 原生二进制、scoop shim 之类），调用方据此落到 `Unmanaged`。
pub(crate) fn detect(executable: &Path) -> Option<Resolved> {
    if is_shim(executable) {
        // Windows 的 .cmd 是真实文件而非软链，包名只能从 shim 文本里抠。
        let text = std::fs::read_to_string(executable).ok()?;
        let package = shim_package(&text)?;
        let root = executable.parent()?.join(NODE_MODULES).join(&package);
        return Some(Resolved { package, version: read_manifest(&root).map(|(_, version)| version) });
    }
    let root = package_root(executable)?;
    let (package, version) = read_manifest(&root)?;
    Some(Resolved { package, version: Some(version) })
}

fn is_shim(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false)
}

/// 从可执行文件逐级向上找到它所属的包目录。
///
/// 覆盖 `node_modules/@scope/name/cli.js`、`node_modules/name/bin/cli.js`
/// 与 `node_modules/name/cli.js` 三种布局。
pub(crate) fn package_root(executable: &Path) -> Option<std::path::PathBuf> {
    let components: Vec<_> = executable.components().collect();
    // 从后往前找最近的 `node_modules`，它后面跟着的就是包目录。
    let index = components
        .iter()
        .rposition(|component| component.as_os_str() == std::ffi::OsStr::new(NODE_MODULES))?;
    // scoped 包占两段（`@scope/name`），普通包占一段。
    let after = &components[index + 1..];
    if after.is_empty() {
        return None;
    }
    let count = if after[0].as_os_str().to_string_lossy().starts_with('@') && after.len() >= 2 {
        2
    } else {
        1
    };
    Some(components[..=index + count].iter().collect())
}

/// 读包目录下的 `package.json`，取 `name` + `version`。
///
/// 这比解析 `--version` 输出干净得多：后者返回的是 `"2.1.201 (Claude Code)"`、
/// `"codex-cli 0.154.0"` 这类带噪声的首行。
pub(crate) fn read_manifest(root: &Path) -> Option<(String, String)> {
    let content = std::fs::read(root.join(PACKAGE_JSON)).ok()?;
    if content.len() > MAX_MANIFEST_BYTES {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(&content).ok()?;
    let name = value.get("name")?.as_str()?.to_string();
    let version = value.get("version")?.as_str()?.to_string();
    Some((name, version))
}

/// 解析 Windows npm cmd-shim 文本，取出它指向的包名。
///
/// shim 末行形如：
/// `... "%_prog%"  "%dp0%\node_modules\@cometix\claude-code\cli.js" %*`
/// 定位 `node_modules` 后取后续 1~2 段（首段以 `@` 开头则是 scope，取两段）。
/// pnpm / bun / scoop 的 shim 格式不同，解析失败由调用方如实降级。
pub(crate) fn shim_package(text: &str) -> Option<String> {
    let anchor = text.rfind(NODE_MODULES)?;
    let rest = text[anchor + NODE_MODULES.len()..]
        .trim_start_matches(|character| character == '\\' || character == '/');
    // 末尾可能还挂着引号和 `%*` 之类的参数，按引号或空白切断。
    let rest = rest.split(|character| character == '"' || character == ' ').next()?;
    let mut parts = rest
        .split(|character: char| character == '\\' || character == '/')
        .filter(|part| !part.is_empty());
    let head = parts.next()?;
    let package = if head.starts_with('@') {
        format!("{}/{}", head, parts.next()?)
    } else {
        head.to_string()
    };
    (!package.is_empty()).then_some(package)
}

/// 反查不到包名时，仅用于「未安装 → 安装」的官方默认包名。
pub(crate) fn default_package(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Codex => "@openai/codex",
        AgentKind::Claude => "@anthropic-ai/claude-code",
        AgentKind::Pi => "@earendil-works/pi-coding-agent",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    #[test]
    fn package_root_handles_scope_and_bin_subdirectory() {
        let scoped = Path::new("/usr/local/lib/node_modules/@cometix/claude-code/cli.js");
        assert_eq!(
            package_root(scoped),
            Some(PathBuf::from("/usr/local/lib/node_modules/@cometix/claude-code"))
        );
        let with_bin = Path::new("/usr/local/lib/node_modules/@openai/codex/bin/codex.js");
        assert_eq!(
            package_root(with_bin),
            Some(PathBuf::from("/usr/local/lib/node_modules/@openai/codex"))
        );
        let unscoped = Path::new("/home/u/.nvm/versions/node/v24/lib/node_modules/pi/dist/cli.js");
        assert_eq!(
            package_root(unscoped),
            Some(PathBuf::from("/home/u/.nvm/versions/node/v24/lib/node_modules/pi"))
        );
    }

    #[test]
    fn package_root_rejects_paths_outside_node_modules() {
        assert_eq!(package_root(Path::new("/usr/local/bin/claude")), None);
        assert_eq!(package_root(Path::new("/opt/homebrew/bin/codex")), None);
    }

    #[test]
    fn read_manifest_picks_name_and_version() {
        let dir = tempfile_dir();
        std::fs::write(dir.join(PACKAGE_JSON), r#"{"name":"@openai/codex","version":"0.154.0"}"#).unwrap();
        assert_eq!(read_manifest(&dir), Some(("@openai/codex".into(), "0.154.0".into())));
    }

    #[test]
    fn read_manifest_rejects_manifest_without_required_fields() {
        let dir = tempfile_dir();
        std::fs::write(dir.join(PACKAGE_JSON), r#"{"name":"nope"}"#).unwrap();
        assert_eq!(read_manifest(&dir), None);
    }

    #[test]
    fn shim_package_parses_real_cmd_shim_tail() {
        let text = r#"
@ECHO off
SETLOCAL
CALL :find_dp0
"%_prog%"  "%dp0%\node_modules\@cometix\claude-code\cli.js" %*
ENDLOCAL
"#;
        assert_eq!(shim_package(text), Some("@cometix/claude-code".into()));
    }

    #[test]
    fn shim_package_parses_unscoped_package() {
        let text = "\"%dp0%\\node_modules\\pi\\dist\\bundle\\cli.js\" %*";
        assert_eq!(shim_package(text), Some("pi".into()));
    }

    #[test]
    fn shim_package_rejects_other_shim_formats() {
        // pnpm 的 shim 只指向自己，没有 node_modules 相对路径。
        assert_eq!(shim_package("#!/bin/sh\nexec \"$0\" \"$@\""), None);
        assert_eq!(shim_package(""), None);
    }

    fn tempfile_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("belfry-package-{}", ulid::Ulid::generate()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
