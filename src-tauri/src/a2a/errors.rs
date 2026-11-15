use crate::terminal::AppError;

/// All messages are local constants. Native/HTTP errors may contain credentials.
pub(super) fn error(code: &str, message: &str) -> AppError {
    let mut value = AppError::invalid_argument(message);
    value.code.0 = code.to_owned().into();
    value.retryable = false;
    value
}

pub(super) fn storage() -> AppError {
    error(
        "A2A_STORAGE_UNAVAILABLE",
        "A2A secure storage is unavailable or damaged. Restore its original key and ciphertext; plaintext storage has not been used.",
    )
}

pub(super) fn invalid_response() -> AppError {
    error(
        "A2A_INVALID_RESPONSE",
        "The agent returned an invalid A2A 1.0 response.",
    )
}

pub(super) fn canceled() -> AppError {
    error(
        "A2A_REQUEST_CANCELED",
        "The local A2A request was canceled. This does not cancel a remote task.",
    )
}

pub(super) fn invalid_handle() -> AppError {
    error(
        "A2A_TASK_HANDLE_INVALID",
        "This task handle is unavailable for the current project, connection and agent session. Protocol handles do not survive an application restart; read the project task or task board to recover.",
    )
}
