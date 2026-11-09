# 房间项目目录的原生进程验收

T28 的测试基线为 `75250352738e29e259c36a91873ee7d6c6d33df7`，包含 T20/T21。
实现位于 `src-tauri/src/terminal/native_room_project_tests.rs`，复用现有原生测试的事件接收器和串行锁。

在仓库根目录准备 debug CLI，然后只运行本项验收：

```sh
TAURI_ENV_DEBUG=true node scripts/bundle-cli.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked room_project_native -- --nocapture
```

Windows PowerShell 中第一条命令改为先设置 `$env:TAURI_ENV_DEBUG = 'true'`，再执行 `node scripts/bundle-cli.mjs`。
CI 的 `Native room project cwd evidence` 步骤在两平台执行相同的定向测试并保存标准输出日志。

每次测试均创建独立的临时 `app-data/rooms`、探针输出目录，以及含中文和空格的项目 A/B。
真实 `project_open` 解析 B 的 `子目录/..` 输入；`RoomStore::create` 保存 B，重载后再把房间路径交给生产 `NativePtyBackend`。
先启动一个项目 A 对照进程，再顺序启动三名 B 成员，并通过已有房间操作登记三名成员。
macOS 使用无用户配置的 zsh，Windows 使用 `-NoProfile -NonInteractive` PowerShell；二者在真实 PTY 中运行同一测试二进制的短命探针。
探针自行读取 OS cwd、PID、shell PID 和 stdin/stdout 的终端属性，输出 JSON，并写入临时文件；验收要求 PTY 输出与文件一致、实际 cwd 规范化后等于 B，且与 A 对照不同。

日志 `room project native member` 给出每个会话的 PID/cwd、终端属性和退出状态；`persisted` 给出重载后的房间目录与成员数。
`cleanup` 要求已观测到的 shell/探针 PID 全部消失、临时数据和项目均已删除。失败退出也会关闭本测试拥有的 PTY 并尝试清理临时目录。
另一个定向用例先成功选择 B，再删除目录，要求新建返回 `ROOM_PROJECT_NOT_FOUND`，内存房间列表和 `rooms.json` 均不产生记录。
已有房间路径不被改写、文件路径拒绝等行为沿用 T21 的 `rooms::project_path_test` 证据。

该验收覆盖真实项目/房间后端与原生 PTY 执行段。前端选择、`launchInto` 和 `App.launchRoomMember` 的参数连接沿用 T20/T23 的浏览器与单元测试证据；这里没有操作系统文件夹选择器或 WebView，也没有启动第三方 Agent CLI、验证登录或模型通信。
直接调用原生后端，不经 daemon RPC；不会连接用户的 Belfry 会话，子进程会移除继承的 Belfry 连接变量。实际执行平台、PID/cwd 和 CI run 由交付日志记录，不把请求参数或浏览器模拟调用当作进程观测值。
