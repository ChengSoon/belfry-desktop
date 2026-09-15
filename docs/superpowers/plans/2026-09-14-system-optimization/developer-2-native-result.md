# 开发2：真实 PTY 与 ACK 订阅整合证据

任务：`n2e4ath4`。日期：2026-09-15。使用技能：`belfry`。

已补 3 项 macOS 真实 PTY 整合测试，最终与 7 项原生回归、5 项 daemon service 回归联合执行，
**15 项通过，0 失败，0 忽略**。本轮覆盖路径中未发现生产缺陷，未修改生产行为。
这补齐了真实 PTY 到生产 TCP Poll、宿主订阅和 ACK 的证据，不代表完整 Tauri/WebView 或 Windows 验收。

## 范围与快照

共享分支 `feat/multi-agent-collab`，HEAD `439302a69286b6ff96dbc780433e6491b5a838ea`。
读取并遵循 `developer-1-review.md` 的证据边界；验证针对当前共享工作区的未提交实现。
入场时 `daemon/mod.rs`、`native_tests.rs` 已有本轮前序差异，均保留；未还原其他开发的在途修改。

本任务新增 `src-tauri/src/terminal/daemon/native_subscription_tests/`：

- `mod.rs:29`、`:62`、`:93`：保序/退出排空、慢消费 gap/真实输入、断开重连/旧 ACK 隔离。
- `fixture.rs:27`：独立临时目录、生产 daemon server、受控真实 shell 与自身资源回收。
- `probe.rs:36`、`:154`、`:197`：启用 ACK 的 sink、逐次投递预算账本、最终 ACK 等待及事件顺序核对。

另仅增加 `daemon/mod.rs:6` 的 macOS 测试注册，并把 `native_tests.rs:313` 的既有测试锁 helper
开放给同一 terminal 模块，供新增测试复用，避免并行压力影响旧输入延迟用例。
未改根入口、生产逻辑、协议、配置、依赖、锁文件、其他开发代码；未提交、推送或触发远程 workflow。

## 实际链路与隔离

每个 fixture 在系统临时目录创建独立 `belfry-native-ack-<ULID>`，由独立线程运行原样生产
`server::run`，使用随机 loopback 端口及自身 endpoint/token。确认 endpoint 和真实 Ping 就绪后，
才创建 `DaemonClient`，避免其回退启动测试二进制。通过生产 `Create` 创建会话，
`NativePtyBackend` 拉起真实 PTY，`CacheSink` 写真实回放，`Subscription` 经真实 TCP `Poll`
获取输出并投递 `OutputBatch`，测试消费者调用原样 `DaemonClient::acknowledge`。
ACK 是宿主订阅层调用，并非额外发往 daemon 的 RPC；没有用内存生产者向 Slot 注入数据。

启动使用 `shell:zsh` 的私有启动参数 `-f -c`，再 exec `/bin/bash --noprofile --norc` 运行自有脚本；
脚本先断言 stdin/stdout 均为 TTY，设置 `stty -echo -onlcr`，再记录 PID/启动次数。
跳过用户 shell 配置，并从这个子进程移除继承的 `BELFRY_*`、`BASH_ENV`、`ENV`；未修改宿主环境。
payload 是 12,000 行带递增编号和 `状态怀念𠀁` 的已知 UTF-8 字节，共 1,056,000 B，由真实 `cat` 输出。
只关闭 fixture 自己的随机 endpoint 及其子进程；最终检查残留 fixture 目录为 **0**。

## 关键测量

以下取最终 15 项联合运行的记录；完整原始输出见 [developer-2-native-validation.txt](developer-2-native-validation.txt)。
“payload”不含固定首尾标记和输入回显，“收到字节”包含这些标记/回显。

| 场景 | 生成 payload | 收到字节 | 投递批次 | gap / 丢弃事件 | 未 ACK 记账峰值 / 批次峰值 |
| --- | ---: | ---: | ---: | --- | --- |
| 缓存足够、自然退出 | 1,056,000 B | 1,056,028 B | 19 | 0 / 0 | 131,471 B / 2 |
| 暂停 ACK、8 倍输出 | 8,448,000 B | 1,979,969 B | 33 | 1 / 6,321 | 261,903 B / 3 |
| 断开后重连回放 | 1,056,000 B | 1,056,086 B | 19 | 0 / 0 | 131,471 B / 2 |

- 保序场景在首次 ACK **之前**已收到子进程写出的 `produced` 文件，且真实 `Info` 为 Exited；
  从发起 create 到确认退出为 **94.32 ms**。随后核对完整 stdout 字节相等、输出 sequence 连续、
  delivery ID 连续、EOF 在 Exit 前、Exit 仅一次。包含 Exit 的最后批次暂缓 ACK 40 ms，
  sink 仍存活；合法 ACK 后账本归零、sink 弱引用失效、通道关闭，重复 ACK 被拒绝。
- 慢消费场景在全部 8,448,000 B 生成后仍不 ACK。子进程继续运行并实际读取通过
  `DaemonClient::write`/TCP/PTY 写入的 `输入状态怀念𠀁`，文件内容逐字节一致；
  写入至确认输入文件的单次时延为 **37.46 ms**，包含文件轮询（10 ms 步长）。
  恢复 ACK 后出现明确 `ReplayGap`，之后的 sequence 与 gap 的 next_sequence 对齐。
  gap 后 **1,863,218 B** 与已知输出的末尾逐字节相等，包含真实输入回显及尾标记，最终 EOF/Exit/ACK 排空。
  已丢弃部分由 gap 明示，没有声称全部 8.4 MB 均被保留。
- 重连场景在旧批次未 ACK 时 detach，并等待旧订阅 sink 释放；无订阅期间写入真实输入，
  子进程成功读取且保持 Running。重连后 session ID 不变、connection ID 改变、`reconnected=true`，
  PID 始终为本次 fixture 的 **65664**、启动记录仅一条。旧 connection 的 ACK/detach 不影响新订阅；
  针对实际已投递待确认的第 2 批先 ACK 被拒绝，第 1 批合法 ACK 成功，重复 ACK 被拒绝。
  完整重放包含无订阅期间的输入回显，且没有重复或遗漏。

每次 sink 投递均按生产 `event_size` 核对已投递但未 ACK 的源字节/事件开销不超过
**256 KiB / 4 批次**；ACK 与测试账本扣减共用测试锁，避免新 send 抢先记账造成虚假峰值。
这是投递预算证据，不是 Rust/WebView RSS、回放缓存或 GPU 占用上限；宿主额外暂存 Poll 页的既有边界仍在。

## 实际命令与结果

环境：macOS **26.6.2 (25G83)**、arm64、rustc **1.97.1**。
以下命令均在仓库根执行、退出 0。Cargo 输出通过 `set -o pipefail` 与 `tee` 顺序保存到上述原始记录；
复用 `src-tauri/target`，仅编译该 crate 的 lib 测试，未生成新构建目录、未跑全仓或生产构建。

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p belfry-desktop --lib terminal::daemon::native_subscription_tests --offline --locked -- --nocapture --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml -p belfry-desktop --lib terminal::native_tests:: --offline --locked -- --nocapture --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml -p belfry-desktop --lib --offline --locked -- terminal::daemon::native_subscription_tests:: terminal::native_tests:: terminal::daemon::service_tests:: --nocapture --test-threads=4
cargo test --manifest-path src-tauri/Cargo.toml -p belfry-desktop --lib terminal:: --offline --locked -- --ignored --list
rustfmt --edition 2024 --check src-tauri/src/terminal/daemon/native_subscription_tests/mod.rs
git diff --check -- src-tauri/src/terminal/daemon/mod.rs src-tauri/src/terminal/native_tests.rs
```

首轮新增测试 **3 通过 / 2.32 s**，原生回归 **7 通过 / 2.42 s**；
增加共享测试锁后联合复核 **15 通过 / 4.76 s**，其中 3 新增、7 原生、5 service，用例不重复累计。
原生回归涵盖默认 shell、1 MiB 输出、单次退出、cwd、系统 SSH 启动及原生 OSC 应答；
最终原生输入回显 P95 为 **0.37 ms / 20 样本**，这是旧 RecordingSink 用例自身的测量口径。
service 回归还覆盖相同 attachment、无消费者回放、关闭旧 tab、私有快照存续和 workspace lease 下重连。

终端目录源码无 `#[ignore]`，实际 `--ignored --list` 返回 **0 tests, 0 benchmarks**。
因此本范围没有可执行的终端 ignored 用例，未把空枚举计入通过数；相邻 usage/history/provider 的
CLI/本机日志 ignored 测试不属于这条终端 ACK 链路，本轮未运行。
新增文件格式、空白检查及所改既有文件的 `git diff --check` 均通过。

## 证据边界

- daemon 服务运行于 Rust 测试进程的独立线程，真实 PTY 是原生子进程；没有独立 Tauri 宿主进程、
  Tauri command/Channel IPC 或 WebView。不能把本轮与旧无窗口 xterm 测试相加后称为完整可视端到端。
- gap 本轮验证到生产事件、游标及保留字节，不是已验证可见提示、字体、WebGL、滚动或渲染帧率。
- 慢消费输入测量发生在大输出已生成、ACK 仍暂停且脚本等待读取输入时；不是持续生产负载下的输入 P95，
  也不是输入到画面的延迟。未测暂停超过 30 秒的 ACK 超时。
- 自然退出覆盖受控脚本正常关闭 PTY 的情况；未扩大 `native_lifecycle.rs:62` 既有 1 秒 reader 等待边界，
  未验证“主进程退出、后代仍持有输出句柄”。未模拟 daemon/宿主进程崩溃或应用重启。
- 新增测试仅在 macOS 编译运行；未执行 Windows/ConPTY、远程 CI、发布流程或生产 RSS 测量。
  完整 UI 与最终全量验证仍由项目经理统一执行。
