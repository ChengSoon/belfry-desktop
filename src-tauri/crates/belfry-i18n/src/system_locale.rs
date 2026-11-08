//! Load platform locale APIs only when no explicit or saved language is available.
//! In particular, the small CLI must enter main before loading macOS frameworks,
//! so framework initialization is covered by its absolute wait deadline.

#[cfg(not(target_os = "macos"))]
pub fn get() -> Option<String> { sys_locale::get_locale() }

#[cfg(target_os = "macos")]
pub fn get() -> Option<String> {
    use libloading::Library;
    use std::{ffi::{CStr, c_char, c_void}, sync::OnceLock};

    type Object = *const c_void;
    type CopyLanguages = unsafe extern "C" fn() -> Object;
    type Count = unsafe extern "C" fn(Object) -> isize;
    type Item = unsafe extern "C" fn(Object, isize) -> Object;
    type CopyUtf8 = unsafe extern "C" fn(Object, *mut c_char, isize, u32) -> u8;
    type Release = unsafe extern "C" fn(Object);

    static FRAMEWORK: OnceLock<Option<Library>> = OnceLock::new();
    let library = FRAMEWORK.get_or_init(|| {
        // The path is a fixed OS framework, never caller-controlled. Keeping the
        // handle alive also keeps the function pointers valid during CF releases.
        unsafe { Library::new("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation").ok() }
    }).as_ref()?;

    struct Owned(Object, Release);
    impl Drop for Owned { fn drop(&mut self) { unsafe { (self.1)(self.0); } } }

    // These signatures are the public CoreFoundation C ABI. Copy returns an owned
    // array; values read from it are borrowed and remain valid until Owned drops.
    unsafe {
        let copy = library.get::<CopyLanguages>(b"CFLocaleCopyPreferredLanguages\0").ok()?;
        let count = library.get::<Count>(b"CFArrayGetCount\0").ok()?;
        let item = library.get::<Item>(b"CFArrayGetValueAtIndex\0").ok()?;
        let utf8 = library.get::<CopyUtf8>(b"CFStringGetCString\0").ok()?;
        let release = *library.get::<Release>(b"CFRelease\0").ok()?;
        let array = copy();
        if array.is_null() { return None; }
        let languages = Owned(array, release);
        if count(languages.0) == 0 { return None; }
        let first = item(languages.0, 0);
        if first.is_null() { return None; }
        let mut bytes = [0_u8; 256];
        const UTF8: u32 = 0x0800_0100;
        if utf8(first, bytes.as_mut_ptr().cast(), bytes.len() as isize, UTF8) == 0 { return None; }
        CStr::from_bytes_until_nul(&bytes).ok()?.to_str().ok().map(str::to_owned)
    }
}
