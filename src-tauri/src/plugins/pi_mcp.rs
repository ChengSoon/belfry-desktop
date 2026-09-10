use super::pi_manifest::{entries, required, resource_path, strings};
use serde_json::Value;

pub(super) fn validate(item: &Value, manifest: &Value) -> Result<(), String> {
    let local = match item["transport"].as_str() {
        Some("stdio") => true,
        Some("http") => false,
        _ => return Err("MCP transport 无效".into()),
    };
    let permission = if local {
        "mcp.server.local"
    } else {
        "mcp.server.remote"
    };
    if !strings(manifest.get("permissions"))?
        .iter()
        .any(|p| p == permission)
    {
        return Err("MCP 服务缺少权限".into());
    }
    if local {
        mcp_command(item)?;
    } else {
        remote_mcp(item, manifest)?;
    }
    for field in ["env", "headers"] {
        if let Some(values) = item.get(field) {
            mcp_values(values, manifest)?;
        }
    }
    Ok(())
}
fn remote_mcp(item: &Value, manifest: &Value) -> Result<(), String> {
    let url: tauri::Url = required(item, "url")?.parse().map_err(|_| "MCP URL 无效")?;
    if !["https", "http"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("MCP URL 无效".into());
    }
    let host = url.host_str().ok_or("MCP URL 缺少域名")?;
    let domains = strings(manifest["net"].get("domains"))?;
    if !domains.iter().any(|d| {
        d.strip_prefix("*.")
            .map(|plain| host.ends_with(&format!(".{plain}")))
            .unwrap_or_else(|| host == d)
    }) {
        return Err("MCP URL 不在 net.domains 范围内".into());
    }
    Ok(())
}
fn mcp_command(item: &Value) -> Result<(), String> {
    let command = required(item, "command")?;
    if command.contains(['/', '\\']) {
        resource_path(&command)?;
    }
    if command.contains(':') || command.starts_with('-') {
        return Err("MCP 命令无效".into());
    }
    strings(item.get("args"))?;
    Ok(())
}
fn mcp_values(values: &Value, manifest: &Value) -> Result<(), String> {
    for value in values
        .as_object()
        .ok_or("MCP env/headers 必须为对象")?
        .values()
    {
        if value.is_string() {
            continue;
        }
        let setting = required(value, "setting")?;
        if !entries(&manifest["contributes"], "settings")?
            .iter()
            .any(|s| s["key"] == setting)
        {
            return Err("MCP 设置引用无效".into());
        }
    }
    Ok(())
}
