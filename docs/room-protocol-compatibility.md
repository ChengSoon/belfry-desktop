# 房间协议升级与验证

房间命令经过 `CLI → 常驻终端后台 → 桌面应用`。新建房间、新建 Agent、重新打开窗口都会复用已有后台；更新磁盘上的程序不等于运行中的后台已经更新。正式版和开发版各有自己的后台，分别位于 `terminal-daemon-v1` 和 `terminal-daemon-v1-dev`。

旧后台按编译时的枚举重编码请求和响应，会拒绝 `roomTask` 等新命令，也会丢掉 `roomSaid.message`、`ask`、`peers.capabilities` 等新字段。前一版能力检查只能拒绝请求，不能恢复通信。

## 修复

- 新后台只验证请求/响应信封，保留业务字段；Ping 返回 `appVersion` 和 `collab_passthrough_v1` 能力，便于检查实际运行的进程。
- CLI 先读取 `peers` 的 `rooms_v1` 能力。缺少标记时，用旧 v1 `taskState` 的字符串字段承载房间协议，先做只读能力探测，通过后提交一次房间命令。
- 应用先鉴权，再解封命令，沿用房间成员权限、任务板、账本和消息投递；兼容外壳不会创建点对点任务，也不接受嵌套封装或 `send` 等其他命令。
- 普通 `wait` 不能把保留的传输字符串当成任务号执行。写入之后的错误回执不会触发切换通道或自动重试。

应用与 CLI 必须一起更新；旧后台仍在托管任务时，兼容通道可恢复房间通信。若要替换运行中的后台进程，需要结束它托管的终端进程。先完成或保存现有 Agent 工作，再关闭旧后台并由对应的新程序重新启动。仅根据协议数字 `1` 不能判断新旧，必须检查能力标记。

## 回归

```sh
cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked
cargo build --manifest-path src-tauri/Cargo.toml --locked -p belfry-desktop
python3 scripts/test-terminal-daemon.py src-tauri/target/debug/belfry-desktop
python3 scripts/test-room-agent-protocol.py src-tauri/target/debug/belfry-desktop
```

`collab::e2e_test` 用真实 CLI、应用协作服务和临时房间存储，分别验证直连、新中继、固定在旧协议的中继：新建房间、任务创建/开工/完成、简报、状态、要求回复、回复和日志，并检查任务与消息只写入一次。

CLI 的兼容回归覆盖旧应用拒绝、探测失败、鉴权错误、回执损坏、禁止重复写入和保留任务号。服务端回归检查外层身份、协议版本及禁止嵌套请求。

两个 Python 脚本在 macOS 的临时目录启动真实后台进程。新 Agent 测试用本地程序替代 Codex、Claude、Pi、Antigravity CLI、OpenCode、Kimi Code，不连接模型或用户房间；检查六种新终端都使用该构建旁的 CLI、新协议无需兼容封装、未来命令及新字段可完整往返。打包后也应使用包内 `belfry-desktop` 再运行这项检查。
