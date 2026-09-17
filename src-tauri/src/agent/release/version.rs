/// CLI 版本号的宽松解析与比较。
///
/// 和 `hooks::features` 里那个刻意严格的解析器不是一回事：那边判断「够不够 Hook 的
/// 最低版本」，多一段、带 prerelease 都宁可判否；这边只是「本地和 registry 谁新」，
/// 输入既可能是 package.json 里的干净 semver，也可能是 `--version` 的原始首行
/// （`"2.1.201 (Claude Code)"`、`"codex-cli 0.154.0"`），必须能从噪声里捞出三元组。
type Version = (u32, u32, u32);

/// 最长的数字段。`u32` 装得下 10 位，但版本号里出现 5 位以上就已经不正常了，
/// 截断在这里能顺手挡掉把时间戳当版本号的情况。
const MAX_PART_DIGITS: usize = 5;

pub(crate) fn parse(value: &str) -> Option<Version> {
    value.split_whitespace().find_map(parse_token)
}

fn parse_token(token: &str) -> Option<Version> {
    let mut parts = token.trim_start_matches('v').splitn(3, '.');
    let major = number(parts.next()?)?;
    let minor = number(parts.next()?)?;
    // 末段后面常挂着 `-beta.1`、`+build` 或者右括号，只认开头那串数字。
    let patch = number(leading_digits(parts.next()?))?;
    Some((major, minor, patch))
}

fn leading_digits(value: &str) -> &str {
    let end = value
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(value.len());
    &value[..end]
}

fn number(value: &str) -> Option<u32> {
    (!value.is_empty() && value.len() <= MAX_PART_DIGITS && value.bytes().all(|b| b.is_ascii_digit()))
        .then(|| value.parse().ok())
        .flatten()
}

/// `latest` 是否比 `current` 新。任一侧解析不出三元组就返回 `None`，
/// 调用方据此落到 `ReleaseState::Unknown`——宁可说「不知道」也不要误报可升级。
///
/// prerelease 后缀被丢掉了，所以 `1.2.3-beta` 与 `1.2.3` 会判定为同版本。
/// 这个方向是安全的：只会漏报，不会催用户去装一个其实更旧的包。
pub(crate) fn is_upgradable(current: &str, latest: &str) -> Option<bool> {
    Some(parse(latest)? > parse(current)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions_out_of_real_cli_output() {
        assert_eq!(parse("2.1.201 (Claude Code)"), Some((2, 1, 201)));
        assert_eq!(parse("codex-cli 0.154.0"), Some((0, 154, 0)));
        assert_eq!(parse("0.85.1"), Some((0, 85, 1)));
        assert_eq!(parse("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse("1.2.3-beta.1"), Some((1, 2, 3)));
        assert_eq!(parse("1.2.3+build.5"), Some((1, 2, 3)));
    }

    #[test]
    fn rejects_output_without_a_usable_triple() {
        assert_eq!(parse("custom-dev-build"), None);
        assert_eq!(parse("1.2"), None);
        assert_eq!(parse(""), None);
        // 6 位段大概率是时间戳而不是版本号，不要当成天文数字的新版本。
        assert_eq!(parse("0.1.2505172116"), None);
    }

    #[test]
    fn compares_only_when_both_sides_parse() {
        assert_eq!(is_upgradable("2.1.201", "2.1.263"), Some(true));
        assert_eq!(is_upgradable("0.154.0", "0.154.0"), Some(false));
        // 本地比 registry 还新（装了 next tag）也算不可升级。
        assert_eq!(is_upgradable("2.2.0", "2.1.263"), Some(false));
        assert_eq!(is_upgradable("custom-dev-build", "2.1.263"), None);
        assert_eq!(is_upgradable("2.1.201", "unreleased"), None);
    }
}
