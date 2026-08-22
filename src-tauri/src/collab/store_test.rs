use std::fs;
use std::path::PathBuf;

use super::*;
use crate::collab::contracts::{ContextKind, ContextSource};

fn temp_root(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "belfry-collab-{tag}-{}-{}",
        std::process::id(),
        ulid::Ulid::generate()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(id: &str, body: &str) -> ContextWrite {
    ContextWrite {
        id: id.to_string(),
        kind: ContextKind::Note,
        title: "约定".to_string(),
        body: body.to_string(),
        source: ContextSource::User,
        tags: vec!["路由".to_string()],
        pinned: false,
        created_at: 100,
        updated_at: 100,
    }
}

#[test]
fn short_body_stays_inline_and_writes_no_extra_file() {
    let root = temp_root("inline");
    let item = put(root.to_str().unwrap(), write("c1", "只改路由字段")).unwrap();

    assert_eq!(item.body.as_deref(), Some("只改路由字段"));
    assert!(item.path.is_none(), "短内容不该落盘");
    assert!(!root.join(".belfry/context/c1.md").exists());
    assert_eq!(get(root.to_str().unwrap(), "c1").unwrap(), "只改路由字段");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn long_body_goes_to_a_file_and_index_keeps_only_the_path() {
    let root = temp_root("spill");
    let body = "长".repeat(2_000);
    let item = put(root.to_str().unwrap(), write("c2", &body)).unwrap();

    assert!(item.body.is_none(), "长内容不该内联进索引");
    assert_eq!(item.path.as_deref(), Some(".belfry/context/c2.md"));
    assert_eq!(fs::read_to_string(root.join(".belfry/context/c2.md")).unwrap(), body);
    // 读回来要还原成完整正文，调用方不必关心它当初存在哪。
    assert_eq!(get(root.to_str().unwrap(), "c2").unwrap(), body);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn same_id_overwrites_and_keeps_the_original_created_at() {
    let root = temp_root("overwrite");
    let path = root.to_str().unwrap();
    put(path, write("c1", "第一版")).unwrap();

    let mut second = write("c1", "第二版");
    second.created_at = 999;
    second.updated_at = 200;
    let item = put(path, second).unwrap();

    assert_eq!(item.body.as_deref(), Some("第二版"));
    // 覆盖不是新建：createdAt 保留首次写入的值，否则「什么时候加进来的」会被改写。
    assert_eq!(item.created_at, 100);
    assert_eq!(item.updated_at, 200);
    assert_eq!(list(path).unwrap().len(), 1);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn removing_drops_the_index_entry_and_the_body_file() {
    let root = temp_root("remove");
    let path = root.to_str().unwrap();
    put(path, write("c2", &"长".repeat(2_000))).unwrap();
    assert!(root.join(".belfry/context/c2.md").exists());

    remove(path, "c2").unwrap();

    assert!(list(path).unwrap().is_empty());
    assert!(!root.join(".belfry/context/c2.md").exists());
    // 删不存在的条目不该报错：重复点删除是常见操作。
    remove(path, "c2").unwrap();

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_malformed_entry_does_not_void_the_whole_index() {
    let root = temp_root("salvage");
    let path = root.to_str().unwrap();
    put(path, write("good", "有效")).unwrap();

    // 模拟 Agent 手写坏了一条：整份索引不该因此作废。
    let index = root.join(".belfry/context/index.json");
    let text = fs::read_to_string(&index).unwrap();
    let patched = text.replacen('[', "[{\"id\":\"broken\"},", 1);
    fs::write(&index, patched).unwrap();

    let items = list(path).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, "good");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn path_traversal_ids_are_rejected() {
    let root = temp_root("traversal");
    let path = root.to_str().unwrap();

    for id in ["../escape", "a/b", "a\\b", "..", "", "  "] {
        assert!(
            put(path, write(id, &"长".repeat(2_000))).is_err(),
            "id {id:?} 应该被拒"
        );
        assert!(get(path, id).is_err(), "id {id:?} 应该被拒");
    }
    // 项目根之外不该留下任何东西
    assert!(!root.parent().unwrap().join("escape.md").exists());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn oversized_body_is_rejected_before_touching_disk() {
    let root = temp_root("oversize");
    let path = root.to_str().unwrap();
    let huge = "x".repeat(256 * 1024 + 1);

    assert!(put(path, write("big", &huge)).is_err());
    assert!(list(path).unwrap().is_empty());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn pinning_a_spilled_item_does_not_copy_its_body_into_the_index() {
    let root = temp_root("pin");
    let path = root.to_str().unwrap();
    let body = "长".repeat(2_000);
    put(path, write("c2", &body)).unwrap();

    let pinned = set_pinned(path, "c2", true).unwrap();

    assert!(pinned.pinned);
    // 关键：正文必须还在文件里，不能因为翻了个布尔值就被复制进索引。
    assert!(pinned.body.is_none());
    assert_eq!(pinned.path.as_deref(), Some(".belfry/context/c2.md"));
    assert_eq!(get(path, "c2").unwrap(), body);

    let index = fs::read_to_string(root.join(".belfry/context/index.json")).unwrap();
    assert!(!index.contains(&body), "索引里不该出现正文");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn pinning_a_missing_item_is_an_error() {
    let root = temp_root("pin-missing");
    assert!(set_pinned(root.to_str().unwrap(), "nope", true).is_err());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn listing_an_untouched_project_is_empty_not_an_error() {
    let root = temp_root("fresh");
    // 还没存过任何东西时 .belfry/ 根本不存在，这是常态而不是错误。
    assert!(list(root.to_str().unwrap()).unwrap().is_empty());

    let _ = fs::remove_dir_all(&root);
}
