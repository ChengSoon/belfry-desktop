# Windows Hook 与跨会话自动投递

## 本次调整

- Windows 新安装的 Hook 使用安装目录里的轻量 `belfry.exe --belfry-hook codex|claude`，不再冷启动桌面 GUI 程序。旧桌面入口保留兼容，但设置页会提示重新安装 Hook。
- 保留 Windows 8 秒启动预算；stdin 按单个 JSON 值读取，不等待 CLI 关闭管道。Hook 只观察，端点失效或输入异常仍中性返回 `{}`，不拦截用户任务。
- Codex 的默认 Windows Hook shell 是 `cmd.exe /C`，命令保持双引号路径格式，不添加 PowerShell 专用的 `&`。自定义 Hook shell 的用户需要使用与该 shell 相容的调用方式。
- 跨会话投递不抢终端焦点；粘贴写入后 Windows 留 600ms 解析余量，再写一次 Enter。不循环补回车。
- 队列现在接收提交、取消、失败和断连结果。用户介入或写失败会显示原因并暂停后续投递，避免部分文本与下一条任务混合。同一 PTY 重连不会解除暂停；Agent 开始处理当前输入，或启动真正的新 PTY 后，后续队列才可以继续。只有确定未发生写入的任务才自动重排。
- 15 秒仍未观察到 Agent 开始处理，会显示未确认提示，不自动重贴。CLI 的 `已受理` 只表示任务已排队，不代表目标已开工；完成仍以 `belfry done/fail` 为准。

## 升级后操作

1. 确认安装目录含新版本的 `belfry.exe`。开发模式先构建 `cargo build -p belfry-cli`。
2. 在设置的 Hook 页面重新预览并启用。只替换 Belfry 管理的 Hook，不删除用户其他 Hook。
3. 重开 Agent 会话，让环境变量与 Hook 配置生效。Codex 在 `/hooks` 中重新审阅、信任变化后的命令；不自动绕过 CLI 信任检查。
4. 跨会话发送时，目标必须处于 `running + idle`。权限框不会被自动确认。
5. 若提示投递暂停，先检查目标输入区，必要时手动按 Enter；不要再次粘贴同一任务。内容缺失时可用 `belfry inbox` 查看原任务。

## 原因与验证边界

源码及组合回归已确认：旧输入接口在异步取消/失败后仍报告接管成功，队列无法收到实际结果；目标持续 idle 时后续任务会被静默锁住。该缺陷不是 Windows 独有。

Windows Hook 原先依赖 GUI 可执行文件及其启动依赖，已有的超时补偿不能消除这一启动成本。此次改用轻量控制台入口来减少冷启动与管道兼容性风险。没有用户 Windows 日志，不能断言所有 `hook failed` 都由同一个原因导致；路径失效、CLI 全局关闭 Hook、未信任 Hook 仍需分别检查。

本地回归覆盖真实 CLI 进程的 stdin/TCP/脱敏及中性返回、队列与真实输入运行时的组合、Windows 解析等待和焦点行为。Windows 专项 `cmd.exe` 路径与旧配置迁移测试会由现有 Windows CI 执行；macOS 上的交叉 `cargo check` 不等于 Windows 实机运行验证。
