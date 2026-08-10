use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rustc-check-cfg=cfg(otty_cross_check)");
    if std::env::var_os("OTTY_CROSS_CHECK").is_some() {
        println!("cargo:rustc-cfg=otty_cross_check");
        return;
    }
    stage_conpty();
    tauri_build::build()
}

/// 把架构对得上的那份 conpty 摆到 `Otty.exe` 旁边。
///
/// 为什么要摆：系统自带的 conhost 要 1.22 以上才会把 OSC 10/11 颜色查询透传出来，
/// 早于此的版本自己用 Campbell 黑作答，`terminal::osc` 的应答根本没机会被问到。
/// 细节见 `vendor/conpty/README.md`。
///
/// 两个落点各管一头：`vendor/conpty/active/` 给打包器（它只认配置里的静态路径），
/// target 目录给 `tauri dev`（跑的是 `target/<profile>/otty-desktop.exe`）。
///
/// 判平台只能读 `CARGO_CFG_*`：build.rs 自己是按宿主编的，`cfg!(target_os)` 在这里指的是宿主。
fn stage_conpty() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("x86_64") => "x64",
        Ok("aarch64") => "arm64",
        // 别的架构没有现成二进制。跳过即可：portable-pty 会回落到系统 conhost。
        _ => return,
    };
    let vendor = Path::new(env!("CARGO_MANIFEST_DIR")).join("vendor/conpty");
    println!("cargo:rerun-if-changed={}", vendor.join(arch).display());

    // OUT_DIR 形如 `target/<triple>/<profile>/build/<pkg>-<hash>/out`，上溯三层就是放可执行文件那层。
    let profile_dir = std::env::var_os("OUT_DIR")
        .map(PathBuf::from)
        .and_then(|out| out.ancestors().nth(3).map(Path::to_path_buf));

    let destinations = [Some(vendor.join("active")), profile_dir];
    for name in ["conpty.dll", "OpenConsole.exe"] {
        let from = vendor.join(arch).join(name);
        for to in destinations.iter().flatten() {
            // 拷不动不该拦下构建：少了这份 DLL 只是回落到系统 conhost。
            if std::fs::create_dir_all(to).is_ok() {
                let _ = std::fs::copy(&from, to.join(name));
            }
        }
    }
}
