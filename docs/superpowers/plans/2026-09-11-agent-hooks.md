# CM-01 Hook 状态与通知实施计划

执行：沿用 `executing-plans`、关键行为 TDD 与完成前验证；当前分支内实施，不提交或推送。

## 目标与边界

把 CLI Hook 接入 Belfry 的会话状态、原生 session 身份、通知和现有输入队列。
按已核实的 CLI 版本提供安装预览、显式启用和移除，保留用户已有 Hook。
只观察事件，不返回批准、拒绝、阻止退出或继续执行的指令。

## 依据

- [Codex 官方 Hook 文档](https://learn.chatgpt.com/docs/hooks)：事件字段、并发执行、信任审阅、Stop 可被其他 Hook 继续。
- [Claude Code 官方 Hook 文档](https://code.claude.com/docs/en/hooks)：主/子会话字段、PermissionRequest、StopFailure、Notification。
- 本机 Codex `0.154.0` 的 `features list` 报告 `hooks stable true`；Claude Code `2.1.201`。
- 首次支持下限保守采用本机可验证版本，不把未知旧版本冒充已支持。

## 设计

- 每次 Agent 启动发放独立 Hook token，端点只绑定 IPv4 loopback；旧进程的 token 在重启/退出时撤销。
- Hook 入口放在现有应用二进制的专用参数中，在启动桌面运行时之前处理；不依赖 Python/Node。
- 接收前剥离 prompt、工具参数、工具输出与错误原文，只传状态和身份字段；不记录凭据。
- 第一个主会话事件绑定原生 ID；拒绝另一会话、子 Agent 和过期回合的状态。
- 等待批准以待处理工具集合维护；其他并行工具结束不能解除等待，等待中 Stop 不算完成。
- 状态通过既有终端 Channel 投递；Hook 连接前明确显示屏幕推断，连接后屏幕不能覆盖运行/等待状态。
- Stop 需屏幕退出忙碌/批准状态并经过短暂稳定期后再进入空闲，其他 Hook 继续时取消完成候选。
- 通知消费结构化状态，重复完成、退出和中断不重复或误报完成；失败单独通知。
- Codex 安装到其配置目录的 `hooks.json`，Claude 安装到 `settings.json`；只移除带 Belfry 标记的命令。
- 预览只包含本应用新增/移除的 Hook；若源文件在预览后改变则拒绝写入，避免覆盖新配置。
- 不修改 Codex Hook 信任记录；界面提示用户在 CLI `/hooks` 中审阅并信任。
- 不自动改写 CLI 全局 `features.hooks`；禁用或管理员限制时保留明确回退提示。

## 任务

- [x] 核心状态与身份：先失败测试，再实现去重、等待集合、会话/回合隔离与载荷收敛。
- [x] 安装与移除：测试混合 Hook 保留、重复安装、损坏配置、预览过期和命令转义。
- [x] 进程接线：有界本机传输、生命周期绑定、旧 token 撤销、私有启动环境。
- [x] 前端：状态来源、完成稳定期、失败/完成通知、设置预览与明确启用。
- [ ] 实际 CLI 与传输集成验证：helper、Claude 回传和 Codex 未信任回退已通过；Codex 审阅后的回传待桌面验收。
- [ ] 全量回归、构建、独立桌面验收和差异审查。
- [ ] 验收通过后立即勾选 CM-01，关闭重开待办回读并同步总实施记录。

## 验证重点

并行会话不串状态；子 Agent 不改主会话；重复 Stop 只通知一次；权限等待不误报完成；
旧进程/旧回合事件被拒绝；不支持/未连接时明确推断；原有 Hook 安装移除前后保留。
临时配置与模拟服务用于自动化；当前仅能执行 macOS 实机验收。

## 已有证据

- `/tmp/belfry-cm01-edges-red.log`：四项边界失败已复现；`edges-green.log`：30 项 Hook 测试通过。
- `/tmp/belfry-cm01-rust-full.log`：413 单元测试、1 集成通过，5 项忽略；日志没有编译警告。
- `/tmp/belfry-cm01-frontend-full.log`：91 个文件、588 项通过。
- `/tmp/belfry-cm01-desktop.log`：独立 QA 构建成功；存在原有 bundle 体积和未配置公证凭据提示。
- `/tmp/belfry-cm01-cli-smoke.log`：`scripts/test-agent-hooks.py` 的真实二进制和 CLI 检查通过。
- 新增四项边界修复：并行审批保留、切换身份清空旧 transcript、忽略无关 Notification、压缩保留回合校验。
- 2026-09-11：正式应用和 QA 均返回 `cgWindowNotFound`，已请求恢复桌面；未把待验收项标为完成。
- 2026-09-13：桌面恢复期间，在 QA 设置中分别移除并重装两家 Hook。移除后原 `SessionEnd: true` 命令精确保留；Codex 重装后恢复 10 条托管命令且保留原命令。全程仅操作临时 CLI 配置。
- 随后启动真实 Codex 到“命令 空间”测试项目，桌面再次报 `cgWindowNotFound`；CLI 自身 `/hooks` 审阅与并行状态验收尚未完成，未改写信任记录。
