use super::{PluginRuntime, engine, install::InstallOptions, with_host};
use crate::terminal::AppError;
use serde_json::{Value, json};
use std::{path::PathBuf, time::Instant};
use tauri::{AppHandle, Emitter, Manager};

pub(super) struct PreparedMarket {
    info: Value,
    created: Instant,
}
pub(super) fn inspect(app: &AppHandle, params: Value) -> Result<Value, AppError> {
    let state = app.state::<PluginRuntime>();
    let info = state
        .engine
        .request(app, "market.prepare", params)
        .map_err(AppError::io)?;
    let path = package_path(&info)?;
    let result = with_host(app, |host| host.inspect(&path, false));
    let preview = match result {
        Ok(preview) => preview,
        Err(error) => {
            let _ = std::fs::remove_file(&path);
            return Err(error);
        }
    };
    if info["id"] != preview.manifest.id || info["version"] != preview.manifest.version {
        with_host(app, |host| {
            host.cancel(&preview.preview_id);
            Ok(())
        })?;
        let _ = std::fs::remove_file(&path);
        return Err(AppError::io("市场插件包的身份或版本与目录不一致"));
    }
    let mut pending = state
        .market_previews
        .lock()
        .map_err(|_| AppError::io("市场预览锁不可用"))?;
    pending.retain(|_, entry| {
        if entry.created.elapsed() < super::host::PREVIEW_TTL {
            return true;
        }
        if let Ok(path) = package_path(&entry.info) {
            let _ = std::fs::remove_file(path);
        }
        false
    });
    pending.insert(
        preview.preview_id.clone(),
        PreparedMarket {
            info,
            created: Instant::now(),
        },
    );
    Ok(json!({"preview":preview}))
}
pub(super) fn install(app: &AppHandle, params: Value) -> Result<Value, AppError> {
    let state = app.state::<PluginRuntime>();
    let id = params["previewId"]
        .as_str()
        .ok_or_else(|| AppError::io("请先预览市场插件包"))?;
    let info = state
        .market_previews
        .lock()
        .map_err(|_| AppError::io("市场预览锁不可用"))?
        .get(id)
        .filter(|item| item.created.elapsed() < super::host::PREVIEW_TTL)
        .map(|item| item.info.clone())
        .ok_or_else(|| AppError::io("市场安装预览已过期，请重新选择安装"))?;
    let _operation = state
        .operations
        .lock()
        .map_err(|_| AppError::io("插件操作锁不可用"))?;
    let registry = with_host(app, |host| host.list())?;
    let preview_manifest = with_host(app, |host| {
        host.previews
            .get(id)
            .map(|p| p.snapshot.manifest.clone())
            .ok_or("预览不存在".into())
    })?;
    verify_grants(&preview_manifest, &params)?;
    state
        .engine
        .unload(app, &preview_manifest.id)
        .map_err(AppError::io)?;
    let options = InstallOptions {
        replace: true,
        enabled: params["enable"].as_bool().unwrap_or(true),
    };
    let result = with_host(app, |host| {
        host.install_with_options((id, &registry.revision), options)
    });
    let next = with_host(app, |host| host.list())?;
    let _ = state.engine.synchronize(app, &next);
    let installed = result?;
    state.engine.request(app, "management.plugin", json!({"id":preview_manifest.id,"patch":{
        "autoUpdate":params["autoUpdate"].as_bool().unwrap_or(true),"marketplace":info["marketplace"]}})).map_err(AppError::io)?;
    state
        .market_previews
        .lock()
        .map_err(|_| AppError::io("市场预览锁不可用"))?
        .remove(id);
    let _ = std::fs::remove_file(package_path(&info)?);
    let _ = app.emit_to("main", "plugins-changed", ());
    Ok(json!({"registry":installed}))
}
fn verify_grants(
    manifest: &super::manifest::PluginManifest,
    params: &Value,
) -> Result<(), AppError> {
    let runtime = manifest.runtime.as_ref();
    let permissions = runtime
        .and_then(|m| m["permissions"].as_array())
        .cloned()
        .unwrap_or_default();
    let grants = params["grantedPermissions"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if permissions
        .iter()
        .any(|permission| !grants.contains(permission))
    {
        return Err(AppError::io("插件权限已变化，请重新预览并确认"));
    }
    if params["id"] != manifest.id || params["version"] != manifest.version {
        return Err(AppError::io("插件安装目标与预览不一致"));
    }
    Ok(())
}
pub(super) fn cancel(app: &AppHandle, preview_id: &str) {
    if let Ok(mut pending) = app.state::<PluginRuntime>().market_previews.lock() {
        if let Some(item) = pending.remove(preview_id) {
            if let Ok(path) = package_path(&item.info) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}
fn package_path(info: &Value) -> Result<PathBuf, AppError> {
    info["path"]
        .as_str()
        .map(PathBuf::from)
        .ok_or_else(|| AppError::io("市场下载路径无效"))
}
pub(super) fn apply_updates(app: &AppHandle) -> Result<Value, AppError> {
    let state = app.state::<PluginRuntime>();
    state
        .engine
        .request(app, "market.updates", json!({"refreshRemote":true}))
        .map_err(AppError::io)?;
    let plan = state
        .engine
        .request(app, "market.plan", json!({}))
        .map_err(AppError::io)?;
    let mut skipped = plan["skipped"].as_array().cloned().unwrap_or_default();
    let mut results = Vec::new();
    for update in plan["updates"].as_array().into_iter().flatten() {
        match apply_one(app, update) {
            Ok(result) => results.push(result),
            Err(_) => skipped.push(update["id"].clone()),
        }
    }
    Ok(json!({"results":results,"skipped":skipped}))
}
fn apply_one(app: &AppHandle, update: &Value) -> Result<Value, AppError> {
    let result = inspect(app, update.clone())?;
    let preview = &result["preview"];
    let id = preview["previewId"]
        .as_str()
        .ok_or_else(|| AppError::io("缺少预览标识"))?;
    let manifest: super::manifest::PluginManifest =
        serde_json::from_value(preview["manifest"].clone())
            .map_err(|e| AppError::io(e.to_string()))?;
    let registry = with_host(app, |host| host.list())?;
    let old = registry
        .plugins
        .iter()
        .find(|entry| entry.manifest.id == manifest.id)
        .ok_or_else(|| AppError::io("插件已卸载"))?;
    if !super::pi_manifest::same_authority(&old.manifest, &manifest)
        || old.manifest.permissions != manifest.permissions
    {
        with_host(app, |host| {
            host.cancel(id);
            Ok(())
        })?;
        cancel(app, id);
        return Err(AppError::io("自动更新需要新的权限确认"));
    }
    install(
        app,
        json!({"previewId":id,"id":manifest.id,"version":manifest.version,
        "enable":old.enabled,"autoUpdate":true,"grantedPermissions":manifest.runtime.as_ref().map(|v| &v["permissions"])}),
    )
}
pub(super) fn registry_metadata(registry: &super::store::PluginRegistry) -> Value {
    json!({"plugins":registry.plugins.iter().map(|entry| {
        let runtime = entry.manifest.runtime.as_ref();
        json!({"id":entry.manifest.id,"version":entry.manifest.version,"enabled":entry.enabled,
            "permissions":runtime.map(|v| &v["permissions"]).cloned().unwrap_or(json!([])),
            "fs":runtime.map(|v| &v["fs"]).filter(|v| !v.is_null()),"net":runtime.map(|v| &v["net"]).filter(|v| !v.is_null())})
    }).collect::<Vec<_>>()})
}
pub(super) fn desktop(app: &AppHandle, method: &str, params: Value) -> Result<Value, AppError> {
    let (api, value) = if method == "desktop.openExternal" {
        ("shell.openExternal", &params["url"])
    } else {
        ("fs.reveal", &params["directory"])
    };
    engine::desktop(app, json!({"api":api,"args":[value]})).map_err(AppError::io)
}
