//! 集成测试进程启动冒烟测试。

#[test]
fn test_helper_process_can_launch() {
    // `true` 只存在于 Unix，导致整个 Windows 测试套件无条件失败。复用当前测试
    // 可执行文件的 `--list` 模式，跨平台验证子进程创建与退出状态。
    let executable = std::env::current_exe().unwrap();
    let output = std::process::Command::new(executable)
        .arg("--list")
        .output()
        .unwrap();
    assert!(output.status.success());
}
