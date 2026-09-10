use super::pi_manifest::{entries, identifier, required, resource_path, strings};
use serde_json::Value;

const SETTING_TYPES: &[&str] = &["string", "number", "boolean", "select", "json", "shortcut"];
pub(super) fn validate(value: &Value) -> Result<(), String> {
    super::pi_engine::validate(value.get("engines"))?;
    metadata(value)?;
    if let Some(title) = value["ui"].get("title") {
        localized(title)?;
    }
    for key in ["width", "height"] {
        if value["ui"]
            .get(key)
            .is_some_and(|v| !v.as_f64().is_some_and(|n| n.is_finite() && n > 0.0))
        {
            return Err("面板尺寸无效".into());
        }
    }
    contribution_fields(value)?;
    for item in entries(&value["contributes"], "settings")? {
        setting(item)?;
    }
    for item in entries(&value["contributes"], "mcpServers")? {
        super::pi_mcp::validate(item, value)?;
    }
    bus(value)
}
fn metadata(value: &Value) -> Result<(), String> {
    if ![".js", ".cjs", ".mjs"]
        .iter()
        .any(|ext| value["main"].as_str().is_some_and(|s| s.ends_with(ext)))
    {
        return Err("main 必须为 JavaScript 入口".into());
    }
    for key in ["author", "description"] {
        if value.get(key).is_some_and(|v| !v.is_string()) {
            return Err(format!("{key} 必须为字符串"));
        }
    }
    if let Some(icon) = value.get("icon") {
        resource_path(icon.as_str().ok_or("icon 必须为路径")?)?;
    }
    for key in ["ui", "fs", "net"] {
        if value.get(key).is_some_and(|v| !v.is_object()) {
            return Err(format!("{key} 必须为对象"));
        }
    }
    Ok(())
}
fn contribution_fields(value: &Value) -> Result<(), String> {
    let c = &value["contributes"];
    let groups = [
        ("commands", "id"),
        ("agentTools", "name"),
        ("settings", "key"),
        ("views", "id"),
        ("themes", "id"),
        ("services", "id"),
        ("mcpServers", "id"),
    ];
    if let Some(object) = c.as_object() {
        for key in object.keys() {
            if !groups.iter().any(|(kind, _)| kind == key)
                && !["skills", "bus", "harnesses"].contains(&key.as_str())
            {
                return Err(format!("未知贡献：{key}"));
            }
        }
    }
    for (group, field) in groups {
        for item in entries(c, group)? {
            if !identifier(&required(item, field)?) {
                return Err(format!("{group} 标识无效"));
            }
        }
    }
    descriptors(c)
}
fn descriptors(c: &Value) -> Result<(), String> {
    for item in entries(c, "commands")? {
        required(item, "title")?;
        strings(item.get("keywords"))?;
    }
    for item in entries(c, "agentTools")? {
        required(item, "description")?;
        if item.get("schema").is_some_and(|v| !v.is_object()) {
            return Err("工具 schema 必须为对象".into());
        }
    }
    for item in entries(c, "views")? {
        localized(&item["title"])?;
        resource_path(&required(item, "entry")?)?;
    }
    for item in entries(c, "themes")? {
        required(item, "label")?;
        resource_path(&required(item, "path")?)?;
        if item
            .get("base")
            .is_some_and(|v| !matches!(v.as_str(), Some("light" | "dark")))
        {
            return Err("主题 base 无效".into());
        }
    }
    Ok(())
}
fn localized(value: &Value) -> Result<(), String> {
    if value.as_str().is_some_and(|s| !s.trim().is_empty()) {
        return Ok(());
    }
    if value.as_object().is_some_and(|object| {
        !object.is_empty()
            && object
                .values()
                .all(|v| v.as_str().is_some_and(|s| !s.trim().is_empty()))
    }) {
        Ok(())
    } else {
        Err("本地化标题无效".into())
    }
}
fn setting(item: &Value) -> Result<(), String> {
    let kind = item["type"].as_str().ok_or("设置缺少 type")?;
    if !SETTING_TYPES.contains(&kind) || item["secret"] == true {
        return Err("设置类型无效，或要求尚未提供的机密存储".into());
    }
    if item.get("title").is_some() {
        required(item, "title")?;
    }
    if kind == "select" {
        return select_setting(item);
    }
    setting_default(kind, item.get("default"))
}
fn setting_default(kind: &str, default: Option<&Value>) -> Result<(), String> {
    if let Some(default) = default {
        let valid = match kind {
            "string" | "shortcut" => default.is_string(),
            "number" => default.is_number(),
            "boolean" => default.is_boolean(),
            _ => true,
        };
        if !valid {
            return Err("设置默认值类型无效".into());
        }
    }
    Ok(())
}
fn select_setting(item: &Value) -> Result<(), String> {
    let choices = item["enum"]
        .as_array()
        .filter(|items| !items.is_empty())
        .ok_or("设置选项无效")?;
    for choice in choices {
        if !choice["label"].is_string()
            || !(choice["value"].is_string()
                || choice["value"].is_number()
                || choice["value"].is_boolean())
        {
            return Err("设置选项无效".into());
        }
    }
    if let Some(default) = item.get("default") {
        if !choices.iter().any(|choice| &choice["value"] == default) {
            return Err("默认设置不在选项中".into());
        }
    }
    Ok(())
}
fn bus(manifest: &Value) -> Result<(), String> {
    let Some(value) = manifest["contributes"].get("bus") else {
        return Ok(());
    };
    if !value.is_object() {
        return Err("bus 必须为对象".into());
    }
    let permissions = strings(manifest.get("permissions"))?;
    for mode in ["publish", "subscribe"] {
        let topics = strings(value.get(mode))?;
        if !topics.is_empty() && !permissions.contains(&format!("bus.{mode}")) {
            return Err(format!("bus.{mode} 缺少权限"));
        }
        for topic in topics {
            if !valid_topic(&topic, mode) {
                return Err("消息主题无效".into());
            }
        }
    }
    Ok(())
}
fn valid_topic(topic: &str, mode: &str) -> bool {
    topic.len() <= 128
        && topic.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                || mode == "subscribe" && ["*", "**"].contains(&part)
        })
}
