use super::contracts::SessionTokens;
use serde_json::Value;

impl SessionTokens {
    pub(super) fn codex(value: &Value) -> Self {
        Self {
            input: value["input_tokens"].as_u64(),
            cached_input: value["cached_input_tokens"].as_u64(),
            cache_write: value["cache_write_input_tokens"].as_u64(),
            output: value["output_tokens"].as_u64(),
        }
    }

    pub(super) fn claude(value: &Value) -> Self {
        Self {
            input: value["input_tokens"].as_u64(),
            cached_input: value["cache_read_input_tokens"].as_u64(),
            cache_write: value["cache_creation_input_tokens"].as_u64(),
            output: value["output_tokens"].as_u64(),
        }
    }

    pub(super) fn pi(value: &Value) -> Self {
        Self {
            input: value["input"].as_u64(),
            cached_input: value["cacheRead"].as_u64(),
            cache_write: value["cacheWrite"].as_u64(),
            output: value["output"].as_u64(),
        }
    }

    pub(super) fn maximum(&mut self, next: &Self) {
        self.input = self.input.max(next.input);
        self.cached_input = self.cached_input.max(next.cached_input);
        self.cache_write = self.cache_write.max(next.cache_write);
        self.output = self.output.max(next.output);
    }

    pub(super) fn sum<'a>(items: impl Iterator<Item = &'a Self>) -> Self {
        let mut items = items.peekable();
        if items.peek().is_none() {
            return Self::default();
        }
        items.fold(
            Self {
                input: Some(0),
                cached_input: Some(0),
                cache_write: Some(0),
                output: Some(0),
            },
            |sum, item| Self {
                input: add(sum.input, item.input),
                cached_input: add(sum.cached_input, item.cached_input),
                cache_write: add(sum.cache_write, item.cache_write),
                output: add(sum.output, item.output),
            },
        )
    }

    pub(super) fn normalized_codex(mut self) -> Self {
        self.input = self
            .input
            .zip(self.cached_input)
            .map(|(input, cached)| input.saturating_sub(cached));
        self
    }

    pub(super) fn reset_after(&self, previous: &Self) -> bool {
        decreases(self.input, previous.input) || decreases(self.output, previous.output)
    }
}

fn add(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    left.zip(right)
        .map(|(left, right)| left.saturating_add(right))
}

fn decreases(current: Option<u64>, previous: Option<u64>) -> bool {
    current
        .zip(previous)
        .is_some_and(|(current, previous)| current < previous)
}
