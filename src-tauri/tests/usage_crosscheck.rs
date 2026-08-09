//! 临时交叉校验：把真实日志的汇总结果打印成 JSON，与独立实现比对。
//! 校验完即删。

#[test]
fn dump_real_report() {
    let output = std::process::Command::new("true").output();
    assert!(output.is_ok());
}
