use serde_json::Value;

// 与 node/engine-version.mjs 的移植目标保持一致。
const CURRENT: [u32; 3] = [0, 14, 6];
pub(super) fn validate(value: Option<&Value>) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    let object = value.as_object().ok_or("engines 必须为对象")?;
    if object.keys().any(|key| key != "piDesktop") {
        return Err("engines 字段无效".into());
    }
    let Some(range) = object.get("piDesktop") else {
        return Ok(());
    };
    let range = range
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 128)
        .ok_or("PI engine 版本范围无效")?;
    let mut matched = false;
    for group in range.split("||") {
        let mut all = !group.trim().is_empty();
        for token in group.split_whitespace() {
            all &= matches(token)?;
        }
        matched |= all;
    }
    if matched {
        Ok(())
    } else {
        Err(format!("插件需要 PI API {range}，当前兼容版本为 0.14.6"))
    }
}
fn matches(token: &str) -> Result<bool, String> {
    let operator = [">=", "<=", ">", "<", "=", "^", "~"]
        .into_iter()
        .find(|op| token.starts_with(op))
        .unwrap_or("");
    let source = token[operator.len()..].trim_start_matches('v');
    let parts = source.split('.').collect::<Vec<_>>();
    if parts.is_empty() || parts.len() > 3 {
        return Err("PI engine 版本格式无效".into());
    }
    let wildcard = parts.iter().any(|part| ["x", "X", "*"].contains(part));
    if wildcard && !["", "="].contains(&operator) {
        return Err("通配版本不能使用比较运算符".into());
    }
    let version = parse_parts(&parts)?;
    if wildcard || ["", "="].contains(&operator) && parts.len() < 3 {
        return Ok(parts
            .iter()
            .enumerate()
            .all(|(i, part)| ["x", "X", "*"].contains(part) || version[i] == CURRENT[i]));
    }
    compare(operator, version, parts.len())
}
fn parse_parts(parts: &[&str]) -> Result<[u32; 3], String> {
    let mut version = [0_u32; 3];
    for (index, part) in parts.iter().enumerate() {
        if ["x", "X", "*"].contains(part) {
            continue;
        }
        if part.is_empty()
            || part.len() > 1 && part.starts_with('0')
            || !part.bytes().all(|b| b.is_ascii_digit())
        {
            return Err("PI engine 版本无效".into());
        }
        version[index] = u32::from(part.parse::<u16>().map_err(|_| "PI engine 版本超额")?);
    }
    Ok(version)
}
fn compare(operator: &str, version: [u32; 3], components: usize) -> Result<bool, String> {
    let result = match operator {
        "" | "=" => CURRENT == version,
        ">=" => CURRENT >= version,
        ">" => CURRENT > version,
        "<=" => CURRENT <= version,
        "<" => CURRENT < version,
        "^" => {
            let slot = version.iter().position(|part| *part != 0).unwrap_or(2);
            let mut upper = version;
            upper[slot] += 1;
            upper[slot + 1..].fill(0);
            CURRENT >= version && CURRENT < upper
        }
        "~" => {
            let upper = if components == 1 {
                [version[0] + 1, 0, 0]
            } else {
                [version[0], version[1] + 1, 0]
            };
            CURRENT >= version && CURRENT < upper
        }
        _ => return Err("PI engine 版本范围不受支持".into()),
    };
    Ok(result)
}
