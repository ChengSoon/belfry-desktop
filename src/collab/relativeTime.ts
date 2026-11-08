import { formatDateTime, t } from "../i18n";
/**
 * 任务时间的显示规则。
 *
 * `now` 由调用方传进来而不是在函数里取：这样测试不用打桩时钟，也让同一次渲染里
 * 所有事件共用一个「现在」，不会出现同批任务算出的相对时长互相错开一秒。
 *
 * 分档不按分组分叉逻辑，自然就分好工了——刚派出去的活落在时长档
 * （「刚刚 / N 分钟前 / N 小时前」，回答"跑了多久"），已结的老活落到时刻档
 * （回答"什么时候派的"）。
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/* 相对时长和绝对时刻的分界。
   之所以不在 1 小时就切到时刻，是因为跨天发生在凌晨，而凌晨恰是这工具的高峰时段之一：
   01:24 看一条 3 小时前派出的活，落到时刻档就成了「昨天 22:24」——语义没错，
   读起来却像隔了很久。6 小时内一律报时长，凌晨那几个钟头就不会被日历日切开。 */
const CLOCK_AFTER = 6 * HOUR;

/**
 * @param createdAt **毫秒** epoch。真源是 `src-tauri/src/collab/server.rs` 的
 *   `now_millis()`（`as_millis() as i64`），不是秒。
 * @param now 同为毫秒 epoch。
 */
export function formatTaskTime(createdAt: number, now: number): string {
  const elapsed = now - createdAt;
  // 负数（两端时钟对不齐）也落这一档，比显示「-3 分钟前」体面。
  if (elapsed < MINUTE) return t("collab.relativeTime.text_de6785d99e");
  if (elapsed < HOUR) return t("collab.relativeTime.text_42ccefec3a", { count: Math.floor(elapsed / MINUTE) });
  if (elapsed < CLOCK_AFTER) return t("collab.relativeTime.text_f28443d2da", { count: Math.floor(elapsed / HOUR) });

  const at = new Date(createdAt);
  const clock = formatDateTime(at, { hour: "2-digit", minute: "2-digit", hour12: false });
  const today = dayStart(now);
  const day = dayStart(createdAt);
  if (day === today) return clock;
  // today - 1 是昨天的 23:59:59.999，再取一次日初；这么绕是为了跨夏令时也对，
  // 直接减 86400000 在切换日会差一小时。
  if (day === dayStart(today - 1)) return t("collab.relativeTime.text_df77e9bfce", { clock: clock });
  return formatDateTime(at, { month: "short", day: "numeric", ...(at.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }) });
}

/**
 * hover 时看准用的完整时间戳。
 *
 * 注意这是**创建时刻**——`TaskView` 里没有 `completedAt`，已结的任务也只能显示
 * 它是什么时候被派出去的，别在文案里写成「完成于」。
 */
export function formatTaskTimestamp(createdAt: number): string {
  return formatDateTime(createdAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function dayStart(time: number): number {
  const at = new Date(time);
  at.setHours(0, 0, 0, 0);
  return at.getTime();
}
