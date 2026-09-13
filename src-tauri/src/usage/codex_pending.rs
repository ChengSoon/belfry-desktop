use crate::usage::contracts::TokenTotals;

pub(super) struct PendingUsage {
    pub tokens: TokenTotals,
    pub model: Option<String>,
    pub cwd: Option<String>,
    pub at: Option<i64>,
}

impl PendingUsage {
    /// 输入未增加的流式快照先合并，缓存归类可能在输出流结束时才补齐。
    pub fn coalesces(&self, next: &Self) -> bool {
        self.model == next.model
            && self.cwd == next.cwd
            && self.tokens.input == next.tokens.input
            && self.tokens.cache_write == next.tokens.cache_write
            && self.tokens.output <= next.tokens.output
    }
}
