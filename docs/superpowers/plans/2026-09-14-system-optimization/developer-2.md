# 开发2：终端流控与控制器拆分

## 目标

直接实现终端大输出优化，并按职责拆分 `src/terminal/terminalController.ts`（基线 630 行）。
当前输出无消费确认地调用 `terminal.write()`；xterm 待处理数据超过约 50 MB 会抛错，
后台 2 MiB 回放缓存并不等于 WebView/xterm 待处理队列有界。

## 所有权

- scope_write：`src/terminal/**`、`src-tauri/src/terminal/**`；
  本目录 `developer-2-result.md`、`developer-2-integration.md` 和本任务临时压力验证入口。
- scope_read：全仓库，尤其组件 TerminalViewport、后台 daemon、PTY 生命周期及 prompt 队列。
- 禁止编辑 `src-tauri/src/lib.rs`、`src/components/**`、workspace、usage、CI/根配置/锁文件。
- 如需根入口注册新的 ack 命令，尽早在 `developer-2-integration.md` 写完整函数路径、参数和调用约定；
  项目经理负责根入口注册。必须保留现有命令与存档兼容。

## 实现要求

1. 为 daemon/宿主到前端输出建立有界在途预算与消费确认，使用 xterm 的解析完成回调归还额度；
   合并必要的小块，避免 IPC 队列无限增长。说明预算约束的是哪一层。
2. 背压不能破坏后台保活：UI 关闭/重挂/消费缓慢时后台任务仍按既有设计运行；
   回放溢出继续明确显示 gap，不能静默丢数据或无条件重启 Agent。
3. ack 绑定 session 和 connection 身份；旧连接、重复确认、乱序确认不能释放新连接的额度。
4. 退出、断开、dispose、错误、重连必须释放等待者与计时器；不要在持有全局锁时等待前端。
5. 保留输出顺序、UTF-8/ANSI 跨块、OSC 颜色响应、主题过滤、提示词输入和启动命令仅一次等行为。
6. 在不扩大协议范围的前提下消除已确认的无用开销：例如 Slot::poll 的重复页复制；
   通道长期化或 daemon 协议版本变化若确有必要，先记录方案与影响，不擅自扩大范围。
7. 按职责把控制器拆为生命周期、输入/剪贴板、输出/渲染等模块；不要仅移动到另一个超长文件。
   对外 mountTerminal / TerminalHandle 行为保持兼容，生产文件尽量 <= 300 行、函数 <= 50 行。

## 可验收证据

- 新增有意义的流控回归：慢消费者、额度耗尽、消费后恢复、旧连接/重复 ack、dispose 与断线恢复。
- 使用受控临时进程/可重复模拟的大输出验证队列预算；保留原有有序输出与输入延迟测试。
- 对“没有丢数据”的断言说明范围：预算内有序；超过既有回放上限时必须验证可见 gap。
- 原有 terminal、prompt 相关前端回归和 Rust terminal 测试通过；附实际命令与结果。
- 压力测试只启动/结束本任务创建的进程，不能关闭正式 Belfry 或现有用户会话。

## 交付

更新 `developer-2-result.md`：具体改动、队列预算与确认协议、压力证据、实际验证、限制。
完成后必须执行 `belfry done <收到的任务号> <摘要>`；真实阻塞时记录状态并 `belfry fail`。
不提交、不推送、不删除用户文件、不修改其他开发的文件。
