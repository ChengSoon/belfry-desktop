#[cfg(target_os = "macos")]
pub fn shell_marker_command() -> &'static str {
    "printf __OTTY_OK__\r"
}

#[cfg(target_os = "macos")]
pub fn shell_exit_command() -> &'static str {
    "printf __OTTY_EXIT__\rexit\r"
}

#[cfg(target_os = "macos")]
pub fn large_output_command() -> String {
    "printf __OTTY_BEGIN__; python3 -c 'import sys;sys.stdout.write(\"0123456789abcdef\"*65536)'; printf __OTTY_END__\r".to_string()
}

#[cfg(target_os = "macos")]
pub fn latency_command(marker: &str) -> String {
    format!("printf {marker}\r")
}

#[cfg(target_os = "macos")]
pub fn working_directory_command() -> &'static str {
    "pwd\r"
}

#[cfg(target_os = "windows")]
pub fn shell_marker_command() -> &'static str {
    "Write-Output __OTTY_OK__\r"
}

#[cfg(target_os = "windows")]
pub fn shell_exit_command() -> &'static str {
    "Write-Output __OTTY_EXIT__\rexit\r"
}

#[cfg(target_os = "windows")]
pub fn large_output_command() -> String {
    "[Console]::Out.Write('__OTTY_BEGIN__'); [Console]::Out.Write('0123456789abcdef' * 65536); [Console]::Out.Write('__OTTY_END__')\r".to_string()
}

#[cfg(target_os = "windows")]
pub fn latency_command(marker: &str) -> String {
    format!("Write-Output {marker}\r")
}

#[cfg(target_os = "windows")]
pub fn working_directory_command() -> &'static str {
    "(Get-Location).Path\r"
}
