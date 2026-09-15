# 开发1交付：用量统计增量缓存、并发合并与后台取消

任务：`seqqe10g`（原任务已 done）、`3vgn7ctr`（大日志兼容性追加）。
分支：`feat/multi-agent-collab`。状态：追加修复与定向验证完成。
使用技能：`belfry`；按已授权任务包在共享分支执行。

## 追加审查修复

- 先注入 2 KiB 索引预算与 16 KiB 查询状态预算，两条回归在旧逻辑上分别报
  “单个用量日志的统计索引超过内存上限”和“用量统计记录超过内存上限”，实际执行失败 2 项。
- 单文件索引达到缓存预算后释放未完成索引，使用同一文件句柄、初始 EOF 和首尾校验快照
  从头做可取消的流式扫描；不保留该文件的记录缓存。缓存内文件续写跨过预算时也走这条路径。
  索引与流式扫描共用行解析器，继续支持完整但未换行的 EOF 记录和下次追加后的末行修复。
- Codex 流式扫描先从同一 EOF 快照确定前八行中的会话身份，再逐条重放，保留 meta 之前的事件、
  resume 去重、累计基线与最后一次流式修正；窗口、项目过滤和全局额度沿用原规则。
- 移除按累计处理记录字节数与 1,000,000 条记录拒绝查询的逻辑。
  64 MiB 查询预算现在计算实际保留的 Claude 去重键、Codex 会话/指纹集合/上下文/pending/额度，
  以及聚合桶和项目根缓存；计算容器容量、哈希空槽/控制字节及字符串 capacity，不重复计入已释放的记录。
  每条记录与最终 pending flush 后均检查预算，重复消息不增加同一去重状态的费用。
- 流式读取失败或快照失效时放弃整次查询并明确报错，避免返回已经累计的半个文件。
  取消与失败仍不提交暂存缓存。正常追加只统计捕获 EOF 内的完整快照，后续字节留到下次查询。
- 本轮只修改原 scope_write；没有新增依赖、锁文件、公共 IPC 字段或根入口接线要求。

## 已完成

- 建立以 `(AgentKind, 日志路径)` 为键的有界 LRU 缓存；保存精简的统计记录与读取游标。
  为正确接续末行，每文件还可暂存至多 8 MiB 未换行的末行字节；缓存仅存在进程内存，不落盘。
- 命中且元数据未变化的文件只打开检查元数据，不读正文、不重新解析 JSON。
  追加读取从上次 EOF 开始，另校验固定大小的首尾字节；不完整末行可在下一次续写后恢复。
- 查询期间增长的日志按捕获的 EOF 完成快照，新内容留到下次增量读取。
  截断、同长度改写、文件替换、删除、读取失败均失效；损坏/超大行有计数和可见提示。
  Unix 使用设备号/inode/ctime，Windows 使用 Win32 文件 ID，辅助长度与时间戳判断。
- 查询改变日期或项目时重放精简记录，保留完整累计基线、resume 分片、Claude 全局消息去重、
  流式修正、未知日期、账号额度及四类 Token 的原有口径。
- 同一查询共享一个后台扫描。每个消费者有独立请求 ID，取消一个消费者不会停止其他消费者；
  最后一个消费者离开后，在目录遍历、读取块、记录重放和等待缓存锁时停止工作。
  完成或 Rust future 丢弃时清理请求；处理取消先于请求注册到达的竞争。
- 前端切换/替换请求与面板卸载发送真实取消 IPC，仍隔离旧响应和旧错误；取消传输失败不污染新视图。
- 未完成或失败的扫描不提交暂存缓存。根入口接线已在共享分支只读核验，说明见 integration 文件。

## 设计边界与上限

| 对象 | 上限/行为 |
| --- | --- |
| 缓存 | 64 MiB 估算保留量、4096 个文件项；LRU 淘汰后可从日志重建 |
| 单文件索引（含末行缓冲） | 至多 16 MiB，且不超过总缓存预算减去条目开销；只限制缓存准入，超限释放索引后流式扫描 |
| 单查询去重与聚合状态 | 64 MiB 实际保留状态的估算量；唯一键、指纹、桶等确实占满时明确报错，不返回部分统计 |
| 累计处理量 | 无新增的文件总字节数或记录总数上限；重复记录可持续流式消费 |
| 读取 | 64 KiB 块、8 MiB 单行上限；超大行丢弃到下一换行 |
| 聚合表达范围（原规则） | 至多 100,000 个桶，模型名 512 B、路径 32,768 B；Token 总量不超过 JS 可精确整数范围 |
| 目录遍历 | 每个 Agent 根最多 100,000 个目录项 |
| 请求 | 64 个有效消费者、8 个尚未完成的后台任务（包括取消中的任务） |
| 取消标记 | 最多 256 个，30 秒过期；请求 ID 最长 128 字节 |
| 缓存锁等候 | 每 5 ms 检查取消，不把旧请求排成无界扫描队列 |

热查询仍需枚举目录、检查文件元数据和重放精简记录。选择重放而非直接累加旧汇总，
是为了在窗口/项目改变、跨文件去重及 Codex 最后一次流式修正时保持原口径。
缓存采用暂存后提交，更新期间的瞬时内存还包含上一份缓存、解析对象和当前读取行；
上表不是进程 RSS 或分配器精确字节上限。流式回退先释放失败的索引，再逐条处理，不积累完整事件列表。
去重键和 Codex 指纹必须保留到查询结束才能保证跨文件语义，不能通过淘汰这些状态静默降低内存。

## 改动文件

- `src-tauri/src/usage/analytics/`：新增 `cache.rs`、`cancel.rs`、`jobs.rs`、`registry.rs`、
  `reader.rs`、`records.rs`、`replay.rs`、`sources.rs`、`stamp.rs`、`state.rs`、`windows_identity.rs`；
  更新 `commands.rs`、`contracts.rs`、`mod.rs`、`service.rs`。
- `src-tauri/src/usage/`：更新 `claude.rs`、`codex.rs`，新增精简记录解码模块
  `claude_record.rs`、`codex_record.rs`；将原 Codex 单测移入 `codex_unit_tests.rs`，保持生产文件小于 300 行。
- Rust 回归：新增 `analytics/cache_tests.rs`、`reader_tests.rs`、`registry_tests.rs`、
  `state_tests.rs`、`semantics_tests.rs`、`fixtures.rs`、`legacy.rs`、`performance.rs`；
  适配原 `analytics/claude_tests.rs` 的内部扫描参数，保留原断言。
- `src/usage/insights/`：新增 `api.ts`、`api.test.ts`；更新 `requests.ts`、`requests.test.ts`、
  `useUsageInsights.ts`、`contracts.ts`、`UsageInsights.tsx`。
- 本任务文档：`developer-1-integration.md`、本文件、`developer-1-performance.txt`。

本轮追加修改：`analytics/cache.rs`、`reader.rs`、`replay.rs`、`service.rs`、`aggregate.rs`、
`mod.rs`、`fixtures.rs`、`performance.rs` 及原缓存/读取测试；新增 `analytics/snapshot.rs`、
`memory.rs`、`budget_tests.rs`、`stream_tests.rs`、`stream_semantics_tests.rs`。
`usage/aggregate.rs`、`claude_record.rs`、`codex.rs` 和新增 `codex_memory.rs` 提供实际保留状态计量。
新增性能证据 `developer-1-streaming-performance.txt`。修改后的生产文件均不超过 300 行。

没有编辑其他开发的所有权文件、根 Rust 入口、依赖或锁文件，没有提交或推送。

## 实际验证

以下命令均在本工作区运行，最终退出码均为 **0**：

| 命令 | 实际结果 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib usage:: --offline --locked -- --quiet` | 126 通过，5 忽略；覆盖 analytics、原 Claude/Codex、session、scan 等 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib usage::analytics --offline --locked -- --quiet` | 最后定向复核 50 通过，3 忽略 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib usage::analytics::performance::incremental_cache_benchmark --offline --locked -- --ignored --exact --nocapture` | 基准测试单独运行，1 通过；原始输出见性能文件 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib usage::analytics::performance::oversized_duplicate_log_benchmark --offline --locked -- --ignored --exact --nocapture` | 默认预算下的大日志基准，1 通过；原始输出见 streaming 性能文件 |
| `pnpm exec vitest run src/usage/insights` | 3 个文件、10 项通过 |
| `pnpm exec tsc -b` | 类型检查通过，没有其他开发在途代码导致的错误 |
| `rustfmt --check --edition 2024 src-tauri/src/usage/analytics/mod.rs src-tauri/src/usage/aggregate.rs src-tauri/src/usage/claude.rs src-tauri/src/usage/codex.rs` | 格式检查通过 |
| `git diff --check -- src-tauri/src/usage src/usage/insights` | 差异空白检查通过 |

原任务中 Windows 文件身份模块用下列命令跨目标类型编译成功（退出码 0）；
本轮未改该模块，未重复此项，也未执行 Windows 原生调用：

```sh
rustc --edition 2024 --crate-type lib --target x86_64-pc-windows-msvc --emit metadata \
  -o src-tauri/target/usage-windows-identity.rmeta - <<'RS'
mod identity {
    include!("/Users/cheng/work/Project/tool/otty-win/src-tauri/src/usage/analytics/windows_identity.rs");
}
pub fn read_identity(file: &std::fs::File) -> std::io::Result<(u64, u64)> { identity::read(file) }
RS
```

有价值的回归包括：真实文件读取在 EOF 前被取消、持有缓存锁时取消仍可结束后台任务、
并发消费者共享同一次实际扫描、取消隔离、future 丢弃清理、有界取消队列、早到/迟到取消、
冷热统计一致、追加/轮转/截断/删除、读失败失效、缓存淘汰、扫描中追加、UTF-8 跨块、
坏行/超大行/末行修复、窗口与项目切换、resume 去重、流式修正、额度和未知日期。
另有双 Agent 日志根重叠的回归：未隔离缓存时曾得到 100 而预期 210，改用组合键后通过。
前端取消回归也先在旧实现上失败（2 项），接入请求 ID 与真实取消后通过。

追加 11 项回归覆盖：小预算冷/热/追加、缓存内续写跨预算、Claude/Codex 重复记录保留量不增长、
上下文替换按真实 capacity 计量、唯一去重键和聚合桶确实占满时拒绝、流式窗口/项目/额度/resume/末行，
前八行 metadata 与转义预筛语义、固定 EOF、真实读取在 64 KiB 内响应取消、取消保留原缓存、
读取期间文件替换整次失败及重试恢复。已自审流式失败路径、缓存提交时机和状态内存计量。

默认忽略项包含原有本机 CLI/日志冒烟及新增性能基准；性能基准已另行显式执行。
全量工作区回归、构建、插件、Windows 原生和 PR/CI 实跑仍由项目经理统一验收。

## 性能证据

同一 `debug/test` 构建，247 个合成临时 JSONL，共 **66,383,801 字节**；
固定查询时间和内容，对比原逐文件扫描路径与缓存路径的全部原有 report 字段。
冷指解析缓存尚未建立，操作系统页缓存已暖；没有用 release/debug 差异表示收益。

| 场景 | 耗时 | 正文读取 | 校验字节 | JSON 解析行 | 缓存命中 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 原逐文件扫描 | 608.678 ms | 完整语料扫描 | — | — | — |
| 冷缓存 | 501.619 ms | 66,383,801 B | 126,464 B | 2,224 | 0 |
| 热缓存 | 15.189 ms | **0 B** | **0 B** | **0** | 247 |
| 单文件追加 | 12.957 ms | **218 B** | 1,024 B | **1** | 246 |

追加量正好是 218 字节，另有固定边界校验；原算法、冷/热查询和追加后的结果比较均一致。
保留缓存估算量 1,345,114 字节、247 项。原始输出：[developer-1-performance.txt](developer-1-performance.txt)。
这是可复现合成语料测量，不代表任务包中真实日志 8.50 秒基线的实测加速比。

另用默认预算验证单个 **67,382,272 B** 日志：1,024 条重复 Claude 消息，
message ID 与 request ID 各 32 KiB，实际仅有一个去重键和一个聚合桶。
即使只累计重复记录中的两个 ID，也达到旧 64 MiB 重放限制，再加记录本体便超过该限制；
单文件索引也必然超过旧 16 MiB 限制。冷/再次查询/追加全部与原逐文件算法一致。

| 场景 | 耗时 | 正文读取 | 校验字节 | JSON 解析行 | 驻留文件缓存 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 原逐文件扫描 | 738.776 ms | 完整日志扫描 | — | — | — |
| 冷查询，流式回退 | 729.970 ms | 84,290,560 B | 512 B | 1,280 | 0 B |
| 再次查询，流式回退 | 723.400 ms | 84,290,560 B | 512 B | 1,280 | 0 B |
| 追加后，流式回退 | 727.398 ms | 84,356,363 B | 512 B | 1,281 | 0 B |

追加 65,803 B 后同一消息的 output 修正被完整计入，总 Token 为 120，未截断或重复统计。
正文读取包含释放索引前的尝试，因此大于文件大小；预算外文件的再次查询没有缓存命中收益。
两组均在同一 `debug/test` 模式单独运行，页缓存已暖，耗时是本次合成测量，不作为固定延迟保证。
原始输出：[developer-1-streaming-performance.txt](developer-1-streaming-performance.txt)。

## 已知限制与整合注意

- 本机执行环境为 macOS；Windows 专用文件 ID 单测已加入，但其原生执行、整应用 Windows 构建仍待 CI/实机验证。
- 按 CLI 的追加写模型识别增长：相同文件身份、长度增加、首尾校验一致时继续读取。
  外部程序若同时重写中部并保留这些特征，不能靠有界首尾校验保证发现；没有全文件哈希验证。
- 被淘汰和超索引预算文件需要重读。超预算文件在下一次查询（包括追加后）仍完整流式扫描，
  首次索引尝试和 Codex 身份探测带来额外读取；成功缓存的文件继续保留热查询及增量优势。
- 64 MiB 查询上限只限制实际保留的去重与聚合状态。流式途中无法读取或快照失效会让整次查询失败；
  在进入重放之前就无法打开/建立索引快照的文件仍按原规则跳过并提示。以上均不静默返回半个文件。
- 8 MiB 单行及聚合表达范围仍沿用原有明确诊断规则，没有通过放大常量掩盖兼容性问题。
- 面板卸载/筛选变更的 IPC 与状态机已验证；本任务没有手工驱动原生窗口做交互验收。

Belfry：原任务已执行 `belfry done seqqe10g`；本轮回报命令为 `belfry done 3vgn7ctr`。
