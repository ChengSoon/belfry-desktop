use super::{
    files::{self, MAX_DEPTH, MAX_ENTRIES, MAX_FILES, MAX_TOTAL_BYTES, Snapshot},
    zip,
};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::Path,
};

const MAX_PACKAGE_BYTES: u64 = (MAX_TOTAL_BYTES + 2 * 1024 * 1024) as u64;

pub(super) fn read_source(path: &Path, development: bool) -> Result<Snapshot, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("插件来源不能是符号链接".into());
    }
    if metadata.is_dir() {
        return files::read_snapshot(path);
    }
    if development {
        return Err("开发加载请选择插件目录，不能引用插件包".into());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !metadata.is_file()
        || !["piplug", "zip"]
            .iter()
            .any(|value| extension.eq_ignore_ascii_case(value))
    {
        return Err("请选择 .piplug / .zip 插件包或插件目录".into());
    }
    let root = path.canonicalize().map_err(|e| e.to_string())?;
    let bytes = files::bounded_read(&root, MAX_PACKAGE_BYTES)?;
    let members = zip::read_entries(&bytes)?;
    let mut paths = PackagePaths::default();
    let mut files = BTreeMap::new();
    let mut total = 0;
    for member in members {
        let name = validate_path(&member)?;
        paths.reserve(name, member.directory)?;
        if member.directory {
            continue;
        }
        total += member.bytes.len();
        if total > MAX_TOTAL_BYTES || files.len() >= MAX_FILES {
            return Err("插件包文件数量或总大小超额".into());
        }
        files.insert(name.to_owned(), member.bytes.to_vec());
    }
    files::snapshot_from_files(root, files)
}
fn validate_path<'a>(member: &zip::Entry<'a>) -> Result<&'a str, String> {
    let name = if member.directory {
        member.name.strip_suffix('/').unwrap_or(member.name)
    } else {
        member.name
    };
    super::paths::portable_path(name)?;
    let parts: Vec<_> = name.split('/').collect();
    let depth = parts.len() - usize::from(!member.directory);
    if depth > MAX_DEPTH {
        return Err("插件包目录层数超额".into());
    }
    Ok(name)
}
#[derive(Default)]
struct PackagePaths {
    explicit: HashSet<String>,
    nodes: BTreeMap<String, (String, bool)>,
}
impl PackagePaths {
    fn reserve(&mut self, name: &str, directory: bool) -> Result<(), String> {
        if !self.explicit.insert(name.to_lowercase()) {
            return Err("插件包包含重复路径".into());
        }
        let mut path = String::new();
        let parts: Vec<_> = name.split('/').collect();
        for (index, part) in parts.iter().enumerate() {
            if !path.is_empty() {
                path.push('/');
            }
            path.push_str(part);
            let file = !directory && index + 1 == parts.len();
            let key = path.to_lowercase();
            if let Some((original, was_file)) = self.nodes.get(&key) {
                if original != &path || *was_file || file {
                    return Err("插件包路径重名或文件/目录冲突".into());
                }
            } else {
                self.nodes.insert(key, (path.clone(), file));
            }
            if self.nodes.len() > MAX_ENTRIES {
                return Err("插件包总条目超额（含隐含目录）".into());
            }
        }
        Ok(())
    }
}
