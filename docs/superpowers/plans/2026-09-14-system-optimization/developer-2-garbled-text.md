# 终端中文乱码排查与修复

任务：`h7ahddac`。日期：2026-09-15。使用技能：`belfry`。

已修复本范围内两个可重复问题：真实 xterm UTF-8 跨写入边界丢字，以及 replay gap 后诊断文本开头出现孤立续字节替换符。用户反馈的具体位置、形态与平台尚未确认，因此不能据此声称所有“乱码/缺笔/重影”均已解决。

## 修复前证据

直接加载仓库现有 `@xterm/xterm` 6.0.0，创建无窗口的真实 Terminal，等待每次 `write` 的解析回调，再读 `terminal.buffer.active`，得到：

| 原文 | 整块写入 | 分块条件 | 实际解析文本 |
| --- | --- | --- | --- |
| `状态X` | `状态X` | 第 5 字节后切分，即 `E7 8A B6 E6 80` / `81 58` | `状X` |
| `怀念X` | `怀念X` | 第 2 字节后切分，即 `E6 80` / `80 E5 BF B5 58` | `念X` |
| `𠀁X` | `𠀁X` | 第 3 字节后切分，即 `F0 A0 80` / `81 58` | `X` |
| `中文X`、`😀X` | 原文 | 全部双块切分位置 | 原文 |

逐字节写入也能复现前三项。这与字体/GPU 无关：失字已出现在 xterm 的解析缓冲区，未创建 WebGL 画布。

根因定位：`node_modules/@xterm/xterm/src/common/input/TextDecoder.ts:161` 用续字节低 6 位的真值判断已暂存字节数量。遇到 `0x80` 时低 6 位为 0，会错误地把该续字节当作尚未保存，从下一块多取字节，最后丢掉码点。现有 `TerminalOutput` 会把半个 UTF-8 字符跨批交给 xterm，因而可触发该实现缺陷。

修复前新增并运行 `outputUnicode.test.ts`，3 项实际失败：

1. 全部双块切分位置：预期 `状态：怀念𠀁😀中文`，第 5 字节切分实际为 `状：怀念𠀁😀中文`。
2. 带 Codex SGR 改写的逐字节输出：实际为 `状：念😀中文`。
3. replay gap 后首部续字节跨多个事件到达：诊断回调实际得到 `��新状态`。

第三项来自 `TextDecoder` 的正常替换行为：daemon 按输出 frame 淘汰缓存，保留的首个 frame 可以从 UTF-8 续字节开始。xterm 自身会忽略孤立续字节，但诊断/输出回调原先会产生 U+FFFD；此项不混同于用户画布上必然出现替换符。

## 最小改动

- 新增 `src/terminal/controller/utf8Boundary.ts`：按 UTF-8 字节边界保留最多 **3 个尾字节**，后续拼完整码点再交给 xterm；保持原始字节，不做 GBK 转换，不通过整段字符串重编码改变非法源字节的语义。
- `src/terminal/controller/output.ts` 在主题过滤后使用边界缓冲；EOF 原样排出真正残缺的尾字节。退出、dispose 清理缓冲。
- 已知 replay gap 时丢弃旧的半字符，并仅在这个重接点跳过首段孤立续字节，支持续字节分属多个事件；原有可见 gap 提示保持。正常流中的非法字节不被该重同步规则吞掉。
- 新增 3 项真实解析器回归和 3 项边界/预算回归。持续保留源字节窗口、消费确认与解析回调机制；额外暂存上限是每控制器 3 字节。

没有升级依赖、修改锁文件、公共协议、Rust 根入口或重启用户会话；本修复仅在原有终端输出链路插入边界缓冲。

## 其他方向核查及边界

| 方向 | 证据与结论 |
| --- | --- |
| PTY 输出与输入 | native reader 和 IPC 传输使用字节数组；输入通过 TextEncoder 写 UTF-8。未见整块 lossy 文本解码后重新编码的普通输出路径。实际 PTY / 新 ACK 链路的扩充证据由后续任务 `n2e4ath4` 单独交付。 |
| CodexThemeSync | 普通输出按字节透传，TextDecoder 只解析完整的 ANSI 参数；新增真实解析器测试覆盖逐字节中文与 SGR 改写并存。此次未改主题逻辑。 |
| locale | 在本机 macOS 26.6.2 的独立进程中，`C.UTF-8`、`UTF-8`、`en_US.UTF-8`、`zh_CN.UTF-8` 均被系统接受，CODESET 均为 UTF-8；`C` 为 US-ASCII。不能把“macOS 不接受 C.UTF-8”作为本机根因。自定义环境、用户 shell 初始化脚本和 Windows 尚未实测。 |
| 字体及 WebGL | 已读 `fontRendering.ts`、layout、renderConfig 的加载、清图集、refresh、fit 与 context loss 回退路径，并运行现有字体测试。此次失字无需 GPU 即可复现，因此没有凭假设修改字体/缓存逻辑；这些检查不构成所有平台缺笔重影已排除。 |
| 恢复缺口 | 仍保留既有回放上限与可见 gap；边界缓冲无法恢复已经被 daemon 缓存淘汰的内容。 |

用户后续仍需明确：终端内容或普通 UI、复制出来的文字是否同样错误、是否只是视觉重影/缺笔、发生平台及触发时机。项目经理正在协调这些信息与原生 UI 验收。

## 实际验证

| 命令 | 结果 |
| --- | --- |
| 修复前 `pnpm exec vitest run src/terminal/controller/outputUnicode.test.ts` | exit 1，3 项行为回归失败，已记录上面的实际文本。 |
| 修复后 `pnpm exec vitest run src/terminal/controller/outputUnicode.test.ts src/terminal/controller/utf8Boundary.test.ts src/terminal/controller/output.test.ts` | exit 0，3 文件 / 11 项通过。 |
| `pnpm exec vitest run src/terminal` | exit 0，21 文件 / 147 项通过；包括真实 xterm 64 MiB 压力、队列/ACK、UTF-8、主题过滤、字体、输入与生命周期回归。 |
| `pnpm exec tsc --ignoreConfig --noEmit --strict --target ES2022 --module preserve --moduleResolution bundler --lib ES2022,DOM --skipLibCheck src/terminal/controller/output.ts src/terminal/controller/outputUnicode.test.ts src/terminal/controller/utf8Boundary.test.ts` | exit 0；限定本次输出链路及新增测试的严格类型检查。 |

未跑全仓测试或生产构建。UI/WebView、Windows、用户实际异常场景的验收仍由项目经理统一执行。

旧任务 `w4r7c0gn` 的 CI / 工作区审查已按要求补入 [developer-2-review.md](developer-2-review.md)，原始证据与 SHA256 仍在 [developer-2-cross-review.md](developer-2-cross-review.md)。
