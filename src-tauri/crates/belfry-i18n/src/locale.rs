use std::{cell::Cell, io::Read, path::{Path, PathBuf}, sync::atomic::{AtomicU8, Ordering}};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locale { ZhCn, En }
impl Locale {
    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().replace('_', "-").as_str() {
            "zh" | "zh-cn" | "zh-hans" | "zh-sg" => Some(Self::ZhCn),
            "en" | "en-us" | "en-gb" => Some(Self::En),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str { if self == Self::ZhCn { "zh-CN" } else { "en" } }
}

// Production entry points initialize this before creating a window, daemon, or CLI response.
static CURRENT: AtomicU8 = AtomicU8::new(0);
thread_local! { static OVERRIDE: Cell<Option<Locale>> = const { Cell::new(None) }; }

pub fn current() -> Locale {
    OVERRIDE.get().unwrap_or_else(|| if CURRENT.load(Ordering::Acquire) == 0 { Locale::ZhCn } else { Locale::En })
}
pub fn set_current(locale: Locale) { CURRENT.store(if locale == Locale::ZhCn { 0 } else { 1 }, Ordering::Release); }

/// Scoped, thread-local locale, also useful for deterministic tests without changing process environment.
pub fn with_locale<T>(locale: Locale, action: impl FnOnce() -> T) -> T {
    struct Guard(Option<Locale>);
    impl Drop for Guard { fn drop(&mut self) { OVERRIDE.set(self.0); } }
    let _guard = Guard(OVERRIDE.replace(Some(locale)));
    action()
}

pub fn resolve(explicit: Option<&str>, saved: Option<&str>, system: Option<&str>) -> Locale {
    explicit.and_then(Locale::parse).or_else(|| saved.and_then(Locale::parse)).unwrap_or_else(|| {
        if system.is_some_and(|value| value.to_ascii_lowercase().starts_with("zh")) { Locale::ZhCn } else { Locale::En }
    })
}

pub fn preference_path() -> Option<PathBuf> {
    std::env::var_os("BELFRY_LOCALE_FILE").filter(|path| !path.is_empty()).map(PathBuf::from)
        .or_else(|| dirs::data_dir().map(|root| root.join("io.appmakes.belfry.desktop").join("locale.json")))
}

fn saved(path: &Path) -> Option<String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path).ok()?.take(4097).read_to_end(&mut bytes).ok()?;
    if bytes.len() > 4096 { return None; }
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value.get("locale")?.as_str().map(str::to_owned)
}

pub fn initialize_app(path: Option<&Path>) {
    let saved = path.and_then(saved);
    if let Some(saved) = saved.as_deref().and_then(Locale::parse) {
        set_current(saved);
        return;
    }
    set_current(resolve(None, None, crate::system_locale::get().as_deref()));
}
pub fn initialize_cli() {
    if let Some(explicit) = std::env::var("BELFRY_LANG").ok().as_deref().and_then(Locale::parse) {
        set_current(explicit);
        return;
    }
    let saved = preference_path().as_deref().and_then(saved);
    if let Some(saved) = saved.as_deref().and_then(Locale::parse) {
        set_current(saved);
        return;
    }
    set_current(resolve(None, None, crate::system_locale::get().as_deref()));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn locale_precedence_and_system_fallback_are_explicit() {
        assert_eq!(resolve(Some("en"), Some("zh-CN"), Some("zh-CN")), Locale::En);
        assert_eq!(resolve(None, Some("zh-CN"), Some("en-US")), Locale::ZhCn);
        assert_eq!(resolve(None, None, Some("zh-TW")), Locale::ZhCn);
        assert_eq!(resolve(None, None, Some("fr-FR")), Locale::En);
        assert_eq!(resolve(Some("invalid"), Some("en"), None), Locale::En);
    }
    #[test]
    fn scoped_locales_restore_after_a_panic() {
        let before = current();
        let _ = std::panic::catch_unwind(|| with_locale(Locale::En, || panic!("scope")));
        assert_eq!(current(), before);
    }
}
