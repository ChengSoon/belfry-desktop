# Harness H1.4：受控命令执行

日期：2026-09-07。状态：执行基线。

## 目标

为所有 Agent 可用的 Harness 增加宿主工具 `command.exec`。Worker 只提交结构化 executable、argv、相对 cwd、
超时与有限环境请求；宿主完成声明/授权/审批、运行、流式输出、取消和进程树回收。

## 安全不变量

- 必须绑定 system Registry 的不可变 session snapshot、workerId 和 projectRoot；不能直接调用普通终端 API。
- 禁止 shell 字符串、`sh -c`/`cmd /c`/PowerShell command 等绕过；executable 与 argv 分开传输。
- cwd 必须规范化且位于固定项目根；拒绝 symlink 越界、绝对路径、父目录、NUL 和 Windows prefix。
- 环境默认 `env_clear`，只允许宿主白名单键；永不传 API key、token、secret、HOME 或完整宿主环境。
- `command.exec` 必须已声明、获会话授权并持一次性 approval token；执行前再次校验撤权和取消。
- 默认超时 60 秒，最大 10 分钟；stdout/stderr 分开流式发送，各最多 1 MiB，超限截断并标记。
- 每 session 最多 2 个并发命令，全局最多 4 个；超限明确 BUSY，不排无限队列。
- 取消/超时/Worker 崩溃/应用退出必须终止整个进程组或 job object 并 wait/reap，不留孤儿。
- 结果包含 exitCode、signal/terminationReason、duration、truncated，不把命令输出混入错误消息。
- 审计包含 requested、approval.required、started、output、completed/failed/cancelled；输出先做有界处理。

## 首期限制

只允许测试白名单中的仓库假命令/系统无副作用工具，产品级可执行文件 allowlist UI 留后续；不允许网络、Git写、
依赖安装、删除、数据库/CI变更。审批 token 最多100个、10分钟TTL、一次性并绑定完整请求摘要。

## 验收

覆盖 argv空格/元字符不经shell、cwd/symlink越界、环境脱敏、未声明/未授权/撤权、token错误/过期/复用、
正常退出/非零退出、stdout/stderr分离与截断、超时、取消竞态、Worker崩溃、重复取消、并发上限、进程树无遗留。
假 Worker完成 request→approval→started/output→result 往返；两个 Agent 会话互不取消或串输出。

允许 `src-tauri/src/harness/command/**`、`src/harness/**`、假 Worker、最小命令注册和实施文档；不接模型/UI/网络，
不扩 legacy、不改依赖/CI。所有文件≤300行、函数≤50行。运行定向、全量、build、cargo test、diff check。
