use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};

macro_rules! sources {
    ($($name:literal),+ $(,)?) => { &[$(($name, include_str!(concat!("../node/", $name)))),+] };
}
const SOURCES: &[(&str, &str)] = sources![
    "host.mjs",
    "manager.mjs",
    "broker.mjs",
    "child.mjs",
    "worker.mjs",
    "worker-api.mjs",
    "errors.mjs",
    "wire.mjs",
    "execution.mjs",
    "settings.mjs",
    "json.mjs",
    "manifest.mjs",
    "directory.mjs",
    "author.mjs",
    "templates.mjs",
    "template-panel.mjs",
    "zip.mjs",
    "cli.mjs",
    "fs-policy.mjs",
    "filesystem.mjs",
    "file-grants.mjs",
    "api-values.mjs",
    "contributions.mjs",
    "extensions.mjs",
    "panel.mjs",
    "panel-html.mjs",
    "panel-bridge.mjs",
    "panel-client.mjs",
    "panel-files.mjs",
    "selection-contents.mjs",
    "selection-reader.mjs",
    "range-reader.mjs",
    "panel-chrome.mjs",
    "panel-chrome-style.mjs",
    "mcp-author.mjs",
    "mcp-dispatch.mjs",
    "mcp-server.mjs",
    "mcp-stdio.mjs",
    "lifecycle.mjs",
    "network.mjs",
    "mcp-peer.mjs",
    "mcp-contributions.mjs",
    "mcp-resources.mjs",
    "mcp-names.mjs",
    "engine-version.mjs",
    "manifest-values.mjs",
    "manifest-fields.mjs",
    "mcp-response.mjs",
    "mcp-results.mjs",
    "mcp-validation.mjs",
    "mcp-events.mjs",
    "mcp-http.mjs",
    "process-tree.mjs",
    "management.mjs",
    "market.mjs",
    "market-catalog.mjs",
    "personal-market.mjs",
    "market-site.mjs",
    "market-storage.mjs",
    "clipboard-history.mjs",
    "clipboard-transfer.mjs",
    "clipboard-client.mjs",
    "models.mjs",
    "session-context.mjs",
    "session-transcript.mjs",
    "model-http.mjs",
    "browser.mjs",
    "browser-cdp.mjs",
    "browser-process.mjs",
    "browser-target.mjs",
    "browser-preview.mjs",
    "browser-input.mjs",
    "browser-clipboard.mjs",
    "browser-files.mjs",
    "panel-browser.mjs",
    "panel-appearance.mjs",
    "administration.mjs",
];

pub fn materialize(base: &Path) -> Result<PathBuf, String> {
    let mut hash = DefaultHasher::new();
    SOURCES.hash(&mut hash);
    let root = base.join("runtime").join(format!("{:016x}", hash.finish()));
    for path in [base.to_path_buf(), base.join("runtime"), root.clone()] {
        if fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().is_symlink()) {
            return Err("插件运行目录不能为符号链接".into());
        }
        fs::create_dir_all(path).map_err(|e| e.to_string())?;
    }
    for (name, source) in SOURCES {
        let path = root.join(name);
        if path.exists() {
            let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if !meta.is_file()
                || meta.file_type().is_symlink()
                || fs::read(&path).map_err(|e| e.to_string())? != source.as_bytes()
            {
                return Err("嵌入插件宿主文件被修改，请检查应用数据目录".into());
            }
        } else {
            use std::io::Write;
            fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(path)
                .and_then(|mut file| file.write_all(source.as_bytes()))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(root)
}
