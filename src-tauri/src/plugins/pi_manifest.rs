use super::manifest::{
    Command, Compatibility, PluginContributions, PluginManifest, Setting, Skill,
};
use serde_json::Value;
use std::collections::BTreeMap;

pub(super) const MAX_TEXT_BYTES: usize = 64 * 1024;
pub(super) const MAX_THEME_BYTES: usize = 256 * 1024;

pub(super) fn decode(bytes: &[u8]) -> Result<PluginManifest, String> {
    let value: Value = super::strict_json::parse(bytes)?;
    if value.get("main").is_some() {
        normalize(value)
    } else {
        if value.get("runtime").is_some() {
            return Err("runtime 为宿主内部字段，请使用 PI manifest 的 main 字段".into());
        }
        serde_json::from_value(value).map_err(|error| error.to_string())
    }
}

pub(super) fn normalize(value: Value) -> Result<PluginManifest, String> {
    super::pi_validation::validate(&value)?;
    Ok(PluginManifest {
        schema_version: 1,
        id: required(&value, "id")?,
        name: required(&value, "name")?,
        version: required(&value, "version")?,
        description: optional(&value, "description"),
        author: optional(&value, "author").unwrap_or_default(),
        icon: optional(&value, "icon")
            .map(|s| resource_path(&s))
            .transpose()?,
        compatibility: Compatibility {
            plugin_api: 1,
            min_app_version: "0.0.0".into(),
            max_app_version_exclusive: None,
        },
        permissions: strings(value.get("permissions"))?,
        activation_events: strings(value.get("activationEvents"))?,
        contributes: contributions(&value)?,
        runtime: Some(value),
    })
}

fn contributions(value: &Value) -> Result<PluginContributions, String> {
    let c = &value["contributes"];
    let commands = entries(c, "commands")?
        .iter()
        .map(|item| {
            Ok(Command {
                id: required(item, "id")?,
                title: required(item, "title")?,
                text: String::new(),
            })
        })
        .collect::<Result<_, String>>()?;
    let skills = entries(c, "skills")?
        .iter()
        .map(|item| {
            let path = resource_path(
                item.as_str()
                    .or_else(|| item["path"].as_str())
                    .ok_or("Skill 缺少 path")?,
            )?;
            let name = optional(item, "name").unwrap_or_else(|| path.clone());
            Ok(Skill {
                id: name.clone(),
                title: optional(item, "title").unwrap_or(name),
                path,
            })
        })
        .collect::<Result<_, String>>()?;
    let settings = entries(c, "settings")?
        .iter()
        .map(|item| {
            let key = required(item, "key")?;
            Ok(Setting {
                id: key.clone(),
                title: optional(item, "title").unwrap_or(key),
                description: optional(item, "description").unwrap_or_default(),
                default: item["default"]
                    .as_str()
                    .map(String::from)
                    .unwrap_or_else(|| item["default"].to_string()),
            })
        })
        .collect::<Result<_, String>>()?;
    Ok(PluginContributions {
        commands,
        skills,
        settings,
        legacy_harnesses: vec![],
    })
}

pub(super) fn resources(value: &Value, files: &BTreeMap<String, Vec<u8>>) -> Result<(), String> {
    let mut paths = vec![required(value, "main")?];
    paths.extend(optional(&value["ui"], "panel"));
    for (kind, key) in [("views", "entry"), ("themes", "path"), ("skills", "path")] {
        for item in entries(&value["contributes"], kind)? {
            paths.push(
                item.as_str()
                    .map(String::from)
                    .map(Ok)
                    .unwrap_or_else(|| required(item, key))?,
            );
        }
    }
    for path in paths {
        if !files.contains_key(&resource_path(&path)?) {
            return Err(format!("插件资源不存在：{path}"));
        }
    }
    for item in entries(&value["contributes"], "themes")? {
        let path = resource_path(&required(item, "path")?)?;
        let bytes = files.get(&path).ok_or("主题文件不存在")?;
        let text = std::str::from_utf8(bytes).map_err(|_| "主题必须为 UTF-8")?;
        if bytes.len() > MAX_THEME_BYTES
            || text
                .chars()
                .any(|c| c.is_control() && !['\n', '\r', '\t'].contains(&c))
        {
            return Err("主题正文超额或含控制字符".into());
        }
    }
    Ok(())
}

pub(super) fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        && !value.ends_with('.')
        && !value.contains("..")
}

pub(super) fn resource_path(value: &str) -> Result<String, String> {
    let clean = value.trim_start_matches("./");
    super::files::relative_path(clean)?;
    Ok(clean.into())
}

pub(super) fn required(value: &Value, key: &str) -> Result<String, String> {
    optional(value, key).ok_or_else(|| format!("PI manifest 缺少 {key}"))
}

pub(super) fn optional(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(String::from)
}

pub(super) fn strings(value: Option<&Value>) -> Result<Vec<String>, String> {
    match value {
        None => Ok(vec![]),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| {
                v.as_str()
                    .map(String::from)
                    .ok_or("字段必须为字符串数组".into())
            })
            .collect(),
        _ => Err("字段必须为字符串数组".into()),
    }
}

pub(super) fn entries<'a>(value: &'a Value, key: &str) -> Result<&'a [Value], String> {
    match value.get(key) {
        None => Ok(&[]),
        Some(Value::Array(items)) => Ok(items),
        _ => Err(format!("contributes.{key} 必须为数组")),
    }
}

pub(super) fn same_authority(old: &PluginManifest, new: &PluginManifest) -> bool {
    let policy = |manifest: &PluginManifest, key: &str| {
        manifest.runtime.as_ref().and_then(|v| v.get(key)).cloned()
    };
    old.runtime.is_some() == new.runtime.is_some()
        && ["fs", "net"]
            .iter()
            .all(|key| policy(old, key) == policy(new, key))
}
