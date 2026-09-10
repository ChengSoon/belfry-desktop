use super::{files, host::PluginHost, package_test_support::*, tests::Fixture};
use std::fs;

#[test]
fn github_market_package_installs_with_its_pi_panel() {
    let mut fixture = Fixture::new();
    let bytes = fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../examples/plugins/belfry.quick-notes-0.1.0.piplug"
    ))
    .unwrap();
    let path = fixture.source.with_extension("piplug");
    fs::write(&path, &bytes).unwrap();
    let preview = fixture.host.inspect(&path, false).unwrap();
    assert_eq!("belfry.quick-notes", preview.manifest.id);
    assert!(preview.manifest.runtime.is_some());
    let installed = fixture.host.install(&preview.preview_id, "0").unwrap();
    let entry = &installed.plugins[0];
    assert!(!entry.enabled);
    assert!(entry.source_path.join("renderer/index.html").is_file());
    assert!(entry.source_path.join("main.js").is_file());
    assert_eq!(bytes, fs::read(path).unwrap());
}

#[test]
fn package_preview_and_cancel_leave_storage_untouched() {
    let mut fixture = Fixture::new();
    let mut content = entries();
    content.push(Entry::new("指南/", b""));
    content.push(Entry::new("指南/说明.md", "用法".as_bytes()));
    let path = write_package(&fixture, &content);
    let preview = fixture.host.inspect(&path, false).unwrap();
    assert_eq!("example.review", preview.manifest.id);
    assert_eq!(3, preview.file_count);
    assert_eq!(path.canonicalize().unwrap(), preview.source_path);
    assert!(!preview.development);
    assert!(!fixture.host.base.exists());
    fixture.host.cancel(&preview.preview_id);
    assert!(fixture.host.previews.is_empty());
    assert!(!fixture.host.base.exists());
    assert!(path.is_file());
}

#[test]
fn standard_zip_package_installs_and_survives_restart() {
    let mut fixture = Fixture::new();
    let bytes = fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../examples/plugins/review-directory.piplug"
    ))
    .unwrap();
    let path = fixture.source.with_extension("piplug");
    fs::write(&path, &bytes).unwrap();
    let preview = fixture.host.inspect(&path, false).unwrap();
    let installed = fixture.host.install(&preview.preview_id, "0").unwrap();
    let destination = installed.plugins[0].source_path.clone();
    assert!(!installed.plugins[0].enabled);
    assert!(destination.join("manifest.json").is_file());
    fixture
        .host
        .mutate("example.review-directory", "enable", "1")
        .unwrap();
    let restored = PluginHost::new(fixture.host.base.clone()).list().unwrap();
    assert!(restored.plugins[0].enabled);
    assert_eq!(1, restored.plugins[0].active_contributions.skills.len());
    fixture
        .host
        .mutate("example.review-directory", "uninstall", &restored.revision)
        .unwrap();
    assert!(!destination.exists());
    assert_eq!(bytes, fs::read(path).unwrap());
}

#[test]
fn package_install_rechecks_payload_after_preview() {
    let mut fixture = Fixture::new();
    let mut content = entries();
    let path = write_package(&fixture, &content);
    let preview = fixture.host.inspect(&path, false).unwrap();
    content[1].bytes = b"Changed after preview.".to_vec();
    write_package(&fixture, &content);
    assert!(
        fixture
            .host
            .install(&preview.preview_id, "0")
            .unwrap_err()
            .contains("已变化")
    );
    assert!(fixture.host.list().unwrap().plugins.is_empty());
    assert!(!fixture.host.base.join("installed").exists());
}

#[test]
fn package_cannot_be_loaded_as_a_development_directory() {
    let mut fixture = Fixture::new();
    let path = write_package(&fixture, &entries());
    assert!(
        fixture
            .host
            .inspect(&path, true)
            .unwrap_err()
            .contains("开发")
    );
    assert!(!fixture.host.base.exists());
}

#[test]
fn package_paths_cannot_escape_or_alias_host_files() {
    for name in [
        "../outside",
        "/absolute",
        "C:/drive",
        "bad\\path",
        "bad//path",
        "a/./b",
        "bad\0name",
        "NUL",
        "con.txt",
        "COM1",
        "trailing. ",
    ] {
        let mut fixture = Fixture::new();
        let mut content = entries();
        content.push(Entry::new(name, b"untrusted"));
        let path = write_package(&fixture, &content);
        assert!(fixture.host.inspect(&path, false).is_err(), "{name:?}");
        assert!(!fixture.host.base.exists());
        assert!(!fixture.source.with_file_name("outside").exists());
    }
}

#[test]
fn duplicate_members_and_file_directory_conflicts_are_rejected() {
    for names in [
        ["SKILL.md", "SKILL.md"],
        ["SKILL.md", "skill.md"],
        ["folder", "folder/file"],
        ["Folder/a", "folder/b"],
    ] {
        let mut fixture = Fixture::new();
        let mut content = entries();
        content.extend(names.map(|name| Entry::new(name, b"test")));
        let path = write_package(&fixture, &content);
        assert!(fixture.host.inspect(&path, false).is_err(), "{names:?}");
        assert!(!fixture.host.base.exists());
    }
}

#[test]
fn package_rejects_symlinks_and_special_members() {
    for mode in [0o120777, 0o010600, 0o020600] {
        let mut fixture = Fixture::new();
        let mut content = entries();
        let mut entry = Entry::new("escape", b"../outside");
        entry.mode = mode;
        content.push(entry);
        let path = write_package(&fixture, &content);
        assert!(fixture.host.inspect(&path, false).is_err());
        assert!(!fixture.host.base.exists());
    }
}

#[test]
fn package_requires_valid_directory_local_headers_and_crc() {
    let content = entries();
    let valid = archive(&content);
    let central = central_offset(&valid);
    for offset in [
        LOCAL_HEADER_BYTES,
        LOCAL_HEADER_BYTES + "manifest.json".len(),
        central + 16,
        central + 42,
        valid.len() - END_HEADER_BYTES + 8,
    ] {
        let mut fixture = Fixture::new();
        let mut bytes = valid.clone();
        bytes[offset] ^= 1;
        let path = fixture.source.with_extension("piplug");
        fs::write(&path, bytes).unwrap();
        assert!(
            fixture.host.inspect(&path, false).is_err(),
            "offset {offset}"
        );
        assert!(!fixture.host.base.exists());
    }
}

#[test]
fn package_rejects_unsupported_zip_features_with_diagnostics() {
    for (offset, value, expected) in [
        (8, 8, "压缩"),
        (6, 1, "加密"),
        (6, 8, "标志"),
        (4, 45, "ZIP"),
    ] {
        let mut fixture = Fixture::new();
        let mut bytes = archive(&entries());
        let central = central_offset(&bytes);
        put16(&mut bytes, offset, value);
        put16(&mut bytes, central + offset + 2, value);
        let path = fixture.source.with_extension("piplug");
        fs::write(&path, bytes).unwrap();
        let error = fixture.host.inspect(&path, false).unwrap_err();
        assert!(error.contains(expected), "{error}");
    }
}

#[test]
fn truncated_or_trailing_zip_data_is_rejected_without_installing() {
    let bytes = archive(&entries());
    for size in [0, 4, LOCAL_HEADER_BYTES, bytes.len() - 1] {
        let mut fixture = Fixture::new();
        let path = fixture.source.with_extension("piplug");
        fs::write(&path, &bytes[..size]).unwrap();
        assert!(fixture.host.inspect(&path, false).is_err());
        assert!(!fixture.host.base.exists());
    }
    let mut fixture = Fixture::new();
    let path = fixture.source.with_extension("piplug");
    fs::write(&path, [bytes, b"unexpected".to_vec()].concat()).unwrap();
    assert!(fixture.host.inspect(&path, false).is_err());
}

#[test]
fn package_limits_include_implicit_directories_and_payload_bytes() {
    const ENTRIES_PER_TREE: usize = 4;
    let mut cases = Vec::new();
    let mut files = entries();
    files.extend((0..files::MAX_FILES).map(|n| Entry::new(&format!("file-{n}"), b"")));
    cases.push((files, "文件数量"));
    let mut directories = entries();
    directories.extend(
        (0..files::MAX_ENTRIES / ENTRIES_PER_TREE)
            .map(|n| Entry::new(&format!("a{n}/b/c/file"), b"")),
    );
    cases.push((directories, "总条目"));
    let mut large_file = entries();
    large_file.push(Entry::new(
        "large",
        &vec![0; files::MAX_FILE_BYTES as usize + 1],
    ));
    cases.push((large_file, "成员大小"));
    let mut deep = entries();
    deep.push(Entry::new(
        &format!("{}file", "dir/".repeat(files::MAX_DEPTH + 1)),
        b"",
    ));
    cases.push((deep, "目录层数"));
    for (content, expected) in cases {
        let mut fixture = Fixture::new();
        let path = write_package(&fixture, &content);
        let error = fixture.host.inspect(&path, false).unwrap_err();
        assert!(error.contains(expected), "应由{expected}限制拒绝：{error}");
        assert!(!fixture.host.base.exists());
    }
}

#[test]
fn changed_valid_skill_text_still_requires_the_original_crc() {
    let mut fixture = Fixture::new();
    let content = entries();
    let mut bytes = archive(&content);
    let skill_record = LOCAL_HEADER_BYTES + content[0].name.len() + content[0].bytes.len();
    let skill_text = skill_record + LOCAL_HEADER_BYTES + content[1].name.len();
    bytes[skill_text] = b'S';
    let path = fixture.source.with_extension("piplug");
    fs::write(&path, bytes).unwrap();
    let error = fixture.host.inspect(&path, false).unwrap_err();
    assert!(error.contains("CRC"), "{error}");
    assert!(!fixture.host.base.exists());
}

#[test]
fn total_payload_limit_applies_below_the_archive_file_limit() {
    const DATA_FILES: usize = 5;
    let mut fixture = Fixture::new();
    let mut content = entries();
    let chunk = vec![0; files::MAX_TOTAL_BYTES / DATA_FILES];
    for number in 0..DATA_FILES {
        content.push(Entry::new(&format!("data-{number}"), &chunk));
    }
    let path = write_package(&fixture, &content);
    let error = fixture.host.inspect(&path, false).unwrap_err();
    assert!(error.contains("总大小"), "{error}");
    assert!(!fixture.host.base.exists());
}
