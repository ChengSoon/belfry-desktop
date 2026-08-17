//! 用户字体的导入、读取与删除。
//!
//! 与背景图一样，字体通过受控命令复制到应用数据目录，再以 raw IPC 返回字节。
//! 文件扩展名不参与格式判断，避免改名后的任意文件进入字体解析链路。

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::contracts::ImportedFontAsset;
use crate::resource::canonicalize;
use crate::terminal::AppError;

const MAX_BYTES: u64 = 30 * 1024 * 1024;
const MAX_DISPLAY_NAME_CHARS: usize = 80;
const LEGACY_STEM: &str = "custom-font";
const FILE_PREFIX: &str = "imported-";
const ULID_LENGTH: usize = 26;
const DIR: &str = "fonts";

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum FontFormat {
    TrueType,
    OpenType,
    Woff,
    Woff2,
}

impl FontFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::TrueType => "ttf",
            Self::OpenType => "otf",
            Self::Woff => "woff",
            Self::Woff2 => "woff2",
        }
    }

    fn mime(self) -> &'static str {
        match self {
            Self::TrueType => "font/ttf",
            Self::OpenType => "font/otf",
            Self::Woff => "font/woff",
            Self::Woff2 => "font/woff2",
        }
    }

    fn extensions() -> [&'static str; 4] {
        [
            Self::TrueType.extension(),
            Self::OpenType.extension(),
            Self::Woff.extension(),
            Self::Woff2.extension(),
        ]
    }
}

pub(super) fn sniff_format(bytes: &[u8]) -> Option<FontFormat> {
    let signature = bytes.get(..4)?;
    match signature {
        b"\x00\x01\x00\x00" | b"true" | b"typ1" => Some(FontFormat::TrueType),
        b"OTTO" => Some(FontFormat::OpenType),
        b"wOFF" => Some(FontFormat::Woff),
        b"wOF2" => Some(FontFormat::Woff2),
        _ => None,
    }
}

fn storage_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::io(format!("找不到应用数据目录：{err}")))?;
    Ok(base.join(DIR))
}

fn managed_file_name(format: FontFormat) -> String {
    let id = ulid::Ulid::generate().to_string().to_lowercase();
    format!("{FILE_PREFIX}{id}.{}", format.extension())
}

fn managed_path(dir: &Path, file_name: &str) -> Result<PathBuf, AppError> {
    let Some((stem, extension)) = file_name.rsplit_once('.') else {
        return Err(AppError::invalid_argument("字体文件名无效"));
    };
    if !FontFormat::extensions().contains(&extension) {
        return Err(AppError::invalid_argument("字体文件名无效"));
    }
    if stem == LEGACY_STEM {
        return Ok(dir.join(file_name));
    }
    let Some(id) = stem.strip_prefix(FILE_PREFIX) else {
        return Err(AppError::invalid_argument("字体文件名无效"));
    };
    if id.len() != ULID_LENGTH || !id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err(AppError::invalid_argument("字体文件名无效"));
    }
    Ok(dir.join(file_name))
}

fn remove_file(dir: &Path, file_name: &str) -> Result<(), AppError> {
    let path = managed_path(dir, file_name)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(AppError::io(format!("删不掉字体：{err}"))),
    }
}

pub(super) fn import(app: &AppHandle, source: &str) -> Result<ImportedFontAsset, AppError> {
    let path = canonicalize(Path::new(source))
        .map_err(|err| AppError::not_found(format!("打不开这个文件：{err}")))?;
    let meta = fs::metadata(&path).map_err(|err| AppError::io(format!("读不到文件信息：{err}")))?;
    if !meta.is_file() {
        return Err(AppError::invalid_argument("字体必须是一个文件"));
    }
    if meta.len() > MAX_BYTES {
        return Err(AppError::invalid_argument(format!(
            "字体太大了（{} MB），上限 {} MB",
            meta.len() / 1024 / 1024,
            MAX_BYTES / 1024 / 1024
        )));
    }

    let bytes = fs::read(&path).map_err(|err| AppError::io(format!("读不了这个文件：{err}")))?;
    let format = sniff_format(&bytes)
        .ok_or_else(|| AppError::unsupported("只支持 TTF / OTF / WOFF / WOFF2 字体"))?;
    let dir = storage_dir(app)?;
    fs::create_dir_all(&dir).map_err(|err| AppError::io(format!("建不了字体目录：{err}")))?;

    let file_name = managed_file_name(format);
    fs::write(dir.join(&file_name), &bytes)
        .map_err(|err| AppError::io(format!("写不进字体文件：{err}")))?;
    Ok(ImportedFontAsset {
        file_name,
        display_name: display_name(&path),
        mime: format.mime().to_string(),
        byte_size: bytes.len() as u64,
    })
}

pub(super) fn read(app: &AppHandle, file_name: &str) -> Result<Vec<u8>, AppError> {
    let dir = storage_dir(app)?;
    let path = managed_path(&dir, file_name)?;
    fs::read(&path).map_err(|err| AppError::io(format!("读不了字体文件：{err}")))
}

pub(super) fn remove(app: &AppHandle, file_name: &str) -> Result<(), AppError> {
    remove_file(&storage_dir(app)?, file_name)
}

fn display_name(path: &Path) -> String {
    let name = path
        .file_stem()
        .map(|value| value.to_string_lossy())
        .unwrap_or_default();
    let normalized = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return "导入字体".to_string();
    }
    normalized.chars().take(MAX_DISPLAY_NAME_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("belfry-font-{tag}-{}", ulid::Ulid::generate()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sniffs_supported_font_signatures() {
        assert_eq!(
            sniff_format(b"\x00\x01\x00\x00rest"),
            Some(FontFormat::TrueType)
        );
        assert_eq!(sniff_format(b"OTTOrest"), Some(FontFormat::OpenType));
        assert_eq!(sniff_format(b"wOFFrest"), Some(FontFormat::Woff));
        assert_eq!(sniff_format(b"wOF2rest"), Some(FontFormat::Woff2));
    }

    #[test]
    fn rejects_renamed_non_fonts_and_collections() {
        assert_eq!(sniff_format(b"MZ\x90\x00executable"), None);
        assert_eq!(sniff_format(b"#!/bin/sh"), None);
        assert_eq!(sniff_format(b"ttcfcollection"), None);
        assert_eq!(sniff_format(b""), None);
    }

    #[test]
    fn removes_only_the_requested_managed_font() {
        let dir = temp_dir("remove-one");
        let first = managed_file_name(FontFormat::TrueType);
        let second = managed_file_name(FontFormat::Woff2);
        fs::write(dir.join(&first), b"font").unwrap();
        fs::write(dir.join(&second), b"font").unwrap();
        fs::write(dir.join("notes.txt"), b"keep").unwrap();

        remove_file(&dir, &first).unwrap();
        assert!(!dir.join(first).exists());
        assert!(dir.join(second).is_file());
        assert!(dir.join("notes.txt").is_file());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn accepts_legacy_names_and_rejects_paths_outside_the_font_store() {
        let dir = temp_dir("managed-path");
        let generated = managed_file_name(FontFormat::OpenType);
        assert!(managed_path(&dir, &generated).is_ok());
        assert!(managed_path(&dir, "custom-font.ttf").is_ok());
        assert!(managed_path(&dir, "../custom-font.ttf").is_err());
        assert!(managed_path(&dir, "/tmp/custom-font.ttf").is_err());
        assert!(managed_path(&dir, "notes.txt").is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn derives_a_bounded_display_name() {
        assert_eq!(display_name(Path::new("/tmp/Maple Mono.ttf")), "Maple Mono");
        assert_eq!(
            display_name(Path::new("/tmp/Maple\n  Mono.ttf")),
            "Maple Mono"
        );
        let long = format!("{}.otf", "a".repeat(100));
        assert_eq!(
            display_name(Path::new(&long)).chars().count(),
            MAX_DISPLAY_NAME_CHARS
        );
    }
}
