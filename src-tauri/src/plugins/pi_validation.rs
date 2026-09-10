use super::pi_manifest::{entries, identifier, optional, required, resource_path, strings};
use serde_json::Value;
use std::collections::HashSet;

const PERMISSIONS: &[&str] = &[
    "ui.panel",
    "ui.view",
    "ui.theme",
    "notify",
    "clipboard.read",
    "clipboard.write",
    "fs.read",
    "fs.write",
    "fs.delete",
    "fs.read.workspace",
    "fs.write.workspace",
    "fs.delete.workspace",
    "shell.openExternal",
    "net.fetch",
    "agent.tool.register",
    "agent.prompt.inject",
    "agent.complete",
    "models.list",
    "session.read",
    "mcp.server.local",
    "mcp.server.remote",
    "background.service",
    "bus.publish",
    "bus.subscribe",
    "browser.cdp",
    "browser.control",
    "browser.read",
    "browser.interact",
    "browser.evaluate",
];

pub(super) fn validate(value: &Value) -> Result<(), String> {
    super::manifest::validate_text(value)?;
    value.as_object().ok_or("manifest 必须为对象")?;
    // 与上游一致：保留市场 / 本地化元数据，仅校验宿主实际使用的字段。
    if value["schemaVersion"] != 1 || !identifier(&required(value, "id")?) {
        return Err("PI manifest 版本或 ID 无效".into());
    }
    required(value, "name")?;
    let version = required(value, "version")?;
    validate_version(&version)?;
    resource_path(&required(value, "main")?)?;
    let permissions = strings(value.get("permissions"))?;
    unique(permissions.iter().map(String::as_str))?;
    if permissions.iter().any(|p| p == "harnesses") {
        return Err(super::manifest::HARNESS_REMOVED.into());
    }
    for permission in &permissions {
        if !PERMISSIONS.contains(&permission.as_str()) {
            return Err(format!("未知 PI 插件权限：{permission}"));
        }
    }
    unique(
        strings(value.get("activationEvents"))?
            .iter()
            .map(String::as_str),
    )?;
    validate_contributions(value, &permissions)?;
    validate_policies(value, &permissions)?;
    super::pi_fields::validate(value)
}
fn validate_version(value: &str) -> Result<(), String> {
    let (source, build) = value
        .split_once('+')
        .map(|(a, b)| (a, Some(b)))
        .unwrap_or((value, None));
    let (core, pre) = source
        .split_once('-')
        .map(|(a, b)| (a, Some(b)))
        .unwrap_or((source, None));
    super::manifest::version(core)?;
    for (suffix, prerelease) in [(pre, true), (build, false)] {
        let Some(suffix) = suffix else {
            continue;
        };
        if suffix.split('.').any(|part| {
            part.is_empty()
                || !part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                || prerelease
                    && part.len() > 1
                    && part.starts_with('0')
                    && part.bytes().all(|b| b.is_ascii_digit())
        }) {
            return Err("插件版本后缀无效".into());
        }
    }
    Ok(())
}

fn validate_contributions(value: &Value, permissions: &[String]) -> Result<(), String> {
    let c = &value["contributes"];
    if !c.is_null() && !c.is_object() {
        return Err("contributes 必须为对象".into());
    }
    let groups = [
        ("commands", "id"),
        ("agentTools", "name"),
        ("settings", "key"),
        ("views", "id"),
        ("themes", "id"),
        ("services", "id"),
        ("mcpServers", "id"),
    ];
    for (kind, field) in groups {
        let items = entries(c, kind)?;
        if items.len() > super::manifest::MAX_CONTRIBUTIONS {
            return Err(format!("{kind} 贡献数量超额"));
        }
        let ids = items
            .iter()
            .map(|item| required(item, field))
            .collect::<Result<Vec<_>, _>>()?;
        unique(ids.iter().map(String::as_str))?;
    }
    if entries(c, "skills")?.len() > super::manifest::MAX_CONTRIBUTIONS {
        return Err("Skill 数量超额".into());
    }
    contribution_permissions(value, permissions)
}
fn contribution_permissions(value: &Value, permissions: &[String]) -> Result<(), String> {
    let c = &value["contributes"];
    for (kind, permission) in [
        ("agentTools", "agent.tool.register"),
        ("skills", "agent.prompt.inject"),
        ("views", "ui.view"),
        ("themes", "ui.theme"),
        ("services", "background.service"),
    ] {
        if !entries(c, kind)?.is_empty() && !permissions.iter().any(|p| p == permission) {
            return Err(format!("{kind} 缺少权限 {permission}"));
        }
    }
    if optional(&value["ui"], "panel").is_some() && !permissions.iter().any(|p| p == "ui.panel") {
        return Err("panel 缺少 ui.panel 权限".into());
    }
    if !entries(c, "harnesses")?.is_empty() {
        return Err(super::manifest::HARNESS_REMOVED.into());
    }
    Ok(())
}

fn validate_policies(value: &Value, permissions: &[String]) -> Result<(), String> {
    for mode in ["read", "write", "delete"] {
        file_policy(&value["fs"][mode], mode, permissions)?;
    }
    for domain in strings(value.get("net").and_then(|net| net.get("domains")))? {
        let plain = domain.strip_prefix("*.").unwrap_or(&domain);
        if plain.is_empty()
            || plain.contains(['/', ':', '@', '*'])
            || plain.chars().any(char::is_whitespace)
        {
            return Err("net.domains 必须为域名列表".into());
        }
    }
    Ok(())
}
fn file_policy(rule: &Value, mode: &str, permissions: &[String]) -> Result<(), String> {
    if rule.is_null() {
        return Ok(());
    }
    if !rule.is_object() || !permissions.contains(&format!("fs.{mode}")) {
        return Err(format!("fs.{mode} 范围无效或缺少权限"));
    }
    if let Some(root) = rule.get("root") {
        if !matches!(root.as_str(), Some("workspace" | "userSelected")) {
            return Err("文件范围 root 无效".into());
        }
    }
    for pattern in strings(rule.get("scope"))? {
        resource_path(&pattern)?;
        if mode != "read" && ["**", "**/*", "*"].contains(&pattern.as_str()) {
            return Err("写入和删除范围不能覆盖整个工作区".into());
        }
    }
    Ok(())
}

fn unique<'a>(values: impl Iterator<Item = &'a str>) -> Result<(), String> {
    let mut seen = HashSet::new();
    for value in values {
        if value.trim().is_empty() || !seen.insert(value) {
            return Err("贡献或权限标识为空/重复".into());
        }
    }
    Ok(())
}
