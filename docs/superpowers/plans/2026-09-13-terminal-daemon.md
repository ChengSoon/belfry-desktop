# CM-06 后台 PTY 与重新连接

目标：退出 UI 后原进程继续工作；重开连接原 PTY，输出有序回放，缺失缓存明确可见。

## 设计

- 使用同一受信应用二进制的专用 daemon 入口，跨平台复用 NativePtyBackend / ConPTY，不新增依赖。
- 每个应用数据域有独立后台实例、排他活体锁和私有端点文件。IPC 仅监听 loopback，随机凭证、版本校验、有界帧和并发上限。
- UI 保存终端身份，恢复只 attach 指定进程。原后台已退出时提示进程不存在，由用户显式重启；不偷偷重复执行启动命令。
- 每会话缓存有界，回放与实时事件使用单调游标；缺口发出独立事件，客户端重新对齐序号并提示。
- Hook 接收端跟随 daemon；项目 Provider 私有快照迁到 daemon 生命周期。插件/协作通道通过受限本机代理在 UI 重开后重新绑定。
- 退出 UI 弹出保留任务/结束任务两种选择；平常关闭单条会话仍结束对应任务。意外 UI 中断不杀后台任务。
- 只测试本任务创建的 daemon、临时项目和进程，不退出正式 Belfry。

## 风险与验证

原生进程回收、后台凭据、重连幂等、插件通道更新、退出请求与新建竞态需要专项回归。
测试包括鉴权失败、超限/损坏帧、缓存裁剪、并发输出、真实后台 Shell PID 与退出后计数、重连不重放启动命令、明确终止。
Windows 自动编译/协议验证与本机实际可运行的测试分别报告，不把 macOS 实机结果代替 Windows。

## 进度

- [x] 协议、缓存、daemon 生命周期及真实进程测试。
- [x] UI 保存身份、attach 与退出选择；Hook/Provider/协作/插件生命周期接线。
- [x] Worktree 占用与跨实例创建租约；关闭期间迟到创建和插件票据回收。
- [x] 最终整合、类型/回归和独立 QA 构建，真实后台进程与 CLI 验证。
- [x] macOS 桌面退出重开验收及显式结束任务。
- [ ] Windows 平台验证（缺少 SDK 和实机环境）。
- [ ] 更新实施记录和 CM-06 待办，重开回读。

## 验证证据

- 持久化回归先见 3 项失败，再通过 47 项相关测试；身份不包含连接凭据，恢复不改变挂载身份。
- 终端定向 77 项通过；新增 SSE 测试通过，验证首条事件在连接关闭前送达，旧 Agent 凭据可跟随新 UI 端点。
- 独立 daemon 的启动父进程和读取客户端真实退出；重连后原 worker PID 不变、计数持续增长，4 MB 输出触发可见缓存缺口。
- 真实 Claude/Codex 通过本机模拟模型端点运行。Claude Hook 由 daemon 接收，原生身份和完整事件回放一致；未审阅的 Codex Hook 不执行。
- 退出弹窗使用现有模态层和自绘按钮；按钮样式、监听注册后检查待退出请求、关闭 tab 释放插件票据已修正。
- TypeScript 工程检查通过；GUI 退出重开已在独立 Controls QA 验收，跨进程测试和桌面证据分别保留。
- Windows 交叉检查失败于 ring 的 C 编译：缺少 assert.h / Windows SDK，不能宣称 Windows 构建或实机通过。

最终检查补充：

- 前端迟到 create 返回会覆盖已断开/输出错误的状态：6 项生命周期测试先复现 2 项失败，修复后通过；不再误执行启动命令。
- macOS accept 继承非阻塞监听标志，分段请求提前失败、大响应被截断。新增失败基线后统一修正 IPC/代理/Hook 连接模式。
- 最新全量：前端 133 文件、759 项；Rust 510 项、8 忽略。独立 QA 构建通过。
- 最终真实进程复测：worker PID 35368 不变、计数 3→8，大输出缺口正确对齐；显式结束回收成功。
- 最终 CLI 复测：Claude Hook 身份与完整回放一致；未审阅 Codex Hook 未执行。
- 2026-09-13 桌面连接恢复后，使用界面“保留任务并退出”，原 UI 36385 真实结束，helper 重开为 66137。
- 长任务 worker PID 64937 不变，计数从 47 增至 159，重开后界面连续显示至 224；启动记录始终仅一行。
- 通过会话关闭按钮显式结束后，worker 64937 已退出。证据：`/tmp/belfry-cm06-ui-before.json`、`/tmp/belfry-cm06-ui-after.json`、`/tmp/belfry-remaining-qa-final-running.log`。
- Windows SDK / 实机验证仍未完成，待办保持未勾选并注明平台验收边界。

日志：`/tmp/belfry-cm06-cross-process-final.log`、`/tmp/belfry-cm06-real-agents-final.log`、
`/tmp/belfry-remaining-frontend-final.log`、`/tmp/belfry-remaining-rust-final.log`、
`/tmp/belfry-cm06-sse.log`、`/tmp/belfry-cm06-fragmented-red.log`、`/tmp/belfry-cm06-windows-check.log`。
