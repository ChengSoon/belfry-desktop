//! Scrub known credential text from public copies, after protocol validation.
//! Routing and task ownership continue to use the original, private values.
use serde_json::Value;

use super::{contracts::Discovery, store::Resolved};

pub(super) fn value(mut value: Value, connection: &Resolved) -> Value {
    if let Some(secret) = connection.secret.as_deref() {
        scrub(&mut value, secret);
    }
    value
}

pub(super) fn discovery(mut result: Discovery, connection: &Resolved) -> Discovery {
    if let Some(secret) = connection.secret.as_deref() {
        scrub(&mut result.card, secret);
        for interface in result
            .interfaces
            .iter_mut()
            .chain(result.selected_interface.iter_mut())
        {
            interface.url = interface.url.replace(secret, "[redacted]");
            if let Some(tenant) = &mut interface.tenant {
                *tenant = tenant.replace(secret, "[redacted]");
            }
        }
    }
    result
}

fn scrub(value: &mut Value, secret: &str) {
    match value {
        Value::String(text) => *text = text.replace(secret, "[redacted]"),
        Value::Array(items) => {
            for item in items {
                scrub(item, secret);
            }
        }
        Value::Object(object) => {
            // Remote metadata keys can reflect credentials too. Rebuild the public
            // object only; any collisions after redaction disclose no secret text.
            *object = std::mem::take(object)
                .into_iter()
                .map(|(key, mut item)| {
                    scrub(&mut item, secret);
                    (key.replace(secret, "[redacted]"), item)
                })
                .collect();
        }
        _ => {}
    }
}
