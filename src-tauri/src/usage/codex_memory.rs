use super::FileScan;
use crate::usage::analytics::memory::{optional_string, table_bytes};

impl FileScan<'_> {
    pub(crate) fn heap_bytes(&self) -> usize {
        optional_string(&self.model)
            + optional_string(&self.cwd)
            + table_bytes::<u64>(self.seen.capacity())
            + self.pending.as_ref().map_or(0, |item| {
                optional_string(&item.model) + optional_string(&item.cwd)
            })
            + self
                .quota
                .as_ref()
                .map_or(0, |quota| optional_string(&quota.plan_type))
    }
}
