# 开发1：根入口接线（已实现并核验）

仅由项目经理修改 `src-tauri/src/lib.rs`：

```rust
// Builder state 注册；与现有 SessionStatisticsState 并列。
.manage(usage::analytics::UsageAnalyticsState::default())

// generate_handler! 保留现有 usage_analytics，再加入：
usage::analytics::commands::usage_cancel_analytics,
```

- 完整 state 类型：`crate::usage::analytics::UsageAnalyticsState`，实现 `Default`。
- 现有查询 command：`crate::usage::analytics::commands::usage_analytics`。
  IPC 参数 `{ query: UsageQuery, requestId?: string | null }`；`query` 字段不变。
  Rust 注入 `tauri::State<'_, UsageAnalyticsState>`，`request_id: Option<String>`。
  未传 ID 的旧调用仍可执行，后端生成唯一 ID；新前端为每个请求生成 UUID。
- 新取消 command：`crate::usage::analytics::commands::usage_cancel_analytics`。
  IPC 参数 `{ requestId: string }`，返回 `Result<(), String>`。
  同查询共享扫描，取消只移除该 ID 的消费者；最后一位消费者离开才取消后台工作。
  查询完成或 Rust 查询 future 被丢弃时释放消费者；面板卸载通过取消 IPC 释放消费者。
  提前到达的取消暂存为最多 256 个、30 秒过期的标记。
- 查询的原有 report 字段语义不变；新增 `diagnostics` 提供读取字节、解析行、缓存命中、
  追加文件和无效行计数。前端兼容没有该字段的旧报告。
- 所有扫描与等候缓存锁的阶段都检查共享取消状态；只有完整扫描可提交缓存快照。
- 当前无需依赖、锁文件、持久化、schema 或其他目录接线。

已只读核验共享分支的 `lib.rs` 包含上述 state 与两个 command；本任务未编辑根入口。
已核验 `AppOverlays` 在面板关闭时卸载 `UsagePanel`，`useUsageInsights` 的 effect cleanup
调用请求取消；刷新、窗口或项目变更同样取消旧请求。

完成结果、定向测试和性能证据见 [developer-1-result.md](developer-1-result.md)。
