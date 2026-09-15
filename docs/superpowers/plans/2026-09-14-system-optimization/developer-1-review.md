开发1交叉审查：用量交付一致性与终端流控

任务：`wtneqrxe`。日期：2026-09-15。使用技能：`belfry`。
审查基线：共享分支 `feat/multi-agent-collab`，HEAD `439302a69286b6ff96dbc780433e6491b5a838ea`，
包含当时工作区内终端的已跟踪差异及新增文件；不是只审查 HEAD 中已提交代码。
本任务仅写本文件，未编辑产品代码、依赖、锁文件或根入口，未提交、推送。

**结论**

`developer-1-result.md` 对当前 usage 实现的描述一致；两份性能原始输出与结果文档中的数字相符。
在本次读取的终端最终差异及关联调用链中，未发现可确定、需开发2修复的新增缺陷，确定问题数为 **0**。
这是静态交叉审查结论，不代表已完成统一回归或完整 PTY→Tauri→WebView 验收。

**usage 交付一致性**

- 缓存预算与大日志回退相符：`src-tauri/src/usage/analytics/cache.rs:16` 保留总缓存
  64 MiB/4096 项，`src-tauri/src/usage/analytics/reader.rs:15` 的单文件索引预算仍为 16 MiB；
  `src-tauri/src/usage/analytics/cache.rs:141` 将索引容量不足转为 `ScanFile::Streaming`，
  不是直接拒绝整个查询。热命中、缓存准入预算及追加校验分别见该文件第 92、119、187 行。
- 快照与统计口径相符：`src-tauri/src/usage/analytics/snapshot.rs:62` 用同一文件句柄和捕获的 EOF
  流式重放，完成后校验快照；第 87 行从同一快照探测 Codex 前八行身份。
  第 48 行将流式途中读取/快照错误上抛，避免返回已经累计的半个文件。
  `src-tauri/src/usage/analytics/service.rs:44` 暂存更新，仅在完整报告成功且取消检查通过后提交。
- 查询预算口径相符：`src-tauri/src/usage/analytics/replay.rs:69` 按记录更新实际保留状态，
  第 111 行在 pending flush 后继续检查，第 130 行统计容器及字符串保留量。
  配套计量见 `src-tauri/src/usage/analytics/memory.rs:5`、`src-tauri/src/usage/codex_memory.rs:5`。
  当前没有以累计处理字节数或记录总数拒绝重复日志的旧限制；64 MiB 仍是保留状态的估算预算，
  不是整个进程 RSS 上限。
- 并发与取消描述相符：`src-tauri/src/usage/analytics/registry.rs:11` 的消费者/worker/取消标记上限，
  `src-tauri/src/usage/analytics/jobs.rs:64` 的最后消费者取消，
  `src-tauri/src/usage/analytics/state.rs:66` 的可取消缓存锁等待，
  以及 `src/usage/insights/requests.ts:13`、`src/usage/insights/useUsageInsights.ts:15`
  的请求替换/卸载取消均已接入。
- 追加回归覆盖与文档对应：`src-tauri/src/usage/analytics/budget_tests.rs:16` 覆盖小预算冷/热/追加，
  第 39、91 行覆盖重复记录与上下文替换的状态计量；
  `src-tauri/src/usage/analytics/stream_tests.rs:14` 覆盖 EOF，第 43、83、117 行覆盖取消及文件替换；
  `src-tauri/src/usage/analytics/stream_semantics_tests.rs:6` 覆盖过滤、resume、额度、修正与末行。

已回读 `developer-1-performance.txt` 和 `developer-1-streaming-performance.txt`：
常规语料 247 文件/66,383,801 B，reference/cold/hot/append 分别为
608.678/501.619/15.189/12.957 ms，热查询正文读取与解析均为 0，追加读取 218 B；
67,382,272 B 的超预算重复日志对应 738.776/729.970/723.400/727.398 ms，驻留文件缓存为 0，
两组均记录 `semanticComparison: equal`，与结果文档一致。
文档中的 usage 126 通过/5 忽略、analytics 50 通过/3 忽略及前端 10 通过属于此前交付记录；
本轮没有重跑这些测试或基准，未将旧结果表述为本次实跑。

**终端关键路径核查**

1. ACK 与退出排空：`src/terminal/controller/outputQueue.ts:110` 串行等待 render 完成再确认，
   并在 ACK 响应前先释放本地占用，允许下一批先到达；
   `src/terminal/controller/output.ts:87` 用 xterm 解析回调完成 render，
   第 75 行等待尾部输出及退出提示解析后才通知退出诊断。
   `src-tauri/src/terminal/daemon/subscription.rs:73` 遇到 Exit 后等待全部待确认批次排空，
   `src-tauri/src/terminal/runtime.rs:200` 的 ACK 不依赖已被 Exit 清除的会话跟踪表，也不拿 workspace gate。
   对应断言见 `src/terminal/controller/outputQueue.test.ts:85`、
   `src/terminal/controller/output.test.ts:70`、
   `src-tauri/src/terminal/daemon/subscription_tests.rs:138`。

2. 连接替换与迟到响应：`src-tauri/src/terminal/daemon/subscriptions.rs:32` 替换注册后释放锁再取消旧连接，
   第 43、50 行按 session/connection 校验 ACK 与 detach，旧线程结束不会删掉新订阅。
   `src/terminal/controller/outputQueue.ts:72` 在入队时同步校验身份、批次与输出序号；
   `src/terminal/controller/lifecycle.ts:98` 保存早到批次身份，收到 Exit 先停止输入，
   第 110 行保护迟到的 create 响应。
   对应断言见 `src-tauri/src/terminal/daemon/subscription_tests.rs:20`、
   `src/terminal/terminalLifecycle.test.ts:66`、第 104、156、165 行。

3. 预算与 gap：`src-tauri/src/terminal/daemon/output_budget.rs:8` 限制每连接 256 KiB 记账量、4 批次，
   第 69 行仅接受最早待确认批次；`src-tauri/src/terminal/daemon/subscription.rs:118` 限制每批事件数。
   `src/terminal/controller/outputQueue.ts:4` 设置对应本地边界，
   `src/terminal/controller/output.ts:9` 另限制单次改写后解析输入为 512 KiB。
   宿主还可暂存一个既有 Poll 页，页上限允许最后一个 PTY 事件的越界量。
   这些是源字节/事件记账与解析队列边界，不等于 JSON 对象、WebView/Rust RSS 或 GPU 缓存上限。
   `src-tauri/src/terminal/daemon/replay.rs:35` 保留回放游标/gap 语义，
   `src/terminal/controller/output.ts:66` 在此前写入完成后 reset、显示缺口提示，再消费保留输出。
   对应断言见 `src-tauri/src/terminal/daemon/output_budget_tests.rs:29`、第 43、93 行，
   `src/terminal/controller/output.test.ts:50` 及 `src-tauri/src/terminal/daemon/output_stress_tests.rs:203`。
   UTF-8/ANSI 跨块与主题过滤暂存的解析屏障另见 `src/terminal/controller/output.test.ts:25`、第 38 行。

4. 取消、错误与等待者释放：`src-tauri/src/terminal/daemon/output_budget.rs:96` 清理并唤醒预算等待者，
   `src-tauri/src/terminal/daemon/subscription.rs:34` 同时 shutdown 正在轮询的 socket；
   ACK 超时为 30 秒，尚未建立 socket 的连接仍受 2 秒 connect 超时约束。
   `src/terminal/controller/outputQueue.ts:64` 释放异步等待并阻止迟到 ACK，
   `src/terminal/controller/output.ts:48` 释放解析等待，`src/terminal/promptInput.ts:61` 清除粘贴解析窗口计时器。
   对应断言见 `src-tauri/src/terminal/daemon/subscription_tests.rs:69`、第 178 行，
   `src-tauri/src/terminal/daemon/output_budget_tests.rs:84`、`src/terminal/promptInput.test.ts:21`、第 34 行。

5. 启动仅一次：`src/terminal/controller/lifecycle.ts:125` 只为新进程传递 startup 意图，并校验当前生命周期；
   既有 `src/workspace/projects/launch.ts:37` 保留意图去重，未在此次拆分中重写。
   daemon 重连沿用原 session/PTY 并标记 `reconnected`；对应真实进程身份断言在
   `src-tauri/src/terminal/daemon/service_tests.rs:38`，前端分支断言在
   `src/terminal/terminalLifecycle.test.ts:174`。dispose/错误/早到 Exit 不会通过迟到响应再次发送启动命令。

6. 真实 PTY 与后台保活：`src-tauri/src/terminal/native.rs:233` 的 reader 仍处理原生 OSC 应答与 EOF，
   `src-tauri/src/terminal/daemon/slot.rs:167` 的 CacheSink 只写 daemon 回放，不等待前端消费，
   `src-tauri/src/terminal/daemon/slot.rs:131` 直接返回已读 Poll 页，消除了重复页复制。
   既有真实 PTY 测试保留于 `src-tauri/src/terminal/native_tests.rs:72`、第 95、127、207 行，
   覆盖单次 Exit 前的输出、1 MiB 内容/顺序、输入回显延迟和原生颜色应答；
   `src-tauri/src/terminal/daemon/service_tests.rs:86` 的测试验证无消费者时输出保留及重放。

**证据边界与可执行验证建议**

新增 Rust 压力入口 `src-tauri/src/terminal/daemon/output_stress_tests.rs:203` 使用真实 TCP/Poll/回放实现，
生产者直接向 Slot 写内存事件；不是由真实 PTY 生成的 64 MiB 端到端流量。
`src/terminal/controller/outputPressure.test.ts:12` 使用真实 xterm 解析器但不打开窗口，
宿主/ACK 均为模拟；其输入断言只检查 xterm `onData`，不能代表大输出期间真实 PTY 回显延迟。
原有 `native_tests.rs` 的 RecordingSink 没有启用新的 ACK 订阅，三层证据不能直接拼成完整链路验收。
开发2结果文档已经区分了这些测试路径；本轮未发现需要更正的性能收益声明。

以下建议交由项目经理统一验证，不是已经复现的缺陷：

1. 在完整 Tauri 窗口用受控 PTY 连续输出已知内容并退出，暂缓解析回调/ACK。
   先在 2 MiB 回放足够时核对字节、序号、尾部提示及单次 Exit；再输出超过回放上限的数据，
   检查可见 gap、后续序号、每连接 256 KiB/4 批次预算与最终 ACK 排空。
   同时确认 PTY 持续运行、输入真实回显，不仅检查前端 `onData` 回调。
2. 刻意让首批输出先于 create 返回，在解析或 ACK 等待中 dispose/重挂，并迟到交付旧 create/ACK。
   断言旧连接不能释放新连接额度或删除新订阅，保留原 PTY 身份，启动命令只在新进程执行一次。
   现有单测可用于定位该矩阵中的具体回归，但本轮未执行真实 IPC 时序注入。
3. 暂停消费超过 30 秒，检查错误态、等待线程/计时器退出与重新连接后的回放/gap；
   关闭 UI 再恢复时确认后台进程没有被隐式终止或重新启动。
4. Windows/ConPTY 上重复真实输出、输入回显、退出及连接替换；
   WebView 可视渲染帧率、生产 RSS、长时间慢消费和窗口隐藏后的调度另行实测。
   原生 reader 的退出等待仍有 `src-tauri/src/terminal/native_lifecycle.rs:62` 的既有 1 秒边界，
   本轮未修改也未验证“子进程退出但输出句柄仍被后代持有”等情形；不能声称所有真实 PTY 情况都已排空。

本轮验证方式为代码/差异、现有测试断言和存量性能日志交叉核对；未运行全量构建，
也未重跑定向测试、基准、Windows 原生调用或完整 Tauri 可视交互。
最终全仓回归与平台验收由项目经理执行。
