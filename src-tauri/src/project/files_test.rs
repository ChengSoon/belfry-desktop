use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use super::*;

fn fixture() -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "belfry-project-files-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();
    fs::write(root.join("binary.bin"), [0, 1, 2, 3]).unwrap();
    fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
    root
}

#[test]
fn lists_directories_before_files_and_hides_generated_directories() {
    let root = fixture();
    let result = list_directory(root.to_str().unwrap(), None).unwrap();
    assert_eq!(result.entries[0].name, "src");
    assert_eq!(result.entries[0].kind, ProjectEntryKind::Directory);
    assert!(
        result
            .entries
            .iter()
            .all(|entry| entry.name != "node_modules")
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reads_text_and_marks_binary_files() {
    let root = fixture();
    let text = read_file(root.to_str().unwrap(), "src/main.rs").unwrap();
    assert_eq!(text.language.as_deref(), Some("rust"));
    assert_eq!(text.content, "fn main() {}\n");
    assert!(!text.binary);
    let binary = read_file(root.to_str().unwrap(), "binary.bin").unwrap();
    assert!(binary.binary);
    assert!(binary.content.is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_paths_outside_the_project_root() {
    let root = fixture();
    assert!(read_file(root.to_str().unwrap(), "../outside.txt").is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reads_non_utf8_files_and_bom_only_files_as_text() {
    let root = fixture();
    let expected = "名称=中文项目\r\n";
    let mut bytes = vec![0xff, 0xfe];
    bytes.extend(expected.encode_utf16().flat_map(u16::to_le_bytes));
    fs::write(root.join("config.ini"), &bytes).unwrap();
    let preview = read_file(root.to_str().unwrap(), "config.ini").unwrap();
    assert!(!preview.binary);
    assert_eq!(preview.content, expected);
    assert_eq!(preview.size, bytes.len() as u64);
    assert!(!preview.truncated);
    fs::write(root.join("empty.txt"), [0xff, 0xfe]).unwrap();
    let empty = read_file(root.to_str().unwrap(), "empty.txt").unwrap();
    assert!(!empty.binary);
    assert!(empty.content.is_empty());
    let (gbk, _, _) = encoding_rs::GBK.encode("这是一个中文配置文件，用于验证文件预览。\n");
    fs::write(root.join("legacy.txt"), gbk.as_ref()).unwrap();
    let preview = read_file(root.to_str().unwrap(), "legacy.txt").unwrap();
    assert!(!preview.binary);
    assert_eq!(
        preview.content,
        "这是一个中文配置文件，用于验证文件预览。\n"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn bounded_reads_drop_incomplete_characters_without_losing_text() {
    let root = fixture();
    let limit = MAX_PREVIEW_BYTES as usize;
    let mut bytes = vec![b'a'; limit - 1];
    bytes.extend("中".as_bytes());
    fs::write(root.join("large.txt"), &bytes).unwrap();
    let preview = read_file(root.to_str().unwrap(), "large.txt").unwrap();
    assert!(!preview.binary);
    assert!(preview.truncated);
    assert_eq!(preview.content, "a".repeat(limit - 1));
    assert_eq!(preview.size, bytes.len() as u64);

    // A high surrogate ends exactly at the byte cap; the following low
    // surrogate must not be replaced or make this text file look binary.
    let mut utf16 = vec![0xff, 0xfe];
    utf16.extend(std::iter::repeat_n([b'a', 0], (limit - 4) / 2).flatten());
    utf16.extend([0x3d, 0xd8, 0x00, 0xde]);
    fs::write(root.join("large-utf16.txt"), &utf16).unwrap();
    let preview = read_file(root.to_str().unwrap(), "large-utf16.txt").unwrap();
    assert!(!preview.binary);
    assert!(preview.truncated);
    assert_eq!(preview.content, "a".repeat((limit - 4) / 2));
    assert_eq!(preview.size, utf16.len() as u64);
    fs::remove_dir_all(root).unwrap();
}
