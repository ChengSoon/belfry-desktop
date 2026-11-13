//! 主窗口的首帧与原生底色。
//!
//! 窗口以 `visible: false` 创建（见 tauri*.conf.json），先按系统外观涂上曜石的 `--backdrop`，
//! 等前端按用户真正的主题提交第一帧后再显示：这样不论 WebView 首帧前画什么（macOS 上
//! 不开私有 API 时 WKWebView 自己的白底），用户都看不到。前端出错没来得及报到时，
//! [`REVEAL_TIMEOUT`] 兜底把窗口显示出来，绝不让应用"启动了但看不见"。
//!
//! 运行中切换主题也走同一个命令，让 resize 新露出的边缘与内容面四周的缝跟着变色。
//! 取值与前端共用 `src/theme/backdrop.json`，与 `styles.css` 的一致性由
//! `src/theme/obsidianNative.test.mjs` 锁住。
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{window::Color, AppHandle, Manager, Runtime, WebviewWindow};

use crate::terminal::AppError;

const MAIN: &str = "main";
const REVEAL_TIMEOUT: Duration = Duration::from_secs(3);
const BACKDROP_JSON: &str = include_str!("../../src/theme/backdrop.json");

static REVEALED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Dark,
    Light,
}

fn parse_mode(theme: &str) -> Result<Mode, AppError> {
    match theme {
        "dark" => Ok(Mode::Dark),
        "light" => Ok(Mode::Light),
        _ => Err(AppError::invalid_argument("Theme must be dark or light.")),
    }
}

fn parse_hex(value: &str) -> Option<Color> {
    let hex = value.strip_prefix('#').filter(|hex| hex.len() == 6)?;
    let channel = |index: usize| u8::from_str_radix(&hex[index..index + 2], 16).ok();
    Some(Color(channel(0)?, channel(2)?, channel(4)?, 0xff))
}

fn backdrop(mode: Mode) -> Color {
    let fallback = match mode {
        Mode::Dark => Color(0x0c, 0x0d, 0x10, 0xff),
        Mode::Light => Color(0xec, 0xec, 0xef, 0xff),
    };
    let key = match mode { Mode::Dark => "dark", Mode::Light => "light" };
    serde_json::from_str::<serde_json::Value>(BACKDROP_JSON).ok()
        .and_then(|palette| palette.get(key)?.as_str().and_then(parse_hex))
        .unwrap_or(fallback)
}

fn paint<R: Runtime>(window: &WebviewWindow<R>, mode: Mode) {
    if let Err(error) = window.set_background_color(Some(backdrop(mode))) {
        log::warn!("Cannot set native window backdrop: {error}");
    }
}

fn reveal<R: Runtime>(window: &WebviewWindow<R>) {
    if REVEALED.swap(true, Ordering::AcqRel) { return; }
    if let Err(error) = window.show() { log::warn!("Cannot show main window: {error}"); }
    let _ = window.set_focus();
}

/// setup 阶段调用：按系统外观先涂一层，再挂上超时兜底。
pub fn prepare<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN) else { return };
    let mode = match window.theme() { Ok(tauri::Theme::Light) => Mode::Light, _ => Mode::Dark };
    paint(&window, mode);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(REVEAL_TIMEOUT);
        if REVEALED.load(Ordering::Acquire) { return; }
        log::warn!("Main window revealed by timeout; the frontend never reported its first frame.");
        let target = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(window) = target.get_webview_window(MAIN) { reveal(&window); }
        });
    });
}

/// 前端在主题生效（首帧与之后每次切换）时调用：同步原生底色；首次调用时显示窗口。
#[tauri::command]
pub fn app_window_backdrop(app: AppHandle, theme: String) -> Result<(), AppError> {
    let mode = parse_mode(&theme)?;
    let window = app.get_webview_window(MAIN).ok_or_else(|| AppError::io("Main window is unavailable."))?;
    paint(&window, mode);
    reveal(&window);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backdrop_json_parses_for_both_modes() {
        let palette: serde_json::Value = serde_json::from_str(BACKDROP_JSON).unwrap();
        for (key, mode) in [("dark", Mode::Dark), ("light", Mode::Light)] {
            let parsed = parse_hex(palette[key].as_str().unwrap()).expect("backdrop.json holds #rrggbb");
            let Color(r, g, b, a) = backdrop(mode);
            assert_eq!((r, g, b, a), (parsed.0, parsed.1, parsed.2, 0xff));
        }
    }

    #[test]
    fn rejects_unknown_theme_and_malformed_colors() {
        assert!(parse_mode("sepia").is_err());
        assert_eq!(parse_mode("light").unwrap(), Mode::Light);
        assert!(parse_hex("#fff").is_none());
        assert!(parse_hex("0c0d10").is_none());
        assert!(parse_hex("#0c0d1g").is_none());
    }
}
