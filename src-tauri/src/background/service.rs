//! 背景图的导入、读取与删除。
//!
//! 图片不走 asset 协议也不用 fs 插件，命令直接返回原始字节，前端包成 Blob URL。
//! asset 协议要在 tauri.conf.json 配 scope、在 capabilities 加权限，
//! 而这里全程只有一张受控的图，自己读一次反而更短也更好收口——
//! 于是 security 配置和权限白名单一行都不用动。

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::contracts::BackgroundAsset;
use crate::resource::canonicalize;
use crate::terminal::AppError;

/// 体积上限。整张图要过 IPC 再变成 Blob 常驻内存，
/// 给个足够放下 4K 壁纸、又不至于把内存吃穿的数。
const MAX_BYTES: u64 = 20 * 1024 * 1024;

/// 落盘文件名固定，只随格式换扩展名。
/// 全局只留一张图，固定名天然绕开重名、非 ASCII 文件名和路径穿越三类问题——
/// 用户选的文件名从头到尾不参与路径拼接。
const STEM: &str = "background";
const DIR: &str = "backgrounds";

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum ImageFormat {
    Png,
    Jpeg,
    Webp,
}

impl ImageFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Webp => "webp",
        }
    }

    fn mime(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }

    /// 清理旧图时要覆盖所有可能的扩展名，换格式后旧的那份才不会留下。
    fn extensions() -> [&'static str; 3] {
        [
            Self::Png.extension(),
            Self::Jpeg.extension(),
            Self::Webp.extension(),
        ]
    }
}

/// 按魔数判定格式，**不看扩展名**。
///
/// 扩展名是用户随手就能改的，认它等于允许任意文件被写进应用数据目录，
/// 之后还会被当成图片喂给前端解码。
pub(super) fn sniff_format(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some(ImageFormat::Png);
    }
    // JPEG 的 SOI + 首个标记，后一字节还有 E0/E1/DB 等多种取值，只认前三字节。
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(ImageFormat::Jpeg);
    }
    // WebP 是 RIFF 容器：`RIFF` + 4 字节长度 + `WEBP`，中间那 4 字节不能一起比。
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some(ImageFormat::Webp);
    }
    None
}

fn storage_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::io(format!("找不到应用数据目录：{err}")))?;
    Ok(base.join(DIR))
}

/// 目录里当前那张图。目录不存在或空着都返回 None。
fn current_file(dir: &Path) -> Option<PathBuf> {
    ImageFormat::extensions()
        .into_iter()
        .map(|ext| dir.join(format!("{STEM}.{ext}")))
        .find(|path| path.is_file())
}

/// 删掉所有扩展名的旧图。文件本来就不存在不算错。
fn clear(dir: &Path) -> Result<(), AppError> {
    for ext in ImageFormat::extensions() {
        let path = dir.join(format!("{STEM}.{ext}"));
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(AppError::io(format!("删不掉旧背景图：{err}"))),
        }
    }
    Ok(())
}

/// 校验来源文件并复制进应用数据目录，返回落盘后的描述。
///
/// 复制而不是记住原路径：原图被移动或删除后背景不该跟着失效。
pub(super) fn import(app: &AppHandle, source: &str) -> Result<BackgroundAsset, AppError> {
    let path = canonicalize(Path::new(source))
        .map_err(|err| AppError::not_found(format!("打不开这个文件：{err}")))?;
    let meta = fs::metadata(&path).map_err(|err| AppError::io(format!("读不到文件信息：{err}")))?;
    if !meta.is_file() {
        return Err(AppError::invalid_argument("背景图必须是一个文件"));
    }
    // 先看大小再读内容，避免为了拒绝一个超大文件先把它整个读进内存。
    if meta.len() > MAX_BYTES {
        return Err(AppError::invalid_argument(format!(
            "图片太大了（{} MB），上限 {} MB",
            meta.len() / 1024 / 1024,
            MAX_BYTES / 1024 / 1024
        )));
    }

    let bytes = fs::read(&path).map_err(|err| AppError::io(format!("读不了这个文件：{err}")))?;
    let format =
        sniff_format(&bytes).ok_or_else(|| AppError::unsupported("只认 PNG / JPEG / WebP 图片"))?;

    let dir = storage_dir(app)?;
    fs::create_dir_all(&dir).map_err(|err| AppError::io(format!("建不了背景图目录：{err}")))?;
    // 换格式时新旧文件的扩展名不同，不先清一遍就会留下一份再也读不到的旧图。
    clear(&dir)?;

    let file_name = format!("{STEM}.{}", format.extension());
    fs::write(dir.join(&file_name), &bytes)
        .map_err(|err| AppError::io(format!("写不进背景图：{err}")))?;

    Ok(BackgroundAsset {
        file_name,
        mime: format.mime().to_string(),
        byte_size: bytes.len() as u64,
    })
}

pub(super) fn read(app: &AppHandle) -> Result<Vec<u8>, AppError> {
    let dir = storage_dir(app)?;
    let path = current_file(&dir).ok_or_else(|| AppError::not_found("还没有设置背景图"))?;
    fs::read(&path).map_err(|err| AppError::io(format!("读不了背景图：{err}")))
}

pub(super) fn remove(app: &AppHandle) -> Result<(), AppError> {
    clear(&storage_dir(app)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 1, 2, 3];
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 1, 2, 3];

    fn webp() -> Vec<u8> {
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&[0x24, 0x00, 0x00, 0x00]); // 长度字段，内容无所谓
        bytes.extend_from_slice(b"WEBPVP8 ");
        bytes
    }

    #[test]
    fn sniffs_the_three_supported_formats() {
        assert_eq!(sniff_format(PNG), Some(ImageFormat::Png));
        assert_eq!(sniff_format(JPEG), Some(ImageFormat::Jpeg));
        assert_eq!(sniff_format(&webp()), Some(ImageFormat::Webp));
    }

    /// 把可执行文件改名成 .png 是最省事的攻击，扩展名一律不参与判断。
    #[test]
    fn rejects_a_non_image_whatever_it_is_named() {
        assert_eq!(sniff_format(b"MZ\x90\x00executable"), None); // PE
        assert_eq!(sniff_format(b"\x7fELF\x02\x01\x01"), None); // ELF
        assert_eq!(sniff_format(b"#!/bin/sh\nrm -rf /"), None);
        assert_eq!(sniff_format(b"<svg xmlns=\"...\">"), None); // SVG 能带脚本，不收
        assert_eq!(sniff_format(b"GIF89a"), None); // 本轮不支持动图
    }

    /// RIFF 容器不止 WebP 一种，wav 也是 RIFF 开头，不能只比前四字节。
    #[test]
    fn rejects_a_riff_container_that_is_not_webp() {
        let mut wav = b"RIFF".to_vec();
        wav.extend_from_slice(&[0x24, 0x00, 0x00, 0x00]);
        wav.extend_from_slice(b"WAVEfmt ");
        assert_eq!(sniff_format(&wav), None);
    }

    #[test]
    fn rejects_input_too_short_to_identify() {
        assert_eq!(sniff_format(b""), None);
        assert_eq!(sniff_format(&[0x89, b'P']), None);
        assert_eq!(sniff_format(b"RIFF\x24\x00\x00"), None); // 不够 12 字节
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("belfry-bg-{tag}-{}", ulid::Ulid::generate()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn clear_removes_every_extension_and_tolerates_missing_files() {
        let dir = temp_dir("clear");
        // 目录是空的也不该报错
        clear(&dir).unwrap();

        fs::write(dir.join("background.png"), PNG).unwrap();
        fs::write(dir.join("background.webp"), webp()).unwrap();
        // 不归我们管的文件不该被误删
        fs::write(dir.join("notes.txt"), b"keep me").unwrap();

        clear(&dir).unwrap();
        assert!(current_file(&dir).is_none());
        assert!(dir.join("notes.txt").is_file());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn current_file_finds_whichever_extension_is_present() {
        let dir = temp_dir("current");
        assert!(current_file(&dir).is_none());

        fs::write(dir.join("background.jpg"), JPEG).unwrap();
        assert_eq!(current_file(&dir), Some(dir.join("background.jpg")));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn current_file_ignores_a_directory_named_like_the_image() {
        let dir = temp_dir("dir-decoy");
        fs::create_dir_all(dir.join("background.png")).unwrap();
        assert!(current_file(&dir).is_none());
        fs::remove_dir_all(&dir).ok();
    }
}
