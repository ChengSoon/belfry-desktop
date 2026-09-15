use std::{ffi::c_void, fs::File, io, os::windows::io::AsRawHandle};

// Win32 BY_HANDLE_FILE_INFORMATION；文件 ID 可区分保留大小和时间戳的同路径替换。
#[repr(C)]
#[derive(Default)]
struct FileInformation {
    attributes: u32,
    created: [u32; 2],
    accessed: [u32; 2],
    written: [u32; 2],
    volume: u32,
    size_high: u32,
    size_low: u32,
    links: u32,
    index_high: u32,
    index_low: u32,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "GetFileInformationByHandle"]
    fn get_file_information(handle: *mut c_void, information: *mut FileInformation) -> i32;
}

pub(super) fn read(file: &File) -> io::Result<(u64, u64)> {
    let mut information = FileInformation::default();
    // 句柄由借用的 File 持有；输出指针指向完整、可写且布局兼容的 Win32 结构体。
    if unsafe { get_file_information(file.as_raw_handle(), &mut information) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let index = (u64::from(information.index_high) << u32::BITS) | u64::from(information.index_low);
    Ok((u64::from(information.volume), index))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage::analytics::fixtures::Fixture;

    #[test]
    fn windows_file_identity_is_stable_and_separates_replacement_files() {
        let fixture = Fixture::new();
        let one = File::open(fixture.write_text("one.tmp", "fixture")).unwrap();
        let two = File::open(fixture.write_text("two.tmp", "fixture")).unwrap();
        assert_eq!(read(&one).unwrap(), read(&one).unwrap());
        assert_ne!(read(&one).unwrap(), read(&two).unwrap());
    }
}
