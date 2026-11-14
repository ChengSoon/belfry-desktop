# Codex / Claude Code 原生终端状态

Belfry 使用 [Program Status Protocol 0.4（OSC 7501）](https://www.superlogical.com/rex/docs/build/program-status) 接收 Codex 与 Claude Code 的状态。CLI 在 PTY 输出中报告状态，原生后台解析并广播结构化快照；这两种 Agent 不再通过状态 Hook、屏幕文字或输出静默时间判断空闲。

## 能力探测与记录

CLI 发出 `ESC ] 7501 ; ? ST` 或 BEL 结尾的查询。后台应答：

```text
ESC ] 7501 ; ?:states=idle,working,done,blocked,error:kinds=permission,question,auth ST
```

Codex 的根记录使用 `app=codex`，Claude Code 使用 `app=claude-code`。只有当前会话 Agent 匹配、没有 `id` 的根记录控制前台状态；子记录不会使收件箱提前发送。有效示例：

```text
ESC ] 7501 ; state=working:app=codex ST
ESC ] 7501 ; state=blocked:app=claude-code:kind=question ST
ESC ] 7501 ; state=idle:app=claude-code ST
```

保存原始 `state`、`kind`、`progress`、Base64 编码的 `title` 与 `msg`。每条根状态更新生成单调递增的序号，快照来源为 `terminal_protocol`。解析支持分片、BEL/ST 终止与 CAN/SUB 取消，限制序列和记录大小。无效报告不生成空闲状态；根记录清除、终端重置或不匹配的根记录使状态未知。

## 消费规则

| 原始状态 | 界面与投递行为 |
| --- | --- |
| `idle` | 就绪；满足输入许可条件后可投递，不触发完成通知 |
| `working` | 正在处理；等待 |
| `blocked` | 等待权限、回答或登录；等待 |
| `done` | 本轮完成；满足输入许可条件后可投递，触发完成通知 |
| `error` | 本轮未完成；等待，触发失败通知 |
| `clear` / 缺少报告 | 等待原生状态；等待，不显示为正在处理 |

提示队列、协作收件箱、房间成员、名册、Git 反馈、工作台、侧栏、终端状态栏、通知与关闭提示从同一原生状态读取。其他 Agent 仍使用各自已有的状态接口。

## 原生输入许可

`idle` 或 `done` 是必要条件。自动投递还必须取得同一个原生输入许可：没有用户草稿、输入法组合输入、粘贴或未决投递，且 PTY 当前支持 bracketed paste。正文冻结后，正文及 Enter 写入前均在 PTY writer 锁内复核报告序号与实际粘贴模式，拒绝过期的许可。

用户输入独立跟踪，空闲报告不会清除草稿。预留粘贴不视为提交；回车实际提交后出现新的 `working` 报告，才确认输入已消费。重连或输出缺口无法证明草稿已清空时，输入保持未知，等待用户重新建立可确认的输入状态。

后台使用独立 `WriteChecked` 命令并声明 `terminal_program_status_v1` 能力。旧后台不支持受检写入时关闭自动投递，不降级成普通写入。明确的零写入拒绝可退回队列；部分写入、I/O 错误或提交回执不确定时暂停，避免自动重贴。

## 后台生命周期与升级

原生状态保存在终端后台会话中，独立于 Hook 缓存，恢复连接时回送最新快照。最终 `done` / `error` 与 Exit 同批到达时仍处理通知。终端查询应答使用有界队列和每会话一个 writer worker，避免输出 reader 等待大段输入写完。

升级应用后应在任务结束时结束并重开旧后台会话，或重启电脑。CLI 未提供匹配的 OSC 7501 报告时，会话显示等待状态且不自动投递；应升级到支持协议的 CLI。设置不再提供 Codex / Claude 的新状态 Hook 安装入口，仍允许预览移除旧的 Belfry 托管 Hook。

回归覆盖解析、原生受检写入、后台恢复、输入占用、提示与收件箱队列、状态展示和通知。主要实现为 `src-tauri/src/terminal/program_status.rs`、`src-tauri/src/terminal/native.rs`、`src/agent/programStatus.ts` 和 `src/terminal/controller/protocolInputOwnership.ts`。
