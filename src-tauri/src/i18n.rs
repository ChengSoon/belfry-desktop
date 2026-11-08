//! Frontend sends its resolved language; the same file is read by every CLI invocation.
use belfry_i18n::Locale;
use std::{path::Path, sync::Mutex};
use tauri::{AppHandle, Manager};
use crate::{atomic::write_atomic, terminal::AppError};

static SAVE: Mutex<()> = Mutex::new(());

pub(crate) fn initialize(identifier: &str) {
    let path = dirs::data_dir().map(|root| root.join(identifier).join("locale.json"));
    belfry_i18n::initialize_app(path.as_deref());
}

fn persist(path: &Path, locale: &str) -> Result<Locale, AppError> {
    let language = match locale {
        "zh-CN" => Locale::ZhCn,
        "en" => Locale::En,
        _ => return Err(AppError::invalid_argument("Locale must be zh-CN or en.")),
    };
    let text = serde_json::json!({ "version": 1, "locale": language.as_str() }).to_string();
    write_atomic(path, &text, true)?;
    Ok(language)
}

#[tauri::command]
pub fn app_set_locale(app: AppHandle, locale: String) -> Result<(), AppError> {
    let _save = SAVE.lock().map_err(|_| AppError::io("Locale settings are unavailable."))?;
    let path = app.path().app_data_dir().map_err(|error| AppError::io(error.to_string()))?.join("locale.json");
    let language = persist(&path, &locale)?;
    let changed = belfry_i18n::current() != language;
    belfry_i18n::set_current(language);
    if let Err(error) = refresh_menu(&app) { log::warn!("Cannot update native menu language: {error}"); }
    if changed { crate::setup::install_skill_on_startup(); }
    Ok(())
}

pub(crate) fn refresh_menu(app: &AppHandle) -> tauri::Result<()> {
    if let Some(menu) = app.menu() { translate_items(menu.items()?)?; }
    Ok(())
}
fn translate_items(items: Vec<tauri::menu::MenuItemKind<tauri::Wry>>) -> tauri::Result<()> {
    use tauri::menu::MenuItemKind;
    for item in items {
        match item {
            MenuItemKind::Submenu(item) => { item.set_text(&belfry_i18n::localize(&item.text()?))?; translate_items(item.items()?)?; }
            MenuItemKind::MenuItem(item) => item.set_text(&belfry_i18n::localize(&item.text()?))?,
            MenuItemKind::Predefined(item) => item.set_text(&belfry_i18n::localize(&item.text()?))?,
            MenuItemKind::Check(item) => item.set_text(&belfry_i18n::localize(&item.text()?))?,
            MenuItemKind::Icon(item) => item.set_text(&belfry_i18n::localize(&item.text()?))?,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn locale_settings_roundtrip_and_failed_updates_keep_the_previous_file() {
        let root = std::env::temp_dir().join(format!("belfry-locale-{}", ulid::Ulid::generate()));
        let path = root.join("locale.json");
        assert_eq!(persist(&path, "en").unwrap(), Locale::En);
        let before = std::fs::read(&path).unwrap();
        assert!(persist(&path, "unsupported").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(persist(&path, "zh-CN").unwrap(), Locale::ZhCn);
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&std::fs::read(&path).unwrap()).unwrap()["locale"], "zh-CN");
        let _ = std::fs::remove_dir_all(root);
    }
}
