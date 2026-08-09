//! 把会话日志里的 RFC3339 时间戳转成 epoch 秒。
//!
//! 两家 Agent 的日志都写 UTC（`...Z`），但仍按显式偏移解析，避免以后换格式时静默算错。
//! 只为这一个函数引入 chrono 不划算，这里用 Howard Hinnant 的 days-from-civil 算法。

/// 解析 `YYYY-MM-DDTHH:MM:SS[.fff][Z|±HH:MM]`。无法解析时返回 None，调用方跳过该条记录。
pub fn parse_rfc3339(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 19 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year: i64 = value.get(0..4)?.parse().ok()?;
    let month: u32 = value.get(5..7)?.parse().ok()?;
    let day: u32 = value.get(8..10)?.parse().ok()?;
    let hour: i64 = value.get(11..13)?.parse().ok()?;
    let minute: i64 = value.get(14..16)?.parse().ok()?;
    let second: i64 = value.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let days = days_from_civil(year, month, day);
    let base = days * 86_400 + hour * 3_600 + minute * 60 + second;
    Some(base - offset_seconds(&value[19..]))
}

/// 时区偏移；无后缀或 `Z` 视为 UTC。
fn offset_seconds(rest: &str) -> i64 {
    let rest = rest.trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    let sign = match rest.as_bytes().first() {
        Some(b'+') => 1,
        Some(b'-') => -1,
        _ => return 0,
    };
    let hours: i64 = rest.get(1..3).and_then(|v| v.parse().ok()).unwrap_or(0);
    let minutes: i64 = rest.get(4..6).and_then(|v| v.parse().ok()).unwrap_or(0);
    sign * (hours * 3_600 + minutes * 60)
}

/// 1970-01-01 起的天数，对 1970 年前为负。
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month = i64::from(month);
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + i64::from(day) - 1;
    let doe = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn now_epoch_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_utc_timestamps_from_both_agent_logs() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        // Claude 侧样本
        assert_eq!(parse_rfc3339("2026-07-18T13:11:46.612Z"), Some(1784380306));
        // Codex 侧样本
        assert_eq!(parse_rfc3339("2026-08-09T14:56:41.360Z"), Some(1786287401));
    }

    #[test]
    fn applies_explicit_timezone_offsets() {
        let utc = parse_rfc3339("2026-08-09T14:56:41Z").unwrap();
        assert_eq!(parse_rfc3339("2026-08-09T22:56:41+08:00"), Some(utc));
        assert_eq!(parse_rfc3339("2026-08-09T06:56:41-08:00"), Some(utc));
    }

    #[test]
    fn handles_leap_days_and_epoch_boundaries() {
        assert_eq!(parse_rfc3339("2024-02-29T00:00:00Z"), Some(1709164800));
        assert_eq!(parse_rfc3339("2000-02-29T00:00:00Z"), Some(951782400));
        assert_eq!(parse_rfc3339("1969-12-31T23:59:59Z"), Some(-1));
    }

    #[test]
    fn rejects_malformed_values_instead_of_guessing() {
        assert_eq!(parse_rfc3339(""), None);
        assert_eq!(parse_rfc3339("not-a-date"), None);
        assert_eq!(parse_rfc3339("2026-08-09"), None);
        assert_eq!(parse_rfc3339("2026-13-09T00:00:00Z"), None);
    }
}
