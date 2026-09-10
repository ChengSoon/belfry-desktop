use serde_json::{Value, json};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

const TITLE_LIMIT: usize = 100;
const BODY_LIMIT: usize = 240;
static STATE: NotificationState = NotificationState {
    permission: Mutex::new("unknown"),
};

struct NotificationState {
    permission: Mutex<&'static str>,
}

impl Default for NotificationState {
    fn default() -> Self {
        Self {
            permission: Mutex::new("unknown"),
        }
    }
}

impl NotificationState {
    fn permission(&self) -> &'static str {
        self.permission
            .lock()
            .map(|value| *value)
            .unwrap_or("unknown")
    }

    fn record(&self, shown: bool) -> Value {
        let permission = if shown { "granted" } else { "denied" };
        if let Ok(mut current) = self.permission.lock() {
            *current = permission;
        }
        json!({"shown": shown, "permission": permission})
    }
}

pub fn dispatch(app: &AppHandle, api: &str, args: &Value) -> Result<Value, String> {
    if api == "ui.getNotificationPermission" {
        return Ok(json!(STATE.permission()));
    }
    if api == "ui.requestNotificationPermission" {
        let input = json!({"title":"Belfry 通知", "body":"应用原生通知已启用。"});
        return Ok(STATE.record(send(app, &input).is_ok())["permission"].clone());
    }
    let delivery = send(app, &args[0]);
    let result = STATE.record(delivery.is_ok());
    if api == "ui.notify" {
        return delivery.map(|_| Value::Null);
    }
    Ok(result)
}

fn text(value: &Value, limit: usize, fallback: &str) -> String {
    let text = value.as_str().unwrap_or("").trim();
    if text.is_empty() {
        fallback.into()
    } else {
        text.chars().take(limit).collect()
    }
}

fn send(app: &AppHandle, input: &Value) -> Result<(), String> {
    app.notification()
        .builder()
        .title(text(&input["title"], TITLE_LIMIT, "插件通知"))
        .body(text(&input["body"], BODY_LIMIT, ""))
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delivery_result_keeps_the_sdk_permission_and_query_consistent() {
        let state = NotificationState::default();
        assert_eq!("unknown", state.permission());
        assert_eq!(
            json!({"shown":true,"permission":"granted"}),
            state.record(true)
        );
        assert_eq!("granted", state.permission());
        assert_eq!(
            json!({"shown":false,"permission":"denied"}),
            state.record(false)
        );
        assert_eq!("denied", state.permission());
    }

    #[test]
    fn notification_text_is_bounded_without_splitting_unicode() {
        let original = json!("字".repeat(TITLE_LIMIT + 1));
        assert_eq!(
            "字".repeat(TITLE_LIMIT),
            text(&original, TITLE_LIMIT, "插件通知")
        );
        assert_eq!("插件通知", text(&json!("   "), TITLE_LIMIT, "插件通知"));
        assert_eq!("内容", text(&json!("  内容  "), BODY_LIMIT, ""));
    }
}
