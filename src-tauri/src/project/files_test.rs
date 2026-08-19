use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use super::*;

fn fixture() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "belfry-project-files-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
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
