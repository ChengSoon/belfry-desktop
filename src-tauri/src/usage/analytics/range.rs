use crate::usage::contracts::UsageQuery;

pub const DAY_SECONDS: i64 = 86_400;

#[derive(Clone, Copy, Debug)]
pub struct UsagePeriod {
    pub start: Option<i64>,
    pub end: i64,
}

impl UsagePeriod {
    pub fn new(query: &UsageQuery, now: i64) -> Result<Self, String> {
        let days = query.window_days.filter(|days| *days > 0);
        if days.is_some_and(|days| days != 7 && days != 30) {
            return Err("统计范围只支持近 7 天、近 30 天或全部".into());
        }
        let today = now.div_euclid(DAY_SECONDS) * DAY_SECONDS;
        Ok(Self {
            start: days.map(|days| today - (i64::from(days) - 1) * DAY_SECONDS),
            end: now.saturating_add(1),
        })
    }

    pub fn contains(self, timestamp: i64) -> bool {
        timestamp < self.end && self.start.is_none_or(|start| timestamp >= start)
    }
}
