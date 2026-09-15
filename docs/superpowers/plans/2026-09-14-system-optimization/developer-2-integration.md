# 开发2：根入口接线约定

状态：开发2实现及定向验证完成；已观察到项目经理在根入口注册下述命令。开发2未修改根入口。

## 唯一新增注册

在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler!` 中新增：

```rust
terminal::output_commands::terminal_ack_output,
```

不需要新增 managed state。命令使用既有 `TerminalRuntime`：

```rust
pub fn terminal_ack_output(
    runtime: State<'_, TerminalRuntime>,
    session_id: String,
    connection_id: String,
    delivery_id: u64,
) -> bool
```

前端参数为 `{ sessionId, connectionId, deliveryId }`。仅当前连接最早未确认的
批次可归还额度；未知会话、旧连接、重复确认、乱序确认返回 `false`，不改变额度。
前端在整个批次经过 xterm 解析完成回调后顺序确认，确认失败转入可重连错误态。

## 向后兼容扩展

- `terminal_create` 增加可选的 `flow_control: Option<bool>`（前端 `flowControl`）；
  新前端传 `true`，未提供的旧调用继续接受原事件，不要求发送确认。
- `TerminalEvent` 新增仅由宿主产生的 `output_batch`：
  `{ sessionId, connectionId, deliveryId, events }`，`events` 保持原事件格式与次序。
- daemon 的 `VERSION`、命令、回放游标和存档格式不变；批次封装只在宿主到 WebView 层。
- 每连接在途预算为 256 KiB（输出字节加事件记账开销），最多 4 批次；
  宿主另保留至多一个既有 Poll 页。前端顺序解析并合并连续小块。
- 消费确认超时为 30 秒；UI 关闭/重挂取消旧连接和待确认批次，关闭该连接的轮询 socket 并唤醒额度等待者；
  不结束 daemon PTY。超过原缓存上限仍转发可见 `replay_gap`。

## 整合验证

已运行前端 terminal/prompt 等 170 项回归、Rust terminal 92 项测试及生产构建。
`developer-2-result.md` 已记录实际命令、64 MiB 压力证据、队列预算边界及剩余限制。
项目经理可继续统一跨开发审查、全仓回归和平台验收。
