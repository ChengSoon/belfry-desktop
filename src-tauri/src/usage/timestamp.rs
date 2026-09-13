//! 把会话日志里的 RFC3339 时间戳转成 epoch 秒。
//!
//! 两家 Agent 的日志都写 UTC（`...Z`），但仍按显式偏移解析，避免以后换格式时静默算错。
//! 只为这一个函数引入 chrono 不划算，这里用 Howard Hinnant 的 days-from-civil 算法。

/// 解析 `YYYY-MM-DDTHH:MM:SS[.fff][Z|±HH:MM]`。无法解析时返回 None，调用方跳过该条记录。
pub fn parse_rfc3339(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || ![(4, b'-'), (7, b'-'), (10, b'T'), (13, b':'), (16, b':')]
            .iter()
            .all(|(index, separator)| bytes[*index] == *separator)
    {
        return None;
    }
    let year: i64 = number(value.get(0..4)?)?;
    let month: u32 = number(value.get(5..7)?)?;
    let day: u32 = number(value.get(8..10)?)?;
    let hour: i64 = number(value.get(11..13)?)?;
    let minute: i64 = number(value.get(14..16)?)?;
    let second: i64 = number(value.get(17..19)?)?;
    let valid_day = (1..=12).contains(&month) && (1..=month_days(year, month)).contains(&day);
    let valid_time = [(hour, 24), (minute, 60), (second, 60)]
        .iter()
        .all(|(value, limit)| (0..*limit).contains(value));
    if !valid_day || !valid_time {
        return None;
    }

    let days = days_from_civil(year, month, day);
    let base = days * 86_400 + hour * 3_600 + minute * 60 + second;
    Some(base - offset_seconds(&value[19..])?)
}

fn number<T: std::str::FromStr>(value: &str) -> Option<T> {
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit())
        .then(|| value.parse().ok())
        .flatten()
}

fn month_days(year: i64, month: u32) -> u32 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// 不猜测无效偏移；小数秒后必须有明确时区。
fn offset_seconds(rest: &str) -> Option<i64> {
    let rest = if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        &fraction[digits..]
    } else {
        rest
    };
    if rest == "Z" {
        return Some(0);
    }
    if rest.len() != 6 || rest.as_bytes()[3] != b':' {
        return None;
    }
    let sign = match rest.as_bytes().first() {
        Some(b'+') => 1,
        Some(b'-') => -1,
        _ => return None,
    };
    let hours: i64 = number(rest.get(1..3)?)?;
    let minutes: i64 = number(rest.get(4..6)?)?;
    if !(0..=23).contains(&hours) || !(0..=59).contains(&minutes) {
        return None;
    }
    Some(sign * (hours * 3_600 + minutes * 60))
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
