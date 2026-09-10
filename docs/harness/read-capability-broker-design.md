# Harness H1.1：只读 Capability Broker

日期：2026-09-07。状态：执行基线。

## 目标与边界

在 H0.5 Worker 传输之上实现宿主控制的只读项目工具：`project.list` 与 `project.read`。
Worker 只能提出 `tool/request`，宿主校验会话、声明、授权、参数和路径后执行，并把结果/错误作为
RPC 返回，同时产生可追溯事件。本阶段不实现写文件、命令、模型、凭证、网络、UI 或持久授权。

## 不变量

- session 创建时固定 `workerId`、规范化项目根、Harness ID/version、声明能力和临时授权快照。
- 权限判断顺序：会话有效 → Worker 匹配 → 工具已声明 → capability 已授权 → 参数校验 → 执行。
- 授权是宿主内存事实；撤权同步生效，已排队但尚未执行的请求也必须重新检查。
- Worker 永远不接收项目根绝对路径；请求只含规范相对路径，结果只返回相对路径。
- 拒绝绝对路径、`..`、NUL、Windows prefix、symlink 越界；执行前后都校验规范根约束。
- list 最多 1000 项；read 最多 512 KiB，二进制只返回元数据，不返回原始字节。
- 每个 tool request 产生 requested，随后恰好一个 completed 或 failed；含 session/request/tool ID、耗时和有限摘要。
- 错误码稳定区分 SESSION_NOT_FOUND、WORKER_MISMATCH、TOOL_UNDECLARED、CAPABILITY_DENIED、
  INVALID_PARAMS、PATH_OUTSIDE_ROOT、NOT_FOUND、TOO_LARGE、IO_ERROR；不泄露无关绝对路径。
- 每 session 同时最多 8 个只读调用，超出返回 BUSY；取消后的新调用返回 SESSION_CANCELLED。

## 实现建议

新增 Rust `src-tauri/src/harness/broker/**`，复用或提取 `project/files.rs` 的安全路径解析与读取规则，
不要复制一套行为漂移的路径校验。共享抽取只限项目资源安全帮助函数及其测试。
扩展 Harness runtime 保存 session registry，并新增窄 Tauri 命令用于注册测试会话、更新临时授权和处理
tool request；产品 UI 接线留后续。TS 扩展协议类型、broker client/事件归一化和契约测试。

保持所有文件 ≤300 行、函数 ≤50 行。允许最小修改 `src-tauri/src/project/**`、
`src-tauri/src/harness/**`、`src/harness/**`、`scripts/harness/**`、`src-tauri/src/lib.rs` 和实施文档。
不改 legacy plugins、Provider、Prompt/Recipe、AgentKind、协作协议、依赖、CI、数据库或 Git 历史。

## 验收

1. 已声明且授权的 list/read 返回有界结果和 requested/completed 事件。
2. 未声明、未授权及撤权后的下一调用明确拒绝且不访问文件。
3. Worker/session 不匹配、未知 session、取消 session 均拒绝。
4. `..`、绝对路径、Windows prefix、NUL、symlink 越界均有测试；错误不泄露外部绝对路径。
5. 二进制、超限文件、UTF-8 截断边界、缺失文件和目录误读有确定语义。
6. 同一 request/tool ID 只终结一次；并发上限和取消竞态有测试。
7. 普通 project preview 行为保持不变，现有 project 测试通过。
8. 假 Worker可发真实 tool/request 并收到 broker 结果，但不能绕过 broker 直接读文件。
9. 定向、全量前端、build、cargo test 全部记录真实退出码；无 Worker 遗留。
10. 更新 `docs/harness/implementation.md`，明确 H1 仍未完成及 Windows/桌面未验证项。
