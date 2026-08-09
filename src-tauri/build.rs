fn main() {
    println!("cargo:rustc-check-cfg=cfg(otty_cross_check)");
    if std::env::var_os("OTTY_CROSS_CHECK").is_some() {
        println!("cargo:rustc-cfg=otty_cross_check");
        return;
    }
    tauri_build::build()
}
