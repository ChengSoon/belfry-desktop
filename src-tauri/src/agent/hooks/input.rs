pub(super) use belfry_protocol::hooks::EVENTS;

#[cfg(test)]
pub(super) fn from_payload(payload: &[u8], occurred_at: i64) -> Option<super::contracts::HookInput> {
    belfry_protocol::hooks::from_value(&serde_json::from_slice(payload).ok()?, occurred_at)
}
