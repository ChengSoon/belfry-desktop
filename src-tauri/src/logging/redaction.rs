//! 日志和导出共用脱敏，绝不读取环境变量或 Provider 密钥库。
use regex::Regex;
use std::sync::LazyLock;

static RULES: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    [
        (r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", "[REDACTED PRIVATE KEY]"),
        (r"(?i)\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+", "[REDACTED AUTH]"),
        (r"(?i)(https?://)[^/\s:@]+:[^/\s@]+@", "${1}[REDACTED]@"),
        (r#"(?i)(\b[a-z0-9_.-]*(?:api[_-]?key|token|password|passwd|secret|credential|authorization|cookie)[a-z0-9_.-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}\]]+)"#, "${1}[REDACTED]"),
        (r"\b(?:sk-[A-Za-z0-9_-]{6,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)", "[REDACTED TOKEN]"),
    ].into_iter().map(|(pattern, replacement)| (Regex::new(pattern).expect("static log redaction regex"), replacement)).collect()
});

pub(super) fn secret_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "token",
        "key",
        "secret",
        "password",
        "passwd",
        "authorization",
        "cookie",
        "credential",
    ]
    .iter()
    .any(|part| key.contains(part))
}

pub(super) fn redact(text: &str) -> String {
    RULES
        .iter()
        .fold(text.to_owned(), |value, (rule, replacement)| {
            rule.replace_all(&value, *replacement).into_owned()
        })
}

pub(super) fn bounded(text: &str, bytes: usize) -> &str {
    let mut end = bytes.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}
