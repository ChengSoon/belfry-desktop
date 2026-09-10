use super::files::{MAX_ENTRIES, MAX_FILE_BYTES};

const LOCAL_SIGNATURE: u32 = 0x0403_4b50;
const CENTRAL_SIGNATURE: u32 = 0x0201_4b50;
const END_SIGNATURE: u32 = 0x0605_4b50;
const END_HEADER_BYTES: usize = 22;
const STORE_VERSION: u16 = 20;
const UTF8_FLAG: u16 = 0x0800;
const ENCRYPTED_FLAG: u16 = 1;
const MODE_MASK: u32 = 0o170000;
const REGULAR_MODE: u32 = 0o100000;
const DIRECTORY_MODE: u32 = 0o040000;
const DOS_DIRECTORY: u32 = 0x10;

pub(super) struct Entry<'a> {
    pub name: &'a str,
    pub bytes: &'a [u8],
    pub directory: bool,
}
struct Header<'a> {
    name: &'a str,
    flags: u16,
    checksum: u32,
    size: usize,
    offset: usize,
    directory: bool,
}
struct Directory {
    offset: usize,
    size: usize,
    count: usize,
}

pub(super) fn read_entries(bytes: &[u8]) -> Result<Vec<Entry<'_>>, String> {
    let directory = read_directory(bytes)?;
    let mut central = Cursor::new(&bytes[directory.offset..directory.offset + directory.size]);
    let mut local = Cursor::new(&bytes[..directory.offset]);
    let mut entries = Vec::with_capacity(directory.count);
    for _ in 0..directory.count {
        let header = read_header(&mut central)?;
        if header.offset != local.position {
            return Err("ZIP 成员索引重叠、乱序或含未声明内容".into());
        }
        entries.push(read_local(&mut local, header)?);
    }
    if central.position != directory.size || local.position != directory.offset {
        return Err("ZIP 目录大小或成员数量不一致".into());
    }
    Ok(entries)
}
fn read_directory(bytes: &[u8]) -> Result<Directory, String> {
    let last = bytes
        .len()
        .checked_sub(END_HEADER_BYTES)
        .ok_or("插件包已截断")?;
    let start = last.saturating_sub(usize::from(u16::MAX));
    let offset = (start..=last)
        .rev()
        .find(|&index| {
            let comment = index + END_HEADER_BYTES - 2;
            bytes[index..index + 4] == END_SIGNATURE.to_le_bytes()
                && index
                    + END_HEADER_BYTES
                    + usize::from(u16::from_le_bytes([bytes[comment], bytes[comment + 1]]))
                    == bytes.len()
        })
        .ok_or("插件包缺少完整 ZIP 目录或含尾随数据")?;
    let mut reader = Cursor::new(&bytes[offset..]);
    reader.signature(END_SIGNATURE)?;
    if reader.u16()? != 0 || reader.u16()? != 0 {
        return Err("不支持分卷 ZIP 插件包".into());
    }
    let disk_count = usize::from(reader.u16()?);
    let count = usize::from(reader.u16()?);
    let size = reader.u32()? as usize;
    let position = reader.u32()? as usize;
    if count != disk_count || count > MAX_ENTRIES || position.checked_add(size) != Some(offset) {
        return Err("ZIP 目录数量、大小无效或超额，不支持 ZIP64".into());
    }
    Ok(Directory {
        offset: position,
        size,
        count,
    })
}
fn read_header<'a>(reader: &mut Cursor<'a>) -> Result<Header<'a>, String> {
    reader.signature(CENTRAL_SIGNATURE)?;
    reader.take(2)?;
    let version = reader.u16()?;
    let flags = reader.u16()?;
    let method = reader.u16()?;
    validate_encoding(version, flags, method)?;
    reader.take(4)?;
    let checksum = reader.u32()?;
    let compressed = reader.u32()? as usize;
    let size = reader.u32()? as usize;
    if compressed != size || size as u64 > MAX_FILE_BYTES {
        return Err("插件包成员大小无效或超额".into());
    }
    let name_length = usize::from(reader.u16()?);
    let extra_length = usize::from(reader.u16()?);
    let comment_length = usize::from(reader.u16()?);
    if reader.u16()? != 0 {
        return Err("不支持分卷 ZIP 插件包".into());
    }
    reader.take(2)?;
    let attributes = reader.u32()?;
    let offset = reader.u32()? as usize;
    let name =
        std::str::from_utf8(reader.take(name_length)?).map_err(|_| "包内路径必须为 UTF-8")?;
    reader.take(extra_length + comment_length)?;
    let directory = validate_type(name, attributes)?;
    Ok(Header {
        name,
        flags,
        checksum,
        size,
        offset,
        directory,
    })
}
fn read_local<'a>(reader: &mut Cursor<'a>, header: Header<'a>) -> Result<Entry<'a>, String> {
    reader.signature(LOCAL_SIGNATURE)?;
    let version = reader.u16()?;
    let flags = reader.u16()?;
    let method = reader.u16()?;
    validate_encoding(version, flags, method)?;
    reader.take(4)?;
    let checksum = reader.u32()?;
    let compressed = reader.u32()? as usize;
    let size = reader.u32()? as usize;
    let name_length = usize::from(reader.u16()?);
    let extra_length = usize::from(reader.u16()?);
    let name = reader.take(name_length)?;
    if flags != header.flags
        || checksum != header.checksum
        || compressed != header.size
        || size != header.size
        || name != header.name.as_bytes()
    {
        return Err("ZIP 本地记录与目录不一致".into());
    }
    reader.take(extra_length)?;
    let bytes = reader.take(size)?;
    if crc32(bytes) != checksum {
        return Err("插件包 CRC 校验失败，文件可能已损坏".into());
    }
    if header.directory && !bytes.is_empty() {
        return Err("ZIP 目录不能包含文件正文".into());
    }
    Ok(Entry {
        name: header.name,
        bytes,
        directory: header.directory,
    })
}
fn validate_encoding(version: u16, flags: u16, method: u16) -> Result<(), String> {
    if version > STORE_VERSION {
        return Err("当前仅支持 ZIP32 Store 插件包".into());
    }
    if flags & ENCRYPTED_FLAG != 0 {
        return Err("不支持加密插件包".into());
    }
    if method != 0 {
        return Err("暂不支持该压缩方式，请使用未压缩（Store）插件包".into());
    }
    if flags & !UTF8_FLAG != 0 {
        return Err("插件包使用了未支持的 ZIP 标志".into());
    }
    Ok(())
}
fn validate_type(name: &str, attributes: u32) -> Result<bool, String> {
    let mode = (attributes >> 16) & MODE_MASK;
    if ![0, REGULAR_MODE, DIRECTORY_MODE].contains(&mode) {
        return Err("插件包不能包含符号链接或特殊文件".into());
    }
    let directory = name.ends_with('/');
    if (mode == DIRECTORY_MODE || attributes & DOS_DIRECTORY != 0) && !directory
        || directory && mode == REGULAR_MODE
    {
        return Err("ZIP 成员类型与路径不一致".into());
    }
    Ok(directory)
}

struct Cursor<'a> {
    bytes: &'a [u8],
    position: usize,
}
impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }
    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self.position.checked_add(count).ok_or("ZIP 索引超额")?;
        let result = self
            .bytes
            .get(self.position..end)
            .ok_or("插件包已截断或索引越界")?;
        self.position = end;
        Ok(result)
    }
    fn u16(&mut self) -> Result<u16, String> {
        let b = self.take(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }
    fn u32(&mut self) -> Result<u32, String> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn signature(&mut self, expected: u32) -> Result<(), String> {
        if self.u32()? != expected {
            return Err("ZIP 记录标识无效".into());
        }
        Ok(())
    }
}
const CRC_TABLE: [u32; 256] = crc_table();
const fn crc_table() -> [u32; 256] {
    const POLYNOMIAL: u32 = 0xedb8_8320;
    let mut table = [0; 256];
    let mut index = 0;
    while index < table.len() {
        let mut value = index as u32;
        let mut bit = 0;
        while bit < u8::BITS {
            value = (value >> 1) ^ if value & 1 == 0 { 0 } else { POLYNOMIAL };
            bit += 1;
        }
        table[index] = value;
        index += 1;
    }
    table
}
fn crc32(bytes: &[u8]) -> u32 {
    !bytes.iter().fold(u32::MAX, |crc, byte| {
        (crc >> u8::BITS) ^ CRC_TABLE[((crc ^ u32::from(*byte)) & u32::from(u8::MAX)) as usize]
    })
}
