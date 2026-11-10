use std::path::Path;

use crate::terminal::AppError;

pub(super) fn normalize(value: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::invalid_argument(belfry_i18n::text("请输入模型标识，或选择沿用默认")));
    }
    if value.chars().count() > 256 || value.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AppError::invalid_argument(belfry_i18n::text("模型标识最多 256 个字符，不能包含空白或控制字符")));
    }
    Ok(Some(value.to_string()))
}

pub(super) fn same_project(left: &str, right: &str) -> bool {
    if left == right { return true; }
    match (
        crate::resource::canonicalize(Path::new(left)),
        crate::resource::canonicalize(Path::new(right)),
    ) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

pub(super) fn shared_session_error() -> AppError {
    AppError::invalid_argument(belfry_i18n::text("这条会话被多个角色共用。请先绑定独立会话，再指定角色模型"))
}
