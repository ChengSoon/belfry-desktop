use super::*;

#[test]
fn utf8_bom_empty_and_terminal_log_text_are_not_binary() {
    for (bytes, expected) in [
        (&b""[..], ""),
        (&b"\xef\xbb\xbf"[..], ""),
        (&b"\xef\xbb\xbfhello\n"[..], "hello\n"),
        ("名称=中文 😀\n".as_bytes(), "名称=中文 😀\n"),
        (
            &b"\x1b[31mred\x1b[0m\npage\x0c"[..],
            "\x1b[31mred\x1b[0m\npage\x0c",
        ),
    ] {
        assert_eq!(decode(bytes, false).as_deref(), Some(expected));
    }
}

#[test]
fn utf16_with_and_without_bom_preserves_chinese_and_surrogate_pairs() {
    let text = "name=中文项目\r\nemoji=😀\r\n";
    for little_endian in [true, false] {
        let bytes: Vec<u8> = text
            .encode_utf16()
            .flat_map(|unit| {
                if little_endian {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                }
            })
            .collect();
        assert_eq!(decode(&bytes, false).as_deref(), Some(text));
        let mut with_bom = if little_endian {
            vec![0xff, 0xfe]
        } else {
            vec![0xfe, 0xff]
        };
        assert_eq!(decode(&with_bom, false).as_deref(), Some(""));
        with_bom.extend(bytes);
        assert_eq!(decode(&with_bom, false).as_deref(), Some(text));
    }
}

#[test]
fn utf32_boms_are_recognized_before_the_utf16_le_bom() {
    let text = "中文 😀\n";
    for little_endian in [true, false] {
        let mut bytes = if little_endian {
            vec![0xff, 0xfe, 0, 0]
        } else {
            vec![0, 0, 0xfe, 0xff]
        };
        bytes.extend(text.chars().flat_map(|character| {
            if little_endian {
                (character as u32).to_le_bytes()
            } else {
                (character as u32).to_be_bytes()
            }
        }));
        assert_eq!(decode(&bytes, false).as_deref(), Some(text));
        bytes.extend([0xe0, 0]);
        assert_eq!(decode(&bytes, true).as_deref(), Some(text));
        assert!(decode(&bytes, false).is_none());
    }
}

#[test]
fn detects_legacy_chinese_japanese_and_western_text() {
    // Fixed bytes from real encoding formats; don't generate the expectations
    // with the same decoder under test.
    let gbk = [
        213, 226, 202, 199, 210, 187, 184, 246, 214, 208, 206, 196, 197, 228, 214, 195, 206, 196,
        188, 254, 163, 172, 211, 195, 211, 218, 209, 233, 214, 164, 206, 196, 188, 254, 212, 164,
        192, 192, 161, 163, 10, 195, 251, 179, 198, 61, 178, 226, 202, 212, 207, 238, 196, 191, 10,
        194, 183, 190, 182, 61, 185, 164, 215, 247, 196, 191, 194, 188, 10,
    ];
    assert_eq!(
        decode(&gbk, false).as_deref(),
        Some("这是一个中文配置文件，用于验证文件预览。\n名称=测试项目\n路径=工作目录\n")
    );
    let sjis = [
        130, 177, 130, 234, 130, 205, 147, 250, 150, 123, 140, 234, 130, 204, 144, 221, 146, 232,
        131, 116, 131, 64, 131, 67, 131, 139, 130, 197, 130, 183, 129, 66, 10, 150, 188, 145, 79,
        61, 131, 101, 131, 88, 131, 103, 10,
    ];
    assert_eq!(
        decode(&sjis, false).as_deref(),
        Some("これは日本語の設定ファイルです。\n名前=テスト\n")
    );
    assert_eq!(decode(b"caf\xe9\n", false).as_deref(), Some("café\n"));
}

#[test]
fn truncated_utf8_utf16_and_legacy_characters_keep_the_valid_prefix() {
    for suffix in [&b"\xe4"[..], &b"\xe4\xb8"[..], &b"\xf0\x9f\x98"[..]] {
        let mut bytes = "中文\n".as_bytes().to_vec();
        bytes.extend(suffix);
        assert_eq!(decode(&bytes, true).as_deref(), Some("中文\n"));
    }
    // UTF-16LE: BOM + 'A' + one half of a surrogate pair, or half a code unit.
    assert_eq!(
        decode(&[0xff, 0xfe, 0x41, 0, 0x3d, 0xd8], true).as_deref(),
        Some("A")
    );
    assert_eq!(
        decode(&[0xff, 0xfe, 0x41, 0, 0x2d], true).as_deref(),
        Some("A")
    );
    let text = "这是一个中文配置文件，用于验证文件预览。\n";
    let (gbk, _, _) = encoding_rs::GBK.encode(text);
    let mut bytes = gbk.into_owned();
    bytes.push(0xd6);
    assert_eq!(decode(&bytes, true).as_deref(), Some(text));
}

#[test]
fn binary_payloads_and_nuls_after_the_sample_stay_binary() {
    for bytes in [
        &b"abc\0text"[..],
        &b"one\0two\0three"[..],
        &b"\0\x01\x02\x03"[..],
        &b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"[..],
        &b"PK\x03\x04\x14\0\x06\0\x08\0"[..],
        &b"\x7fELF\x02\x01\x01\0\0\0"[..],
        &b"\x01\x02\x03\x04\x05\x06\x07"[..],
    ] {
        assert!(decode(bytes, false).is_none(), "binary bytes: {bytes:?}");
    }
    let mut bytes = vec![b'a'; 9_000];
    bytes.push(0);
    assert!(decode(&bytes, false).is_none());
    assert!(
        decode(&[0xff, 0xfe, 0x41, 0, 0, 0], false).is_none(),
        "decoded NUL is binary even with a Unicode BOM"
    );
}
