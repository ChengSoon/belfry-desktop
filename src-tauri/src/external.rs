use crate::terminal::AppError;

#[cfg(any(target_os = "windows", test))]
mod windows;

pub mod commands {
    use super::{AppError, open_url};
    use tauri::command;

    /// 打开外部 http/https 链接。
    ///
    /// 走系统原生方式，同步等待结果并把错误回报给前端。
    /// tauri-plugin-opener 的 detached 模式「派发即返回成功」，
    /// 真正打开失败时前端看不到错误。
    #[command]
    pub fn open_external(url: String, app: tauri::AppHandle) -> Result<(), AppError> {
        // 仅允许网页协议；各平台直接传递 URL，不经命令解释器。
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(AppError::invalid_argument(format!("仅支持 http/https 链接: {url}")));
        }
        open_url(&url, app)
    }
}

/// 使用统一的脱敏、容量受限日志记录浏览器派发结果。
fn log_call(url: &str, outcome: &str) {
    log::info!(target: "belfry::external", "Open external URL outcome={outcome} url={url}");
}

/// macOS：在主线程用 NSWorkspace 打开 URL，并强制激活默认浏览器到前台。
///
/// `open` 命令和 NSWorkspace 的简易 openURL: 对**已在运行**的浏览器只投递
/// URL、不激活窗口，用户盯着本应用以为「没反应」。这里打开 URL 后再查默认
/// 浏览器的运行实例，用 activateWithOptions 强制切到前台。
#[cfg(target_os = "macos")]
fn open_url(url: &str, app: tauri::AppHandle) -> Result<(), AppError> {
    let url = url.to_string();
    let log_url = url.clone();
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, AppError>>();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<String, AppError> {
            use objc2_app_kit::{
                NSApplicationActivationOptions, NSRunningApplication, NSWorkspace,
                NSWorkspaceOpenConfiguration,
            };
            use objc2_foundation::{NSBundle, NSString, NSURL};
            // URLWithString: 是类方法，直接构造，不用先 alloc。
            let nsurl = NSURL::URLWithString(&NSString::from_str(&url))
                .ok_or_else(|| AppError::invalid_argument(format!("无法构造 URL: {url}")))?;
            let workspace = NSWorkspace::sharedWorkspace();
            let config = NSWorkspaceOpenConfiguration::configuration();
            config.setActivates(true);
            workspace.openURL_configuration_completionHandler(&nsurl, &config, None);
            // 兜底：直接激活默认浏览器的运行实例，确保切到前台。
            let mut diag = String::new();
            match workspace.URLForApplicationToOpenURL(&nsurl) {
                None => diag.push_str("default-browser=nil"),
                Some(app_url) => match NSBundle::bundleWithURL(&app_url) {
                    None => diag.push_str("bundle=nil"),
                    Some(bundle) => match bundle.bundleIdentifier() {
                        None => diag.push_str("bundle-id=nil"),
                        Some(bundle_id) => {
                            let running = NSRunningApplication::runningApplicationsWithBundleIdentifier(&bundle_id);
                            diag.push_str(&format!(
                                "browser={bundle_id} instances={}",
                                running.len()
                            ));
                            for instance in running.iter() {
                                let activated = instance.activateWithOptions(
                                    NSApplicationActivationOptions::ActivateAllWindows,
                                );
                                diag.push_str(&format!(" activate={activated}"));
                            }
                        }
                    },
                },
            }
            Ok(diag)
        })();
        let _ = tx.send(result);
    })
    .map_err(|error| AppError::io(format!("主线程派发失败: {error}")))?;
    let result = rx.recv().map_err(|error| AppError::io(format!("主线程结果回传失败: {error}")))?;
    match &result {
        Ok(diag) => log_call(&log_url, &format!("ok diag:{diag}")),
        Err(error) => log_call(&log_url, &format!("fail:{}", error.message)),
    }
    result.map(|_| ())
}

#[cfg(target_os = "windows")]
fn open_url(url: &str, _app: tauri::AppHandle) -> Result<(), AppError> {
    let result = windows::open(url);
    match &result {
        Ok(()) => log_call(url, "ok ShellExecuteW"),
        Err(error) => log_call(url, &format!("fail:{}", error.message)),
    }
    result
}

#[cfg(target_os = "linux")]
fn open_url(url: &str, _app: tauri::AppHandle) -> Result<(), AppError> {
    use std::process::Command;
    let out = Command::new("xdg-open")
        .arg(url)
        .output()
        .map_err(|error| AppError::io(format!("执行 xdg-open 失败: {error}")))?;
    log_call(url, &format!("exit={:?}", out.status.code()));
    if out.status.success() {
        Ok(())
    } else {
        Err(AppError::io(format!("xdg-open 退出码 {:?}", out.status.code())))
    }
}
