//! 只通过系统文件选择窗口导入/导出。备份内容由前端白名单数据域生成。
use std::{fs::File, io::Read, path::Path};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::{atomic::write_atomic, terminal::AppError};

const MAX_BYTES: usize = 4 * 1024 * 1024;

#[tauri::command]
pub async fn backup_export(app: AppHandle, text: String) -> Result<Option<String>, AppError> {
    validate(&text)?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().set_title("保存 Belfry 备份")
            .set_file_name("belfry-backup.json").add_filter("Belfry 备份", &["json"])
            .blocking_save_file();
        let Some(selected) = selected else { return Ok(None); };
        let path = selected.into_path().map_err(|error| AppError::io(error.to_string()))?;
        write_atomic(&path, &text, true)?;
        if read(&path)? != text { return Err(AppError::io("备份写入后回读不一致")); }
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|error| AppError::io(error.to_string()))?
}

#[tauri::command]
pub async fn backup_import(app: AppHandle) -> Result<Option<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().set_title("选择 Belfry 备份")
            .add_filter("Belfry 备份", &["json"]).blocking_pick_file();
        let Some(selected) = selected else { return Ok(None); };
        let path = selected.into_path().map_err(|error| AppError::io(error.to_string()))?;
        read(&path).map(Some)
    }).await.map_err(|error| AppError::io(error.to_string()))?
}

fn read(path: &Path) -> Result<String, AppError> {
    let file = File::open(path).map_err(|error| AppError::io(error.to_string()))?;
    if !file.metadata().map_err(|error| AppError::io(error.to_string()))?.is_file() {
        return Err(AppError::invalid_argument("请选择普通备份文件"));
    }
    let mut text = String::new();
    file.take((MAX_BYTES + 1) as u64).read_to_string(&mut text)
        .map_err(|error| AppError::io(format!("无法读取备份：{error}")))?;
    validate(&text)?;
    Ok(text)
}

fn validate(text: &str) -> Result<(), AppError> {
    if text.len() > MAX_BYTES { return Err(AppError::invalid_argument("备份超过 4 MiB 上限")); }
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|_| AppError::invalid_argument("备份不是有效 JSON 文件"))?;
    if value["format"] != "belfry.backup" || value["version"] != 1 || !value["domains"].is_object() {
        return Err(AppError::invalid_argument("备份格式或版本不支持"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_corrupt_future_or_oversized_files() {
        assert!(validate("{").is_err());
        assert!(validate(r#"{"format":"belfry.backup","version":2,"domains":{}}"#).is_err());
        assert!(validate(&" ".repeat(MAX_BYTES + 1)).is_err());
    }

    #[test]
    fn private_roundtrip_preserves_utf8_bytes() {
        let dir = std::env::temp_dir().join(format!("belfry-backup-{}", ulid::Ulid::generate()));
        let path = dir.join("中文 备份.json");
        let text = r#"{"format":"belfry.backup","version":1,"domains":{"workspace":{"name":"中文 空格"}}}"#;
        write_atomic(&path, text, true).unwrap();
        assert_eq!(text, read(&path).unwrap());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
