use super::manifest::{MAX_MANIFEST_BYTES, PluginManifest};
pub use super::paths::relative_path;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
};

pub const MAX_FILES: usize = 2000;
pub const MAX_ENTRIES: usize = MAX_FILES * 2;
pub const MAX_TOTAL_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_FILE_BYTES: u64 = MAX_TOTAL_BYTES as u64;
pub(super) const MAX_DEPTH: usize = 12;
#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot {
    pub root: PathBuf,
    pub manifest: PluginManifest,
    pub files: BTreeMap<String, Vec<u8>>,
}
pub fn read_snapshot(root: &Path) -> Result<Snapshot, String> {
    if fs::symlink_metadata(root)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("插件根目录不能是符号链接".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("请选择插件目录".into());
    }
    let mut reader = DirectoryReader {
        root: &root,
        files: BTreeMap::new(),
        names: HashSet::new(),
        entries: 0,
        total_bytes: 0,
        pi_source: is_pi_source(&root)?,
    };
    reader.collect(&root, 0)?;
    snapshot_from_files(root.clone(), reader.files)
}
pub(super) fn snapshot_from_files(
    root: PathBuf,
    files: BTreeMap<String, Vec<u8>>,
) -> Result<Snapshot, String> {
    let bytes = files
        .get("manifest.json")
        .ok_or("根目录缺少 manifest.json")?;
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err("manifest 超额".into());
    }
    let manifest = super::pi_manifest::decode(bytes)?;
    super::manifest::validate(&manifest)?;
    if let Some(runtime) = &manifest.runtime {
        super::pi_manifest::resources(runtime, &files)?;
    }
    validate_resources(&manifest, &files)?;
    Ok(Snapshot {
        root,
        manifest,
        files,
    })
}
struct DirectoryReader<'a> {
    root: &'a Path,
    files: BTreeMap<String, Vec<u8>>,
    names: HashSet<String>,
    entries: usize,
    total_bytes: usize,
    pi_source: bool,
}
impl DirectoryReader<'_> {
    fn collect(&mut self, dir: &Path, depth: usize) -> Result<(), String> {
        if depth > MAX_DEPTH {
            return Err("目录层数超额".into());
        }
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if self.pi_source
                && entry.file_name().to_str().is_some_and(|name| {
                    [".git", "node_modules", "dist", ".DS_Store", "Thumbs.db"].contains(&name)
                })
            {
                continue;
            }
            self.entries += 1;
            if self.entries > MAX_ENTRIES {
                return Err("目录总条目超额（含空目录）".into());
            }
            let path = entry.path();
            if self.pi_source {
                self.reserve_name(&path)?;
            }
            let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if metadata.file_type().is_symlink()
                || !path
                    .canonicalize()
                    .map_err(|e| e.to_string())?
                    .starts_with(self.root)
            {
                return Err("拒绝符号链接或路径逃逸".into());
            }
            if metadata.is_dir() {
                self.collect(&path, depth + 1)?;
            } else {
                self.read_file(&path, &metadata)?;
            }
        }
        Ok(())
    }
    fn reserve_name(&mut self, path: &Path) -> Result<(), String> {
        let name = path
            .strip_prefix(self.root)
            .map_err(|e| e.to_string())?
            .to_str()
            .ok_or("路径不是 UTF-8")?
            .replace(std::path::MAIN_SEPARATOR, "/");
        super::paths::portable_path(&name)?;
        if !self.names.insert(name.to_lowercase()) {
            return Err("插件路径大小写冲突".into());
        }
        Ok(())
    }
    fn read_file(&mut self, path: &Path, metadata: &fs::Metadata) -> Result<(), String> {
        if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES || self.files.len() >= MAX_FILES {
            return Err("文件类型无效或数量/大小超额".into());
        }
        let relative = path
            .strip_prefix(self.root)
            .map_err(|e| e.to_string())?
            .to_str()
            .ok_or("路径不是 UTF-8")?
            .replace(std::path::MAIN_SEPARATOR, "/");
        relative_path(&relative)?;
        let bytes = bounded_read(path, MAX_FILE_BYTES)?;
        self.total_bytes += bytes.len();
        if self.total_bytes > MAX_TOTAL_BYTES {
            return Err("插件目录总大小超额".into());
        }
        self.files.insert(relative, bytes);
        Ok(())
    }
}
pub fn bounded_read(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("文件大小超额".into());
    }
    Ok(bytes)
}
fn validate_resources(m: &PluginManifest, files: &BTreeMap<String, Vec<u8>>) -> Result<(), String> {
    for skill in &m.contributes.skills {
        let bytes = files.get(&skill.path).ok_or("Skill 文件不存在")?;
        let text = std::str::from_utf8(bytes).map_err(|_| "Skill 必须为 UTF-8")?;
        let limit = if m.runtime.is_some() {
            super::pi_manifest::MAX_TEXT_BYTES
        } else {
            16_384
        };
        if text.len() > limit
            || text
                .chars()
                .any(|c| c.is_control() && !['\n', '\r', '\t'].contains(&c))
        {
            return Err("Skill 正文超额或含控制字符".into());
        }
    }
    if let Some(icon) = m.icon.as_ref().filter(|_| m.runtime.is_none()) {
        if !files.contains_key(icon) {
            return Err("图标文件不存在".into());
        }
    }
    Ok(())
}
fn is_pi_source(root: &Path) -> Result<bool, String> {
    let path = root.join("manifest.json");
    if fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("manifest 不能为符号链接".into());
    }
    let value: serde_json::Value =
        super::strict_json::parse(&bounded_read(&path, MAX_MANIFEST_BYTES as u64)?)?;
    Ok(value.get("main").is_some())
}
pub fn copy_snapshot(snapshot: &Snapshot, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination).map_err(|e| e.to_string())?;
    for (name, bytes) in &snapshot.files {
        let path = destination.join(relative_path(name)?);
        fs::create_dir_all(path.parent().ok_or("文件路径无父目录")?).map_err(|e| e.to_string())?;
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
// 摘要供预览标识；安装授权比较完整文件快照，不依赖非加密摘要的抗碰撞性。
pub fn digest(snapshot: &Snapshot) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for (name, bytes) in &snapshot.files {
        for byte in name.as_bytes().iter().chain(bytes) {
            hash = (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
        }
    }
    format!("fnv1a64:{hash:016x}")
}
