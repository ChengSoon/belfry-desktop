mod catalog;
mod clipboard;
mod connection;
mod embedded;
mod node;
mod notifications;
mod platform;
mod surface_files;
#[cfg(test)]
mod tests;
mod windows;

use super::store::PluginRegistry;
use connection::Connection;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, atomic::Ordering},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct Engine {
    connection: Mutex<Option<Arc<Connection>>>,
    loaded: Mutex<HashMap<String, Value>>,
    context: Mutex<Value>,
    errors: Mutex<HashMap<String, String>>,
}
pub fn base(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("plugins"))
        .map_err(|e| e.to_string())
}
pub(super) fn desktop(app: &AppHandle, request: Value) -> Result<Value, String> {
    platform::dispatch(app, request)
}
pub fn bridge_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    Ok((
        node::executable()?,
        embedded::materialize(&base(app)?)?.join("mcp-stdio.mjs"),
    ))
}
impl Engine {
    fn ensure(&self, app: &AppHandle) -> Result<Arc<Connection>, String> {
        let mut guard = self.connection.lock().map_err(|_| "插件运行锁不可用")?;
        if let Some(connection) = guard
            .as_ref()
            .filter(|value| value.alive.load(Ordering::Acquire))
        {
            return Ok(connection.clone());
        }
        let node = node::executable()?;
        let base = base(app)?;
        let root = embedded::materialize(&base)?;
        let host_app = app.clone();
        let event_app = app.clone();
        let connection = Connection::launch(
            (&node, &root, &base),
            (
                Arc::new(move |request| platform::dispatch(&host_app, request)),
                Arc::new(move |event| {
                    let _ = event_app.emit_to("main", "plugin-runtime-event", event);
                }),
            ),
        )?;
        let hello = connection.call("hello", json!({}))?;
        let major = hello["nodeVersion"]
            .as_str()
            .and_then(|s| s.split('.').next())
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        if major < 20 {
            connection.stop();
            return Err("插件运行需要 Node.js 20 或更新版本".into());
        }
        connection.call(
            "context",
            self.context
                .lock()
                .map_err(|_| "插件上下文锁不可用")?
                .clone(),
        )?;
        self.loaded.lock().map_err(|_| "插件加载锁不可用")?.clear();
        *guard = Some(connection.clone());
        Ok(connection)
    }
    pub fn synchronize(&self, app: &AppHandle, registry: &PluginRegistry) -> Result<(), String> {
        let desired = registry
            .plugins
            .iter()
            .filter(|entry| runnable(entry))
            .collect::<Vec<_>>();
        if desired.is_empty()
            && self
                .connection
                .lock()
                .map_err(|_| "插件运行锁不可用")?
                .is_none()
        {
            return Ok(());
        }
        let connection = self.ensure(app)?;
        let mut loaded = self.loaded.lock().map_err(|_| "插件加载锁不可用")?;
        let mut errors = self.errors.lock().map_err(|_| "插件错误锁不可用")?;
        for id in loaded.keys().cloned().collect::<Vec<_>>() {
            if desired.iter().any(|entry| entry.manifest.id == id) {
                continue;
            }
            connection.call("unload", json!({"pluginId":id}))?;
            windows::close(app, &id);
            loaded.remove(&id);
            errors.remove(&id);
        }
        for entry in desired {
            let input = json!({"path":entry.source_path, "manifest":entry.manifest.runtime, "development":entry.source == "development", "revision":entry.updated_at});
            if loaded.get(&entry.manifest.id) == Some(&input) {
                continue;
            }
            match connection.call("load", input.clone()) {
                Ok(_) => {
                    errors.remove(&entry.manifest.id);
                }
                Err(error) => {
                    errors.insert(entry.manifest.id.clone(), error);
                }
            }
            // 失败也记录本次来源版本，避免轮询不停启动坏插件；重载会使版本变化。
            loaded.insert(entry.manifest.id.clone(), input);
        }
        Ok(())
    }
    pub fn request(&self, app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
        if method == "context" {
            return self.update_context(app, params);
        }
        let connection = self.ensure(app)?;
        let mut value = if method == "catalog" {
            catalog::read(&connection)?
        } else {
            connection.call(method, params)?
        };
        if method == "catalog" {
            value["available"] = json!(true);
            if let Some(errors) = value["errors"].as_object_mut() {
                for (id, error) in self.errors.lock().map_err(|_| "插件错误锁不可用")?.iter()
                {
                    errors.insert(id.clone(), json!(error));
                }
            }
        }
        Ok(value)
    }
    fn update_context(&self, app: &AppHandle, mut params: Value) -> Result<Value, String> {
        if !params.is_object() {
            return Err("插件上下文必须为对象".into());
        }
        if let Some(workspace) = params["workspace"].as_str() {
            let path = if workspace.starts_with("file:") {
                crate::resource::file_uri_to_path(workspace).map_err(|e| e.message)?
            } else {
                PathBuf::from(workspace)
            };
            if !path.is_absolute() || !path.is_dir() {
                return Err("插件工作区路径无效".into());
            }
            params["workspace"] =
                json!(crate::resource::canonicalize(&path).map_err(|e| e.to_string())?);
        }
        params["appVersion"] = json!(env!("CARGO_PKG_VERSION"));
        let ticket = params["sessionId"].as_str().and_then(|id| {
            app.state::<super::PluginRuntime>()
                .sessions
                .lock()
                .ok()?
                .get(id)
                .cloned()
        });
        params["agentConnectionId"] = json!(ticket);
        *self.context.lock().map_err(|_| "插件上下文锁不可用")? = params.clone();
        if let Some(connection) = self
            .connection
            .lock()
            .map_err(|_| "插件运行锁不可用")?
            .clone()
        {
            connection.call("context", params)?;
        }
        Ok(Value::Null)
    }
    pub fn unload(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        if let Some(connection) = self
            .connection
            .lock()
            .map_err(|_| "插件运行锁不可用")?
            .clone()
        {
            if connection.alive.load(Ordering::Acquire) {
                connection.call("unload", json!({"pluginId":id}))?;
            }
        }
        self.loaded
            .lock()
            .map_err(|_| "插件加载锁不可用")?
            .remove(id);
        self.errors
            .lock()
            .map_err(|_| "插件错误锁不可用")?
            .remove(id);
        windows::close(app, id);
        Ok(())
    }
    pub fn stop(&self) {
        if let Ok(mut guard) = self.connection.lock() {
            if let Some(connection) = guard.take() {
                connection.stop();
            }
        }
    }
}
fn runnable(entry: &super::store::PluginEntry) -> bool {
    entry.enabled && entry.error.is_none() && entry.manifest.runtime.is_some()
}
