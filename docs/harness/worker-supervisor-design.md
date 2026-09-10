# Harness H0.5：Worker 子进程监督器设计

日期：2026-09-07。状态：下一阶段执行基线。

## 目标

把现有内存 `WorkerTransport` 原型推进为真实、可测试的外部 Worker 边界：Belfry 启动一个
JSON-RPC over stdio 子进程，逐行接收结构化消息，能够取消、关闭并在崩溃或协议违规时可靠收敛。
本阶段验证进程隔离和协议传输，不接真实模型、工具、项目写入、凭证或产品 UI。

## 设计决策

- Rust/Tauri 是唯一进程 owner；WebView 不直接启动或持有 Worker。
- 每个 Worker 实例使用不可复用的 `workerId`，每个会话仍使用独立 `sessionId`。
- stdin/stdout 仅传 UTF-8 NDJSON。stderr 作为有界诊断流，不解析为协议事件。
- 单行上限 1 MiB；未换行缓冲超过上限、非法 UTF-8、非法 JSON 或不符合 RPC/event 外形时，
  立即把 Worker 标为 protocol-failed 并终止，不能继续猜测后续边界。
- 出站写入按 Worker 串行；请求 ID 由宿主生成，响应、事件以 request/session/sequence 关联。
- Worker 退出必须区分：正常 shutdown、用户 cancel 后退出、意外 exit、协议失败、强制终止。
- shutdown 先发送 RPC，等待最多 2 秒；未退出则 kill，再 wait/reap。应用退出也走同一收尾。
- 本阶段不允许任意 manifest command。开发测试只启动仓库内假 Worker；生产安装与信任链留到后续。
- Worker 环境采用显式 allowlist，首期假 Worker不需要注入任何凭证或 Provider 配置。

## 最小接口

Rust 命令建议保持窄边界，具体命名可按仓库惯例调整：

- `harness_worker_start(entry, args) -> workerId`
- `harness_worker_send(workerId, request)`
- `harness_worker_stop(workerId)`

Rust 向前端发单一事件通道，负载为 `workerId + message` 或 `workerId + lifecycle/error`。
不得把 `Child`、原始文件描述符或 shell 字符串暴露给前端。`entry + args` 必须使用 executable/argv，
不能经 shell 拼接。开始实现前若命令注册需要修改 `src-tauri/src/lib.rs`，只做最小接线。

前端新增 Tauri transport adapter，实现现有 `WorkerTransport` 的发送/关闭语义；Supervisor 需要补齐：

- 每个 session 独立校验单调 sequence，不能用一个全局 sequence 让不同 session 相互丢事件；
- pending 请求保存 method/session，并在 close/crash 时全部清理 timer、生成确定失败；
- 未知 response ID、重复 response、错误 session、非法 event 不得静默当成功；
- request ID 改为可注入生成器，测试不得依赖时间和随机数；
- `close()` 幂等，关闭后拒绝新请求。

## 文件边界

允许新增：`src-tauri/src/harness/**`、`src/harness/**` 测试与 transport adapter、
`scripts/harness/**` 故障型假 Worker、`docs/harness/implementation.md` 实施证据。
允许最小修改：`src-tauri/src/lib.rs`（模块、state、命令和退出收尾注册）。

不要继续扩展 legacy `src/plugins/**`、`src-tauri/src/plugins/**`；不要修改 Prompt Queue、Recipe、
AgentKind、Provider、协作协议、根依赖/配置、CI、数据库或 Git 历史。若 Tauri 事件能力或退出钩子
确实需要超出上述边界，停止并通过 Belfry 回报具体文件、原因和最小替代方案。

## 验收标准

1. 正常启动假 Worker，完成 initialize、session/start、tool/request、shutdown 往返并收到有序事件。
2. stdout 分块、一次多行和 CRLF 均正确拆帧；stderr 不污染协议。
3. 非法 JSON、非法 UTF-8、超长行、合法 JSON 但非法 envelope 都转为明确 protocol failure。
4. Worker 非零退出转为结构化失败；Belfry 测试进程继续运行。
5. shutdown 超时会强制终止并 wait/reap；重复 stop 不报错；测试结束无遗留假 Worker。
6. 两个 session 都可从 sequence 1 开始且互不丢事件；重复/倒退 sequence 仅影响对应 session。
7. crash/close 会清空全部 pending timer，每个未决请求只失败一次；之后拒绝发送。
8. executable 与 argv 不经 shell；测试证明含空格参数保持单一 argv，未注入敏感环境变量。
9. Rust 单测覆盖 framing、生命周期、退出分类和 cleanup；TS 单测覆盖 transport/Supervisor 状态。
10. 定向测试、`pnpm test`、`pnpm build`、`cargo test` 的命令、退出码与关键结果写入实施记录。

Windows 真实进程冒烟若当前无环境，必须标为未验证；不能用 macOS 单测替代。不得声称 H1 完成。

## 实施顺序

1. 先补 TS Supervisor 失败测试并修正 session sequence、pending cleanup 和确定性 ID。
2. 在 Rust 写独立 NDJSON framer 与进程状态单测，再实现 Worker manager。
3. 注册最小 Tauri 命令/事件桥，并实现前端 transport adapter。
4. 扩充假 Worker故障模式，完成契约与清理集成测试。
5. 运行完整门禁、自审并更新 `docs/harness/implementation.md`。
