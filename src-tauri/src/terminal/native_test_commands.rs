#[cfg(target_os = "macos")]
pub fn shell_marker_command() -> &'static str {
    "printf __BELFRY_OK__\r"
}

#[cfg(target_os = "macos")]
pub fn shell_exit_command() -> &'static str {
    "printf __BELFRY_EXIT__\rexit\r"
}

#[cfg(target_os = "macos")]
pub fn large_output_command() -> String {
    "printf __BELFRY_BEGIN__; python3 -c 'import sys;sys.stdout.write(\"0123456789abcdef\"*65536)'; printf __BELFRY_END__\r".to_string()
}

#[cfg(target_os = "macos")]
pub fn latency_command(marker: &str) -> String {
    format!("printf {marker}\r")
}

#[cfg(target_os = "macos")]
pub fn working_directory_command() -> &'static str {
    "pwd\r"
}

/// 发一条 OSC 11 查询，再把读回来的应答原样打出来。
///
/// 命令文本里不能出现裸 ESC：它会被 ZLE 回显，那样就分不清"回显"和"真应答"了，
/// 所以用 printf 的 `\033` 现场生成。`min 25` 正好是一条应答的长度。
#[cfg(target_os = "macos")]
pub fn color_query_command() -> &'static str {
    "stty -echo -icanon min 25 time 10; printf '\\033]11;?\\033\\\\'; \
     reply=$(dd bs=25 count=1 2>/dev/null); stty sane; \
     printf '__BELFRY_BG__%s__BELFRY_END__\\n' \"${reply#*rgb:}\"\r"
}

#[cfg(target_os = "windows")]
pub fn shell_marker_command() -> &'static str {
    "[Console]::Out.WriteLine('__BELFRY_OK__')\r"
}

#[cfg(target_os = "windows")]
pub fn shell_exit_command() -> &'static str {
    "[Console]::Out.WriteLine('__BELFRY_EXIT__'); exit\r"
}

#[cfg(target_os = "windows")]
pub fn large_output_command() -> String {
    "[Console]::Out.Write('__BELFRY_BEGIN__'); [Console]::Out.Write('0123456789abcdef' * 65536); [Console]::Out.Write('__BELFRY_END__')\r".to_string()
}

#[cfg(target_os = "windows")]
pub fn latency_command(marker: &str) -> String {
    format!("[Console]::Out.WriteLine('{marker}')\r")
}

#[cfg(target_os = "windows")]
pub fn working_directory_command() -> &'static str {
    "(Get-Location).Path\r"
}
