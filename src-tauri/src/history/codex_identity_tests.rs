use super::codex::scan_file;
use std::{fs, path::PathBuf};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("belfry-history-id-{}", ulid::Ulid::generate()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn native_meta_id_takes_precedence_over_rollout_filename() {
    let fixture = Fixture::new();
    let native_id = "01993f09-0000-7000-8000-000000000009";
    let file = fixture
        .0
        .join("rollout-2026-09-13-01993f09-0000-7000-8000-000000000010.jsonl");
    let content = format!(
        "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{native_id}\",\"cwd\":\"/work/中文\"}}}}\n\
         {{\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"user\",\"content\":[{{\"type\":\"input_text\",\"text\":\"继续原会话\"}}]}}}}\n"
    );
    fs::write(&file, content).unwrap();
    let session = scan_file(&file).unwrap();
    assert_eq!(native_id, session.id);
    assert_eq!(native_id, session.session_ref.id);
    assert_eq!("继续原会话", session.title);
}
