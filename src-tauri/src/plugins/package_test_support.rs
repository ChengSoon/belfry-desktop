use super::tests::{Fixture, manifest_text};
use std::{fs, path::PathBuf};

pub(super) const LOCAL_HEADER_BYTES: usize = 30;
pub(super) const CENTRAL_HEADER_BYTES: usize = 46;
pub(super) const END_HEADER_BYTES: usize = 22;

pub(super) struct Entry {
    pub name: String,
    pub bytes: Vec<u8>,
    pub mode: u32,
}
impl Entry {
    pub fn new(name: &str, bytes: &[u8]) -> Self {
        Self {
            name: name.into(),
            bytes: bytes.into(),
            mode: 0,
        }
    }
}
pub(super) fn entries() -> Vec<Entry> {
    vec![
        Entry::new("manifest.json", manifest_text().as_bytes()),
        Entry::new("SKILL.md", b"Review the diff."),
    ]
}
pub(super) fn write_package(fixture: &Fixture, entries: &[Entry]) -> PathBuf {
    let path = fixture.source.with_extension("piplug");
    fs::write(&path, archive(entries)).unwrap();
    path
}
// 按 ZIP32 规范生成测试输入；不调用被测读取器或其校验函数。
pub(super) fn archive(entries: &[Entry]) -> Vec<u8> {
    let mut local = Vec::new();
    let mut central = Vec::new();
    for entry in entries {
        central.extend(central_record(entry, local.len()));
        local.extend(local_record(entry));
    }
    let mut end = vec![0; END_HEADER_BYTES];
    put32(&mut end, 0, 0x0605_4b50);
    put16(&mut end, 8, entries.len() as u16);
    put16(&mut end, 10, entries.len() as u16);
    put32(&mut end, 12, central.len() as u32);
    put32(&mut end, 16, local.len() as u32);
    local.extend(central);
    local.extend(end);
    local
}
fn local_record(entry: &Entry) -> Vec<u8> {
    let mut data = vec![0; LOCAL_HEADER_BYTES];
    put32(&mut data, 0, 0x0403_4b50);
    put16(&mut data, 4, 20);
    put16(&mut data, 6, 0x0800);
    put32(&mut data, 14, checksum(&entry.bytes));
    put32(&mut data, 18, entry.bytes.len() as u32);
    put32(&mut data, 22, entry.bytes.len() as u32);
    put16(&mut data, 26, entry.name.len() as u16);
    data.extend(entry.name.as_bytes());
    data.extend(&entry.bytes);
    data
}
fn central_record(entry: &Entry, offset: usize) -> Vec<u8> {
    let mut data = vec![0; CENTRAL_HEADER_BYTES];
    put32(&mut data, 0, 0x0201_4b50);
    put16(&mut data, 4, 0x0314);
    put16(&mut data, 6, 20);
    put16(&mut data, 8, 0x0800);
    put32(&mut data, 16, checksum(&entry.bytes));
    put32(&mut data, 20, entry.bytes.len() as u32);
    put32(&mut data, 24, entry.bytes.len() as u32);
    put16(&mut data, 28, entry.name.len() as u16);
    put32(&mut data, 38, entry.mode << 16);
    put32(&mut data, 42, offset as u32);
    data.extend(entry.name.as_bytes());
    data
}
fn checksum(data: &[u8]) -> u32 {
    const CRC32_POLYNOMIAL: u32 = 0xedb8_8320;
    let mut crc = u32::MAX;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..u8::BITS {
            crc = (crc >> 1) ^ if crc & 1 == 0 { 0 } else { CRC32_POLYNOMIAL };
        }
    }
    !crc
}
pub(super) fn put16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}
pub(super) fn put32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}
pub(super) fn central_offset(bytes: &[u8]) -> usize {
    let offset = bytes.len() - END_HEADER_BYTES + 16;
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize
}
