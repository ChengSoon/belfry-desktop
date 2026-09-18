use std::io::Write;

pub mod commands {
    use super::open_url;
    use tauri::command;

    /// 打开外部 http/https 链接。
    ///
    /// 走系统原生方式，同步等待结果并把错误回报给前端。
    /// tauri-plugin-opener 的 detached 模式「派发即返回成功」，
    /// 真正打开失败时前端看不到错误。
    #[command]
    pub fn open_external(url: String, app: tauri::AppHandle) -> Result<(), String> {
        // arg() 不经 shell，无注入风险；这里只做业务约束，只允许网页协议。
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(format!("仅支持 http/https 链接: {url}"));
        }
        open_url(&url, app)
    }
}

/// 把每次调用落到临时日志，便于诊断「点了没反应」这类问题。
fn log_call(url: &str, outcome: &str) {
    let path = std::env::temp_dir().join("belfry-openexternal.log");
    let body = format!(
        "[epoch {}] pid={} outcome={outcome} url={url}\n",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        std::process::id(),
    );
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(body.as_bytes());
    }
}

/// macOS：在主线程用 NSWorkspace 打开 URL，并强制激活默认浏览器到前台。
///
/// `open` 命令和 NSWorkspace 的简易 openURL: 对**已在运行**的浏览器只投递
/// URL、不激活窗口，用户盯着本应用以为「没反应」。这里打开 URL 后再查默认
/// 浏览器的运行实例，用 activateWithOptions 强制切到前台。
#[cfg(target_os = "macos")]
fn open_url(url: &str, app: tauri::AppHandle) -> Result<(), String> {
    let url = url.to_string();
    let log_url = url.clone();
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<String, String> {
            use objc2_app_kit::{
                NSApplicationActivationOptions, NSRunningApplication, NSWorkspace,
                NSWorkspaceOpenConfiguration,
            };
            use objc2_foundation::{NSBundle, NSString, NSURL};
            // URLWithString: 是类方法，直接构造，不用先 alloc。
            let nsurl = NSURL::URLWithString(&NSString::from_str(&url))
                .ok_or_else(|| format!("无法构造 URL: {url}"))?;
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
    .map_err(|error| format!("主线程派发失败: {error}"))?;
    let result = rx.recv().map_err(|error| format!("主线程结果回传失败: {error}"))?;
    match &result {
        Ok(diag) => log_call(&log_url, &format!("ok diag:{diag}")),
        Err(msg) => log_call(&log_url, &format!("fail:{msg}")),
    }
    result.map(|_| ())
}

#[cfg(target_os = "windows")]
fn open_url(url: &str, _app: tauri::AppHandle) -> Result<(), String> {
    use std::process::Command;
    // start 后第一组引号是窗口标题（空），URL 包引号避免 & 等字符被 cmd 截断。
    let quoted = format!("\"{url}\"");
    let out = Command::new("cmd")
        .args(["/C", "start", ""])
        .arg(&quoted)
        .output()
        .map_err(|error| format!("执行 start 失败: {error}"))?;
    log_call(url, &format!("exit={:?}", out.status.code()));
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("start 退出码 {:?}", out.status.code()))
    }
}

#[cfg(target_os = "linux")]
fn open_url(url: &str, _app: tauri::AppHandle) -> Result<(), String> {
    use std::process::Command;
    let out = Command::new("xdg-open")
        .arg(url)
        .output()
        .map_err(|error| format!("执行 xdg-open 失败: {error}"))?;
    log_call(url, &format!("exit={:?}", out.status.code()));
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("xdg-open 退出码 {:?}", out.status.code()))
    }
}
