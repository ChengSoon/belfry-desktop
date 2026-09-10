use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_MANIFEST_BYTES: usize = 1_048_576;
pub const MAX_CONTRIBUTIONS: usize = 100;
pub const HARNESS_REMOVED: &str = "Harness 功能已移除，请使用 PI 插件";
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Compatibility {
    pub plugin_api: u32,
    pub min_app_version: String,
    pub max_app_version_exclusive: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: String,
    pub icon: Option<String>,
    pub compatibility: Compatibility,
    pub permissions: Vec<String>,
    pub activation_events: Vec<String>,
    pub contributes: PluginContributions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime: Option<serde_json::Value>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginContributions {
    #[serde(default)]
    pub commands: Vec<Command>,
    #[serde(default)]
    pub skills: Vec<Skill>,
    #[serde(default)]
    pub settings: Vec<Setting>,
    // 仅解码旧 registry 以便诊断和卸载，不再注册为宿主贡献。
    #[serde(default, rename = "harnesses", skip_serializing_if = "Vec::is_empty")]
    pub legacy_harnesses: Vec<LegacyHarness>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    pub id: String,
    pub title: String,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Skill {
    pub id: String,
    pub title: String,
    pub path: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Setting {
    pub id: String,
    pub title: String,
    pub description: String,
    pub default: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyHarness {
    pub id: String,
    pub title: String,
    pub harness_plugin_id: String,
}

pub fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && !value.ends_with('.')
        && !value.contains("..")
}
pub fn version(value: &str) -> Result<[u32; 3], String> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 {
        return Err("版本必须为 major.minor.patch".into());
    }
    let mut result = [0; 3];
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty()
            || (part.len() > 1 && part.starts_with('0'))
            || !part.bytes().all(|b| b.is_ascii_digit())
        {
            return Err("版本无效".into());
        }
        result[index] = part.parse::<u16>().map_err(|_| "版本超出范围")? as u32;
    }
    Ok(result)
}
pub fn validate(manifest: &PluginManifest) -> Result<(), String> {
    if uses_removed_harness(manifest) {
        return Err(HARNESS_REMOVED.into());
    }
    if let Some(runtime) = &manifest.runtime {
        let normalized = super::pi_manifest::normalize(runtime.clone())?;
        return if &normalized == manifest {
            Ok(())
        } else {
            Err("PI 清单与宿主记录不一致".into())
        };
    }
    if manifest.schema_version != 1
        || manifest.compatibility.plugin_api != 1
        || !identifier(&manifest.id)
    {
        return Err("不支持的 manifest 版本或插件 ID".into());
    }
    version(&manifest.version)?;
    nonempty(&manifest.name)?;
    nonempty(&manifest.author)?;
    validate_compatibility(manifest)?;
    unique(&manifest.permissions)?;
    unique(&manifest.activation_events)?;
    for permission in &manifest.permissions {
        if !["commands", "skills", "settings"].contains(&permission.as_str()) {
            return Err(format!("未知权限：{permission}"));
        }
    }
    if manifest.activation_events.iter().any(|v| v != "onEnable") {
        return Err("P0 仅支持 onEnable 激活".into());
    }
    validate_contributions(manifest)?;
    let text = serde_json::to_value(manifest).map_err(|e| e.to_string())?;
    validate_text(&text)
}
fn validate_compatibility(manifest: &PluginManifest) -> Result<(), String> {
    let current = version(env!("CARGO_PKG_VERSION"))?;
    if current < version(&manifest.compatibility.min_app_version)? {
        return Err("插件需要更新的应用版本".into());
    }
    if let Some(max) = &manifest.compatibility.max_app_version_exclusive {
        if current >= version(max)? {
            return Err("插件不兼容当前应用版本".into());
        }
    }
    Ok(())
}
pub fn uses_removed_harness(manifest: &PluginManifest) -> bool {
    manifest
        .permissions
        .iter()
        .any(|permission| permission == "harnesses")
        || !manifest.contributes.legacy_harnesses.is_empty()
}
fn validate_contributions(m: &PluginManifest) -> Result<(), String> {
    let c = &m.contributes;
    let groups = [
        ("commands", c.commands.len()),
        ("skills", c.skills.len()),
        ("settings", c.settings.len()),
    ];
    for (permission, count) in groups {
        if count > MAX_CONTRIBUTIONS {
            return Err("贡献数量超额".into());
        }
        if count > 0 && !m.permissions.iter().any(|p| p == permission) {
            return Err(format!("贡献缺少声明权限：{permission}"));
        }
    }
    let ids: Vec<_> = c
        .commands
        .iter()
        .map(|v| &v.id)
        .chain(c.skills.iter().map(|v| &v.id))
        .chain(c.settings.iter().map(|v| &v.id))
        .cloned()
        .collect();
    if ids.iter().any(|v| !identifier(v)) {
        return Err("贡献 ID 无效".into());
    }
    unique(&ids)?;
    for item in &c.commands {
        nonempty(&item.title)?;
        nonempty(&item.text)?;
    }
    for item in &c.skills {
        nonempty(&item.title)?;
        super::files::relative_path(&item.path)?;
    }
    for item in &c.settings {
        nonempty(&item.title)?;
    }
    if let Some(icon) = &m.icon {
        super::files::relative_path(icon)?;
    }
    Ok(())
}
fn unique(items: &[String]) -> Result<(), String> {
    if items.iter().collect::<HashSet<_>>().len() != items.len() {
        return Err("重复标识".into());
    }
    Ok(())
}
fn nonempty(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err("名称或正文不能为空".into())
    } else {
        Ok(())
    }
}
pub(super) fn validate_text(value: &serde_json::Value) -> Result<(), String> {
    match value {
        serde_json::Value::String(s)
            if s.len() > 16_384
                || s.chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\t' && c != '\r') =>
        {
            Err("文本超额或含控制字符".into())
        }
        serde_json::Value::Array(items) => items.iter().try_for_each(validate_text),
        serde_json::Value::Object(items) => items.values().try_for_each(validate_text),
        _ => Ok(()),
    }
}
