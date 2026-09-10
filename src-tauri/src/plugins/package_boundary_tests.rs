use super::{package_test_support::*, tests::Fixture};
use std::fs;

#[test]
fn zip_directory_bounds_cannot_escape_the_archive() {
    for (field, value) in [(12, u32::MAX), (16, u32::MAX), (4, 1), (6, 1)] {
        let mut fixture = Fixture::new();
        let mut bytes = archive(&entries());
        let footer = bytes.len() - END_HEADER_BYTES;
        put32(&mut bytes, footer + field, value);
        let path = fixture.source.with_extension("piplug");
        fs::write(&path, bytes).unwrap();
        assert!(fixture.host.inspect(&path, false).is_err());
        assert!(!fixture.host.base.exists());
    }
}

#[test]
fn zip_extension_and_a_valid_archive_comment_are_supported() {
    let mut fixture = Fixture::new();
    let mut bytes = archive(&entries());
    let footer = bytes.len() - END_HEADER_BYTES;
    let comment = b"A comment with PK\x05\x06 inside.";
    put16(&mut bytes, footer + 20, comment.len() as u16);
    bytes.extend(comment);
    let path = fixture.source.with_extension("ZIP");
    fs::write(&path, bytes).unwrap();
    let preview = fixture.host.inspect(&path, false).unwrap();
    assert_eq!("example.review", preview.manifest.id);
    assert!(!fixture.host.base.exists());
}

#[cfg(unix)]
#[test]
fn a_package_source_symlink_is_rejected_before_preview() {
    let mut fixture = Fixture::new();
    let source = write_package(&fixture, &entries());
    let link = fixture.source.with_extension("linked.piplug");
    std::os::unix::fs::symlink(source, &link).unwrap();
    assert!(
        fixture
            .host
            .inspect(&link, false)
            .unwrap_err()
            .contains("符号链接")
    );
    assert!(!fixture.host.base.exists());
}
