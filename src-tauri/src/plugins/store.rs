use super::manifest::{PluginContributions, PluginManifest};
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf};

const STORE_FORMAT: &str = "belfry-directory-plugins-v1";
const MAX_REGISTRY_BYTES: u64 = 32 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginEntry {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub source: String,
    pub source_path: PathBuf,
    pub installed_at: u64,
    pub updated_at: u64,
    pub error: Option<String>,
    #[serde(skip)]
    pub active_contributions: PluginContributions,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginRegistry {
    pub format: String,
    pub store_schema_version: u32,
    pub revision: String,
    pub plugins: Vec<PluginEntry>,
}
impl Default for PluginRegistry {
    fn default() -> Self {
        Self {
            format: STORE_FORMAT.into(),
            store_schema_version: 1,
            revision: "0".into(),
            plugins: Vec::new(),
        }
    }
}
pub struct PluginStore {
    path: PathBuf,
}
impl PluginStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    pub fn load(&self) -> Result<PluginRegistry, String> {
        if !self.path.try_exists().map_err(|e| e.to_string())? {
            return Ok(PluginRegistry::default());
        }
        let bytes = super::files::bounded_read(&self.path, MAX_REGISTRY_BYTES)?;
        let registry: PluginRegistry = super::strict_json::parse(&bytes)?;
        validate_registry(&registry)?;
        Ok(registry)
    }
    pub fn save(&self, registry: &PluginRegistry) -> Result<(), String> {
        validate_registry(registry)?;
        let parent = self.path.parent().ok_or("registry 路径无父目录")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temp = parent.join(format!(".registry-v1.{}.tmp", ulid::Ulid::generate()));
        let text = serde_json::to_vec_pretty(registry).map_err(|e| e.to_string())?;
        if text.len() as u64 > MAX_REGISTRY_BYTES {
            return Err("registry 大小超额".into());
        }
        let result = write_temp(&temp, &text)
            .and_then(|_| fs::rename(&temp, &self.path).map_err(|e| e.to_string()));
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }
}
fn write_temp(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}
fn validate_registry(registry: &PluginRegistry) -> Result<(), String> {
    if registry.format != STORE_FORMAT || registry.store_schema_version != 1 {
        return Err("不支持旧 registry，原文件已保留".into());
    }
    decimal_revision(&registry.revision)?;
    if registry.plugins.len() > 50 {
        return Err("插件数量超额".into());
    }
    let mut ids = std::collections::HashSet::new();
    for entry in &registry.plugins {
        if !super::pi_manifest::identifier(&entry.manifest.id) || !ids.insert(&entry.manifest.id) {
            return Err("registry 插件 ID 无效或重复".into());
        }
        if !["installed", "development"].contains(&entry.source.as_str())
            || !entry.source_path.is_absolute()
        {
            return Err("registry 来源无效".into());
        }
    }
    Ok(())
}
fn decimal_revision(value: &str) -> Result<u64, String> {
    if value.is_empty()
        || !value.bytes().all(|b| b.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err("registry revision 无效".into());
    }
    value.parse().map_err(|_| "registry revision 超额".into())
}
pub fn next_revision(value: &str) -> Result<String, String> {
    decimal_revision(value)?
        .checked_add(1)
        .map(|v| v.to_string())
        .ok_or_else(|| "registry revision 已耗尽".into())
}
