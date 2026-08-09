//! 把会话工作目录归拢到所属项目根。
//!
//! Agent 常在项目子目录里启动（例如在 `otty-win/src-tauri` 跑 Codex），
//! 直接按原始 cwd 分组会让 `src-tauri` 和 `otty-win` 并列成两个项目。
//! 这里向上找最近的带项目标记的祖先目录作为归属，找不到就保留原路径。

use std::collections::HashMap;
use std::path::Path;

use super::contracts::ProjectUsage;

/// 项目根标记。`.git` 覆盖绝大多数情况，其余是常见生态的根文件。
const ROOT_MARKERS: [&str; 6] = [
    ".git",
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
    "pom.xml",
];

/// 合并同一项目根下的用量。同一路径只探测一次文件系统。
pub fn roll_up(projects: Vec<ProjectUsage>) -> Vec<ProjectUsage> {
    let mut resolved: HashMap<String, String> = HashMap::new();
    let mut merged: HashMap<String, ProjectUsage> = HashMap::new();

    for project in projects {
        let root = resolved
            .entry(project.root_path.clone())
            .or_insert_with(|| resolve_root(&project.root_path))
            .clone();
        match merged.get_mut(&root) {
            Some(existing) => existing.tokens.add(project.tokens),
            None => {
                merged.insert(
                    root.clone(),
                    ProjectUsage {
                        name: display_name(&root),
                        root_path: root,
                        tokens: project.tokens,
                    },
                );
            }
        }
    }

    let mut projects: Vec<ProjectUsage> = merged.into_values().collect();
    projects.sort_by(|a, b| {
        b.tokens
            .total()
            .cmp(&a.tokens.total())
            .then_with(|| a.root_path.cmp(&b.root_path))
    });
    projects
}

/// 归属目录 = 连续带标记链的最外层。
///
/// 不能用"最近的带标记祖先"：子目录常自带清单（`otty-win/src-tauri/Cargo.toml`），
/// 那样会把子目录判成独立项目。所以先找到最近的带标记目录，再沿父链继续上移，
/// 直到父目录不再带标记为止。父目录一旦没有标记就停，避免一路归拢到家目录。
fn resolve_root(path: &str) -> String {
    let mut nearest: Option<&Path> = None;
    let mut current = Some(Path::new(path));

    while let Some(directory) = current {
        // 到达文件系统根就停：再往上没有项目语义。
        if directory.parent().is_none() {
            break;
        }
        if has_marker(directory) {
            nearest = Some(directory);
            // 继续上移，让外层项目根胜出。
            current = directory.parent();
            continue;
        }
        // 已经找到过标记且当前层没有 → 链断，上一层就是最外层。
        if nearest.is_some() {
            break;
        }
        current = directory.parent();
    }

    nearest
        .map(|directory| directory.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn has_marker(directory: &Path) -> bool {
    ROOT_MARKERS
        .iter()
        .any(|marker| directory.join(marker).exists())
}

fn display_name(root: &str) -> String {
    Path::new(root)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(root)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage::contracts::TokenTotals;

    fn usage(root: &str, output: u64) -> ProjectUsage {
        ProjectUsage {
            root_path: root.to_string(),
            name: display_name(root),
            tokens: TokenTotals {
                output,
                ..TokenTotals::default()
            },
        }
    }

    fn temp_project(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("otty-roots-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("nested/deeper")).unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        dir
    }

    #[test]
    fn folds_subdirectory_sessions_into_the_project_root() {
        let root = temp_project("fold");
        let root_str = root.to_string_lossy().to_string();
        let nested = root.join("nested").to_string_lossy().to_string();
        let deeper = root.join("nested/deeper").to_string_lossy().to_string();

        let result = roll_up(vec![
            usage(&root_str, 10),
            usage(&nested, 5),
            usage(&deeper, 1),
        ]);

        assert_eq!(result.len(), 1, "子目录必须并入项目根");
        assert_eq!(result[0].tokens.output, 16);
        assert_eq!(result[0].root_path, root_str);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 真实场景：otty-win/package.json + otty-win/src-tauri/Cargo.toml。
    /// 子目录自带清单时不能被判成独立项目。
    #[test]
    fn nested_manifests_still_fold_into_the_outer_project() {
        let dir = std::env::temp_dir().join(format!("otty-roots-nested-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let outer = dir.join("otty-win");
        let inner = outer.join("src-tauri");
        std::fs::create_dir_all(&inner).unwrap();
        std::fs::write(outer.join("package.json"), "{}").unwrap();
        std::fs::write(inner.join("Cargo.toml"), "").unwrap();

        let result = roll_up(vec![
            usage(&outer.to_string_lossy(), 10),
            usage(&inner.to_string_lossy(), 4),
        ]);

        assert_eq!(result.len(), 1, "带清单的子目录仍应并入外层项目");
        assert_eq!(result[0].root_path, outer.to_string_lossy());
        assert_eq!(result[0].name, "otty-win");
        assert_eq!(result[0].tokens.output, 14);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 父目录不带标记时必须停住，不能一路归拢到家目录。
    #[test]
    fn rollup_stops_when_the_marker_chain_breaks() {
        let dir = std::env::temp_dir().join(format!("otty-roots-stop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // plain 不带标记，其下两个独立项目不应被合并
        let plain = dir.join("plain");
        let first = plain.join("first");
        let second = plain.join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        std::fs::write(first.join("package.json"), "{}").unwrap();
        std::fs::write(second.join("package.json"), "{}").unwrap();

        let result = roll_up(vec![
            usage(&first.to_string_lossy(), 1),
            usage(&second.to_string_lossy(), 2),
        ]);
        assert_eq!(result.len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_unrelated_projects_separate() {
        let first = temp_project("first");
        let second = temp_project("second");
        let result = roll_up(vec![
            usage(&first.to_string_lossy(), 3),
            usage(&second.to_string_lossy(), 4),
        ]);
        assert_eq!(result.len(), 2);
        // 按用量降序
        assert_eq!(result[0].tokens.output, 4);

        let _ = std::fs::remove_dir_all(&first);
        let _ = std::fs::remove_dir_all(&second);
    }

    #[test]
    fn paths_without_any_marker_keep_their_own_identity() {
        let result = roll_up(vec![usage("/__otty_no_marker_dir__/work", 2)]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].root_path, "/__otty_no_marker_dir__/work");
        assert_eq!(result[0].tokens.output, 2);
    }

    #[test]
    fn empty_input_yields_empty_output() {
        assert!(roll_up(Vec::new()).is_empty());
    }
}
