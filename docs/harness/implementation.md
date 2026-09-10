# Harness H0.5 Worker Supervisor 实施记录

状态更新（2026-09-09）：用户已取消 Harness 功能。以下为历史实现证据，后续不再扩展；
产品退出与现行验收见 [PI 插件单一方向：P0 收尾任务](../plugins/pi-only-p0-delivery.md)。

日期：2026-09-07。范围：`docs/harness/worker-supervisor-design.md` 的 H0.5，不代表 H1 完成。

## 实际实现

- TS Supervisor：session 独立 sequence；pending 保存 method/session/timer；未知、重复、错 session response 明确失败；close/crash 逐项清理且只失败一次；ID 可注入；close 幂等并拒绝后续发送。
- Rust：1 MiB UTF-8 NDJSON framer；stdout envelope 校验；stderr 64 KiB 有界诊断；串行 stdin；不可复用 ULID；结构化 lifecycle；shutdown 最多等 2 秒后 kill + wait；重复 stop 幂等；应用退出 `close_all`。
- 启动仅允许 `node`/`node.exe` 执行仓库内假 Worker，使用 executable + argv 且不经过 shell；环境 `env_clear`。测试确认空格参数不拆分且不传 HOME/token/secret/API key。
- 最小 Tauri start/send/stop command、单一 `harness-worker` 事件及退出收尾；前端 adapter 按 workerId 过滤事件并映射终态。
- 假 Worker 提供 normal、chunked、invalid-json、invalid-utf8、oversized、invalid-envelope、nonzero、stderr、stubborn 模式，sequence 按 session 计数。

## 10 条验收证据

1. Rust 集成测试完成 initialize、session/start、tool/request、shutdown，并校验有序事件。
2. framer 覆盖分块、多行、CRLF；stderr 测试证明不污染协议。
3. 非法 JSON/UTF-8、超长行和非法 envelope 均成为 `protocol-failed`。
4. exit 7 成为 `unexpected-exit`，宿主随后仍可启动正常 Worker。
5. stubborn Worker 在 2 秒后 `force-terminated`；执行 kill + wait；重复 stop 成功；进程检查无遗留 Worker。
6. TS 测试证明两个 session 均可从 sequence 1 开始，重复/倒退仅影响对应 session。
7. crash/close 清空 pending timer，每项只失败一次，之后拒绝发送。
8. 空格参数保持单 argv，敏感环境未注入；shell 与非仓库 fixture 被拒绝。
9. Rust Harness 11 项、TS Harness 11 项覆盖 framing、生命周期、退出、cleanup、transport/Supervisor。
10. 定向与完整门禁如下。

## 实际命令与退出码

- `pnpm exec vitest run src/harness/supervisor.test.ts`：1（预期红灯，6 项中 5 项失败）。
- 同命令实现后首次：1（测试期望数修正前剩 1 项失败），修正后纳入定向测试通过。
- `pnpm exec vitest run src/harness/supervisor.test.ts src/harness/tauriTransport.test.ts`：0（8 项）；同批首次 `pnpm build`：1（测试 bridge 泛型不兼容，已修复）。
- `pnpm exec vitest run src/harness`：0（4 文件、11 项）。同一 shell 误在仓库根运行 `cargo test harness:: --lib`：101（无根 Cargo.toml），随后在 `src-tauri` 重跑。
- `cargo test harness:: --lib`（`src-tauri`）：0（11 项）。
- `pnpm test`：0（62 文件、495 项）。
- `pnpm build`：0（成功；有既有 bundle >500 kB 提示）。
- `cargo test`（`src-tauri`）：0（lib 290 通过、4 ignored；集成 1 通过）。warning 来自既有 legacy plugin 未使用代码。
- `ps aux | rg '[s]cripts/harness/worker\\.mjs' || true`：0，无输出。

## 自审与边界

- 改动保持在允许目录和 `src-tauri/src/lib.rs` 最小接线内；未修改根依赖/配置、CI、Provider、AgentKind、Prompt、Recipe、协作协议或 Git 历史。
- `lib.rs` 原先已有未提交 legacy `mod plugins` / `plugins_list`；本次未新增或扩展 legacy plugins，仅增量加入 Harness state/commands/退出收尾。
- IPC 不能启动任意 manifest command，符合 H0.5 假 Worker 边界。终态由 mutex 保证只从 running 收敛一次；终止路径 wait/reap。
- 未发现任务范围内失败门禁或遗留测试进程。

## 未验证

- Windows 真实进程冒烟未验证；macOS 测试不能替代 Windows 证据。
- 未执行真实 Tauri WebView 桌面交互冒烟；IPC 由 Rust 编译、完整 cargo test 与 adapter 单测覆盖。
- 未接真实模型、broker、项目写入、凭证、产品 UI 或安装签名链；不得声称 H1 完成。

## 项目经理审查修正（2026-09-07）

- 将原 662 行 `manager.rs` 按职责拆为 `manager.rs`（226 行）、`process.rs`（192 行）、`validation.rs`（79 行）、`types.rs`（62 行）及 `manager_tests.rs`（215 行）；Harness Rust 生产文件均不超过 300 行，逐函数复核均不超过 50 行。
- registry 改为 active map + 有序 tombstone。正常 shutdown、cancel exit、异常 exit、协议失败和强制终止到达终态时立即移除 active 实例，释放 `Child`/stdin 等持有关系。
- 为保留重复 `stop` 幂等语义，仅保存最近 256 个 stopped ID；超出时 FIFO 淘汰。因此 registry 空间上界为“当前活跃 Worker 数 + 256 个短 ID”，不会随历史 Worker 数无限增长。
- 先新增 `terminal_workers_leave_active_registry_and_keep_idempotent_stop` 与 `stopped_tombstones_are_bounded`；首次定向编译退出码 101（缺少预期清理接口），实现后通过。
- 审查修正后的 `pnpm exec vitest run src/harness`：退出码 0（4 文件、11 项）；`cargo test harness:: --lib`：退出码 0（11 项）。
- 完整复验：`pnpm test` 退出码 0（62 文件、495 项）；`pnpm build` 退出码 0（仅既有 bundle 大小提示）；`cargo test` 退出码 0（lib 290 通过、4 ignored，集成 1 项通过）。Rust warning 仍仅来自既有 legacy plugin 未使用代码。

## H1.1 只读 Capability Broker（2026-09-07）

- Rust 宿主新增内存 session registry，注册时固定 workerId、规范项目根、Harness ID/version、声明工具和临时授权；同 session 不能覆盖绑定。检查顺序为 session、worker、声明、授权、参数、取消/并发、执行。
- 临时授权更新同步写入宿主事实；获取并发 permit 后、文件访问前再次检查撤权与取消，确定性竞态测试证明已排队调用不能沿用旧授权。
- `project.list` 限 1000 项并返回 truncated；`project.read` 限 512 KiB，二进制只返回 path/size/binary 元数据和 null content。覆盖精确 UTF-8 边界、超限、缺失及目录误读。
- 从 `project/files.rs` 提取唯一 `project/resource_path.rs`，普通 preview 和 Broker 共用绝对路径、`..`、NUL、Windows prefix、canonical root、symlink 越界及执行后复检逻辑，无复制实现。
- 每个逻辑调用产生 requested 后恰好一个 completed/failed 审计事件，携带 session/request/tool ID、耗时、有界摘要和稳定错误码；错误文本不含项目根或外部绝对路径。
- 每 session 最多 8 个并发只读调用，额外调用返回 BUSY；取消后新调用返回 SESSION_CANCELLED，permit Drop 保证所有成功/失败路径归还额度。
- 新增窄 Tauri register/update-grants/cancel/handle 命令和 `harness-broker-audit` 事件。TS Broker client 识别 Worker `tool/request`、调用宿主 Broker 并回写 RPC result/error；假 Worker `broker-request` 模式覆盖真实请求/结果往返。
- 所有新增/修改源文件均 ≤300 行，函数均 ≤50 行；未引入依赖或 H1.1 边界外能力。

### H1.1 验证记录

- Broker 首轮定向：`cargo test harness::broker --lib` 退出码 101（fixture 在断言前被提前 drop，5 通过、1 失败）；修正后退出码 0。
- `pnpm exec vitest run src/harness`：退出码 0（5 文件、14 项）。
- `cargo test harness:: --lib`：退出码 0（20 项）；`cargo test project:: --lib` 与另一 Cargo 进程并行时首次退出码 101（macOS 临时目录清理竞争），独立原命令复跑退出码 0（7 项）。
- `pnpm test`：退出码 0（63 文件、498 项）；`pnpm build`：退出码 0（仅既有 bundle >500 kB 提示）。
- `cargo test`：退出码 0（lib 300 通过、4 ignored；集成 1 项通过）。warning 仍来自既有 legacy plugin 未使用代码。
- H1 仍未完成；Windows 真实进程与桌面 WebView 冒烟仍未验证。本阶段未实现模型、写文件、命令、UI、Provider 或持久授权。

## H1.3 系统级插件 Registry（2026-09-07）

- 新增 Harness 专属系统 Registry：安装定义由宿主单 owner 管理，revision 使用原子临时文件提交并进行陈旧 revision 冲突检测。
- 发现规则固定为 `trusted + compatible + enabled`；不兼容或不可信插件对所有 Agent 一致不可运行。
- 新会话创建不可变 snapshot，固定 pluginId/version/manifestDigest、Worker、项目根和会话授权；更新/禁用/卸载只影响新会话，旧 snapshot 保留历史只读且不可恢复执行。
- 会话授权存储在独立 session map；两个 Agent 可共享同一插件定义但不共享 Worker、项目根、权限或 token 状态。
- 新增最小 Tauri Registry/session 命令接线；未接 UI、模型、命令、市场或持久授权，未扩展 legacy plugins。

### H1.3 验证记录

- `cargo test harness::registry --lib`：退出码 0，3 项通过；覆盖跨会话隔离、更新固定版本、卸载后历史只读、陈旧 revision 冲突与一致发现。
- Registry 新增生产文件均小于 300 行，函数保持小于 50 行。
- 初版完整 `pnpm test/build` 与 `cargo test` 均通过；退修后的最终结果见下。

### H1.3 项目经理退修

- Registry 初始化不再用损坏/权限错误回退空库：保留稳定错误状态，所有读写返回 `STORE_INVALID`/`STORE_READ_FAILED`，不会覆盖原件。
- 每次写操作先取得 Registry owner 锁，再从磁盘重读并比较 revision；两个独立 `SystemRegistry` 实例的陈旧写确定性返回 `REVISION_CONFLICT`，不会丢更新。Unix 使用 OS `flock`，Windows 使用有界独占 owner 文件。
- session snapshot 和会话授权随 Registry 原子持久化，重启后历史仍可只读；卸载将对应 snapshot 标记为不可恢复执行。版本历史 FIFO 上限为 100，避免长期无界增长。
- 兼容检查改为严格三元 SemVer 核心解析，非法段、缺段或多段一律不兼容，不再以最大值放行。
- 退修定向 `cargo test harness::registry --lib`：退出码 0，7 项通过；覆盖损坏库保护、双实例冲突、重启 snapshot、历史上界及非法版本。
- 最终 `cargo test harness:: --lib`：退出码 0，34 项通过；`cargo test project:: --lib`：退出码 0，7 项通过。
- 最终 `pnpm test`：退出码 0，63 文件/498 项；`pnpm build`：退出码 0（仅既有 bundle 大小提示）。
- 最终 `cargo test`：退出码 0，lib 314 项中 310 通过、4 ignored，集成 1 项通过；warning 仍来自既有 legacy plugins。
- `cargo fmt --check` 与 `git diff --check`：退出码 0；Registry 文件最大 259 行，均小于 300 行。

## H1.2 补丁预览与受控写入（2026-09-07）

- 新增 `project.patch.propose`/`project.patch.apply` 宿主能力：propose 零写盘，固定 session/worker/path/digest/generation；preview 最多 100 个、10 分钟 TTL；approval token 为随机一次性凭证。
- apply 前重新校验声明、`project.write` 授权、取消状态、规范路径及内容 digest；同路径锁保证并发冲突返回 `WRITE_CONFLICT`。目标文件必须是项目根内既有 UTF-8 普通文件且不超过 512 KiB。
- 写入使用同目录 `create_new` 临时文件、同步、继承权限、原子 rename，并在失败路径清理；rename 前再次 canonicalize，阻断 symlink 竞态越界。审计覆盖 `patch.proposed`、`approval.required`、`tool.started`、`tool.completed/failed`，摘要不含 replacement 正文。
- 假 Worker 增加 `patch-roundtrip` 请求模式；Patch Broker 单测覆盖 propose/approve/apply 完整语义、撤权/取消、digest 冲突、预览上界、路径锁、symlink 竞态、临时文件清理和审计脱敏。已有 manager 假 Worker 测试覆盖真实子进程 NDJSON 请求/响应往返；Patch Broker 链路通过宿主命令接口验证。

### H1.2 验证记录

- `cargo test harness::patch --lib`：0（7 项）；期间首次补测因 env-clear 后 Node 子进程未稳定产出首帧而撤回，未保留不稳定测试。
- `cargo test project:: --lib`：0（7 项）。
- `pnpm exec vitest run src/harness`：0（5 文件、14 项）。
- `pnpm test`：0（63 文件、498 项）；`pnpm build`：0（仅既有 bundle 大小提示）。
- `cargo test`：0（lib 307 通过、4 ignored；集成 1 项通过）。
- `wc -l` 复核：H1.2 生产文件均 ≤300 行，`patch/tests.rs` 为 299 行；函数抽查 ≤50 行。
- `ps -axo pid=,comm=,args= | awk '$2 ~ /node/ && $0 ~ /scripts\/harness\/worker.mjs/'`：无输出，无遗留假 Worker。

### H1.2 未验证与自审

- Windows 原子 rename 语义、真实 Tauri WebView 交互和安装签名链未验证；macOS cargo/单测不能替代这些证据。
- 未接 UI、模型、命令执行、持久授权或 legacy plugins；未新增依赖、根配置、CI 或 Git 操作。H1 仍未完成。

## H1.4 受控命令执行（2026-09-07）

- 新增独立 `command.exec` Broker，Worker 仅提交 `executable`、`argv`、相对 `cwd`、`timeoutMs` 和有限 `env`；宿主拒绝 shell、绝对/父级/Windows prefix/NUL cwd，并复用项目资源路径的 canonical/symlink 边界检查。
- 每次请求绑定 system Registry 的不可变 session snapshot、workerId、声明工具和临时 `command.exec` 授权；请求阶段与执行阶段各校验一次，撤权或取消后不可沿用已批准 token。
- 审批记录最多 100 个、TTL 10 分钟；token 随机、一次性并绑定完整请求记录，错误 token 同样消费记录。每 session 最多 2 个、全局最多 4 个在途命令，超限直接 `BUSY`。
- 子进程 `env_clear`，仅允许 `LANG`、`LC_ALL`、`TZ`；首期 executable allowlist 限 `echo`、`printf`、`true`、`false`、`sleep`。stdout/stderr 独立读取，各保留最多 1 MiB，并分别标记截断。
- Unix 子进程使用独立 process group，超时、取消、Worker 终态和应用退出均 kill group 后 wait/reap；Windows 使用新 process group 并通过 `taskkill /T /F` 回收整棵树。结果包含 exitCode、signal、terminationReason、duration 和双流截断状态。
- 审计覆盖 `requested`、`approval.required`、`started`、`output`、`completed/failed/cancelled`；输出摘要先限为 4096 字符，不混入错误消息。Harness runtime 在 Worker 崩溃/退出与应用退出时联动取消命令。
- TS `CommandClient` 完成 Worker tool request → 宿主审批 → execute → RPC result/error 路由；假 Worker `command-roundtrip` 覆盖 request → approval → started/output（宿主审计）→ result → `command.completed` 往返。

### H1.4 定向证据与限制

- TDD 首轮取消竞态测试退出码 101：进程被 kill 后先观察到 exited；调整判定顺序后通过。
- `cargo test harness::command --lib`：退出码 0，11 项；`cargo test fake_worker_command_request_completes_full_round_trip --lib`：退出码 0，1 项。
- `pnpm exec vitest run src/harness`：退出码 0，6 文件/17 项（完整门禁结果见本节后续交付记录）。
- 未在 Windows 真机验证 process group/taskkill 行为，macOS 单测不能替代 Windows 证据；未接 UI、模型、网络、产品 executable allowlist 或持久授权。
- 最终 `pnpm test`：退出码 0，64 文件/501 项；`pnpm build`：退出码 0（仅既有 bundle >500 kB 提示）。
- 最终 `cargo test` 沙箱内首次退出码 101：324 通过、2 个既有 Unix socket 测试被沙箱拒绝；允许本机 socket 后原命令复跑退出码 0，lib 326 通过/4 ignored、集成 1 项通过。
- 最终 `cargo fmt --all --check` 与 `git diff --check`：退出码 0；H1.4 生产文件最大 268 行，均小于 300 行。

## H0.5 当前工作区复核（2026-09-07）

- 复核范围：TS Supervisor 的 session sequence、pending cleanup、确定性 request ID；Rust NDJSON framing、Worker 生命周期/退出分类/registry cleanup；Tauri transport 与命令事件桥；假 Worker 故障模式及清理集成。
- 未发现 H0.5 尚缺的实现或回归；当前代码未扩展 `src/plugins/**` 或 `src-tauri/src/plugins/**`。
- `pnpm exec vitest run src/harness`：退出码 0（6 文件、17 项）。
- `cargo test harness:: --lib`（`src-tauri`）：退出码 0（46 项通过）。
- `pnpm test`：退出码 0（64 文件、501 项）。
- `pnpm build`：退出码 0；仅既有单 bundle >500 kB 提示，非本任务新增 warning。
- `cargo test`（`src-tauri`）：退出码 0（327 lib 通过、4 ignored；集成 1 项通过）。
- `cargo fmt --all --check`、`git diff --check`、`cargo check --lib`：退出码 0；未观察到新增 Rust warning。
- `ps -axo pid=,comm=,args= | awk '$2 ~ /node/ && $0 ~ /scripts\/harness\/worker.mjs/'`：无输出，无遗留假 Worker。

### 本次复核未验证

- Windows 真实进程/`taskkill` 冒烟、真实 Tauri WebView 桌面交互仍未验证；macOS 测试不能替代这些证据。
- 未接真实模型、工具、项目写入、凭证、产品 UI 或安装签名链；H1 仍未完成。

## H1.1 当前任务复核（2026-09-07）

- 按 `read-capability-broker-design.md` 复核并补齐重复请求保护：相同 `session/request/tool/params` 成功请求只允许一个审计生命周期；重复提交明确返回 `INVALID_PARAMS`，不重复访问文件或发出终态事件。
- 保持 Rust/Tauri 唯一 owner；路径解析继续复用 `project/resource_path.rs`，拒绝 `..`、绝对路径、Windows prefix、NUL 与 symlink 越界；list/read 容量、UTF-8、二进制和错误脱敏语义不变。
- 修改文件：`src-tauri/src/harness/broker/mod.rs`、`src-tauri/src/harness/broker/tests.rs`、`docs/harness/implementation.md`。未修改 legacy plugins、根依赖、CI、数据库或 Git 历史。
- 新增失败测试 `duplicate_request_id_has_one_audit_lifecycle`：首次运行因缺少去重保护失败，加入实现后通过。
- `cargo test harness::broker --lib`：退出码 0（9 项）；`cargo test project:: --lib`：退出码 0（7 项）。
- `cargo test harness:: --lib`：退出码 0（47 项）；`pnpm exec vitest run src/harness`：退出码 0（6 文件、17 项）。
- `pnpm test`：退出码 0（64 文件、501 项）；`pnpm build`：退出码 0，仅既有 bundle >500 kB warning。
- `cargo fmt --all --check`、`git diff --check`：退出码 0；未观察到新增任务相关 warning。
- 未发现遗留假 Worker。Windows 真实进程、Tauri WebView 桌面交互、安装签名链仍未验证；H1 仍未完成。

## H1.5 产品集成准备审计（2026-09-07）

### 本次实现

- 新增独立 `HarnessRegistryClient`，覆盖系统 Registry list/install/update/disable/uninstall，以及 session snapshot/authorize；对 IPC 返回的 registry/session 基本结构做运行时校验，不直接信任未知宿主值。
- 新增 client 单测，验证所有已注册 Tauri command 的参数映射、snapshot 后授权更新和畸形 IPC 状态拒绝。
- Rust 命令注册核对完成：Worker start/send/stop、Broker register/update-grants/cancel/handle、Patch propose/approve/reject/apply、Registry 管理与 session snapshot/authorize、Command request/approve/reject/execute/cancel 均已在 `src-tauri/src/lib.rs` 注册。

### 按依赖排序的最小实施包

1. **前端能力 client 完整化**：新增 `src/harness/patchClient.ts` 与测试，补齐 propose → 用户审批 → apply/reject 的稳定错误映射；复用现有 `BrokerClient`、`CommandClient`。影响仅 `src/harness/**`。
2. **独立 session runtime**：新增 `src/harness/sessionRuntime.ts` 与测试，固定顺序为 Registry snapshot → Broker register/grants → Worker initialize/session start；Worker `tool/request` 按 read/patch/command 分派；cancel/crash/close 同步收敛 Broker、Command 与 Worker。影响 `src/harness/**`；需要先明确 patch Worker envelope 契约。
3. **系统级管理入口**：在 `src/settings/SettingsPanel.tsx` 增加 Harness Registry section，展示 trusted/compatible/enabled、revision 冲突和 install/update/disable/uninstall；预计新增 `src/harness/components/RegistrySection.tsx` 与局部样式。该包会修改 Settings，按本任务边界未实施。
4. **Agent 会话集成**：在新会话入口选择 Harness/plugin，启动 Worker 后创建不可变 snapshot，并展示 grants/cancelled/resumable；预计影响 `src/components/Workbench.tsx`、workspace/new-session 组件、相关 props/state。该包涉及产品共享状态，按边界未实施。
5. **授权与审批 UI**：把 session capability grants、patch approval、command approval 接入统一产品对话框与审计展示；预计影响 App overlays/共享 props/types。该包必须先确定拒绝、撤权、恢复和窗口关闭语义，按边界未实施。
6. **真实产品 Worker 信任边界**：当前 H0.5 start 只允许仓库假 Worker；Registry `source` 尚不能安全解析为已安装 executable/argv。需要 Rust 新增从受信 Registry definition 到可执行入口的宿主解析，禁止前端提交任意路径；不得引入模型或凭证。此项是产品可用链路的后端前置阻塞。

### 当前真实串通状态

- 单项 IPC 与单元/集成测试已存在，但产品链路尚未串通：Registry snapshot 不会自动注册 ReadBroker；Registry authorize 不会自动同步 `harness_broker_update_grants`；Worker transport 未组合 Broker/Patch/Command router；产品 session 生命周期未调用这些 client。
- `BrokerClient` 可路由 `project.list/read`，`CommandClient` 可完成 command approval/execute；Patch 仅有 Rust commands，没有前端 route client。
- Settings 无系统 Registry 管理入口；Agent 新会话无 Harness 选择、授权状态或 Worker 生命周期 owner。

### 验证与限制

- `pnpm exec vitest run src/harness`：退出码 0（7 文件、20 项）。
- 首次 `pnpm build`：退出码 1（新增测试 mock 推断为零参数 tuple）；修正 mock 签名后 `pnpm build`：退出码 0，仅既有 bundle >500 kB warning。

## H1.5 最小实施包 1：Patch Client（2026-09-07）

- 新增 `src/harness/patchClient.ts` 与测试，并在 `protocol.ts` 明确 Worker patch envelope：
  - propose：`tool/request` 携带 `toolId/tool/relativePath/expectedDigest/replacement`；宿主完成 propose 与用户确认，批准时响应 `PatchPreview + approvalToken`，拒绝时先调用 reject 再返回 `APPROVAL_DENIED`。
  - apply：后续 `tool/request` 携带 `toolId/tool/previewId/approvalToken`；宿主 apply 成功响应 `result: null`，失败响应 JSON-RPC error。
- client 对相同 `sessionId/requestId/toolId` 只发送一个终态 envelope；覆盖成功、用户拒绝、token 无效/过期/复用对应错误、`WRITE_CONFLICT`、取消、撤权、畸形 IPC preview 与重复终态。
- 对允许透传的稳定错误码重新生成固定安全文案，不透传 Rust/IPC 原始 message，避免绝对路径或内部诊断泄露；未知错误统一为 `PATCH_FAILED`。
- 修改文件：`src/harness/patchClient.ts`、`src/harness/patchClient.test.ts`、`src/harness/protocol.ts`、`docs/harness/implementation.md`。未修改产品 UI、共享状态、legacy plugins、根依赖、CI 或 Git。
- 首次完整定向加 build：测试退出码 0（8 文件、29 项），build 退出码 1（`unknown` narrowing 在数组回调内丢失）；固定局部 `params` 后复验如下。
- `pnpm exec vitest run src/harness`：退出码 0（8 文件、29 项）。
- `pnpm build`：退出码 0，仅既有 bundle >500 kB warning；`git diff --check`：退出码 0。
- 下一包（独立 `sessionRuntime`）已具备 envelope/client 前置条件；仍需在实现中明确 Registry authorize 与 ReadBroker grants 双写顺序、失败回滚，以及 crash/cancel 时 Broker/Command/Worker 的幂等收敛。该包可继续限定在 `src/harness/**` 并用依赖注入测试，不需要先改产品 UI。

## H1.5 最小实施包 2：Session Runtime（2026-09-07）

- 新增纯编排 `HarnessSessionRuntime`：Worker start → Registry snapshot → Registry authorize → Broker register → Broker grants 同步 → initialize/session start；启动期间 Worker 消息排队，任一阶段失败均关闭 Worker。
- 授权双写固定 Registry 优先、Broker 后同步。Broker 同步失败进入显式 `reconcile-required`，立即取消宿主能力并关闭 Worker，不返回授权成功；关闭状态拒绝后续授权与 tool request。
- Worker `tool/request` 依次分派 `BrokerClient`、`PatchClient`、`CommandClient`；未知工具与错 session 返回稳定 JSON-RPC error；`session/request/tool` 重复请求只产生一个终态。
- cancel/crash/close 共享幂等收尾：Broker cancel、Command cancel 与 Supervisor/Worker close 只执行一次；Supervisor 负责清理 pending timer 并逐项失败。Patch 无独立运行进程，其 apply 会经 Broker/Registry session 状态再次校验。
- 测试覆盖启动成功，snapshot/authorize/register/grants 阶段失败，三类工具路由，未知及重复 request，授权同步失败，cancel/crash/close 竞态、关闭后拒绝和两个 session 隔离。
- 修改文件：`src/harness/sessionRuntime.ts`、`src/harness/sessionRuntime.test.ts`、`docs/harness/implementation.md`。未修改 UI、共享状态、legacy plugins、根依赖、CI 或 Git。
- `pnpm exec vitest run src/harness`：退出码 0（9 文件、37 项）。
- `pnpm test`：退出码 0（67 文件、521 项）。
- 首次 `pnpm build`：退出码 1（测试 mock 的动态索引/零参数 tuple 类型问题）；修正测试类型后退出码 0，仅既有 bundle >500 kB warning。
- `git diff --check`：退出码 0。
- 包 3 最小接入文件：`src/settings/SettingsPanel.tsx`、新增 `src/harness/components/RegistrySection.tsx` 及局部样式/测试。风险是 Registry revision 冲突提示、trusted/compatible/enabled 状态表达和安装 source 输入边界；不得允许 UI 直接提供任意 executable/path。若需要把选择传入 Agent 会话，还会影响 Workbench/new-session props，应拆到后续包而非包 3 扩张。
- `git diff --check`：退出码 0。未观察到新增任务相关 warning。
- 修改文件：`src/harness/registryClient.ts`、`src/harness/registryClient.test.ts`、`docs/harness/implementation.md`。
- 未修改 App/Workbench/Settings、共享 props/types、Provider/AgentKind、legacy plugins、根依赖、CI、数据库或 Git 历史。
- Windows、真实 Tauri WebView、安装/签名/受信 Worker 启动和完整产品交互仍未验证；H1 仍未完成。

## H1.5 最小实施包 3：Registry 设置入口（2026-09-07）

- Settings 新增 Harness 分类与独立 `RegistrySection`，展示 system Registry revision、插件 ID/version、trusted/compatible/enabled 和 capability 列表；具备 loading/error/empty/busy 状态，并在 720px 以下切为单列。
- disable/uninstall 使用明确确认文案并携带当前 revision；稳定 `REVISION_CONFLICT` 会提示并重新读取，避免继续展示陈旧状态。
- 安全来源链尚未建立，故未开放 install/update 输入；更新按钮置灰并明确“产品安装入口待信任链”“列表定义不代表已可运行”。UI 不接受 executable、argv 或任意路径。
- 使用语义 section/list/button、`aria-live`、`role=alert` 和可见 focus ring；颜色复用现有主题变量，支持亮暗主题与设置页纵向滚动。
- 修改文件：`src/settings/SettingsPanel.tsx`、`src/harness/components/RegistrySection.tsx`、`src/harness/components/registrySection.css`、`src/harness/components/RegistrySection.test.ts`、`docs/harness/implementation.md`。未改 App/Workbench/shared types、legacy plugins、依赖、CI 或 Git。
- `pnpm exec vitest run src/harness`：退出码 0（10 文件、40 项）；行为测试覆盖状态映射、兼容判断、revision conflict 和危险操作确认文案。
- `pnpm test`：退出码 0（68 文件、524 项）；`pnpm build`：退出码 0，仅既有 bundle >500 kB warning；`git diff --check`：退出码 0。
- 包 4 最小文件：`src/workspace/components/NewSessionMenu.tsx`（选择入口）、`src/components/Workbench.tsx`（每个 tab 的 runtime owner）、新增 `src/harness/sessionState.ts`/测试（idle/starting/running/reconcile-required/failed/closed、snapshot、grants）。若要求持久恢复选择，还需改 `src/workspace/contracts.ts`，应先决定只做内存态或持久态。
- 包 4 风险：Registry `source` 目前不能作为 executable；需先有 Rust 受信入口解析，否则只能展示“已选择但不可启动”。还需明确 tab close 与 Harness cancel owner、旧 snapshot resumable 语义，以及 grants 双写失败后的 reconcile UI。

## H1.5 受信 Worker 启动入口（原最小包 6，2026-09-07）

- 新增 Registry 私有 source 解析：仅接受 `managed:<relative-path>`（Registry 同目录的 `installations/` 根内）或固定 `fixture:worker.mjs` 白名单；拒绝绝对路径、`..`、缺失、目录、symlink 越界和 Unix group/world-writable 文件。
- 启动前从磁盘重读 Registry，按 session snapshot 的 pluginId/version/manifestDigest 在当前定义或有界历史中精确匹配；复核 trusted/compatible/enabled、cancelled/resumable 和完整 snapshot 内容。更新不会偷换旧会话版本，卸载或禁用后不可启动。
- source 文件内容必须为 UTF-8 且 FNV digest 与 snapshot/安装定义一致；失败使用稳定脱敏错误，不返回宿主绝对路径。
- 新增窄命令 `harness_session_worker_start(sessionId) -> workerId`。前端不能提交 executable/argv；宿主生成固定 `node + [resolved script]` 并通过 `Command::new().args()` 启动，不经过 shell，Worker ID 使用 snapshot 固定值且不可复用。
- `TauriWorkerTransport.startSession(sessionId, ...)` 先监听事件再调用窄命令，避免启动早期事件丢失；包 4 可直接将其作为 `HarnessSessionRuntime.startWorker` 工厂。`HarnessRegistryClient.startSessionWorker` 也提供纯命令 client，但产品 transport 应优先使用前者保持监听顺序。
- 测试覆盖未信任/禁用/不兼容、snapshot 篡改、版本更新固定、卸载、绝对/父路径、缺失、digest、symlink、目录、权限、双 session Worker ID 隔离和真实假 Worker 启停。
- 修改文件：`src-tauri/src/harness/registry/launch.rs`、`registry/{mod,commands,tests}.rs`、`manager.rs`、`validation.rs`、`harness/mod.rs`、`src-tauri/src/lib.rs`、`src/harness/{registryClient,registryClient.test,tauriTransport,tauriTransport.test}.ts` 与本文档。未接模型、凭证、网络、legacy plugins、依赖、CI 或 Git。
- `cargo test harness:: --lib`：退出码 0（53 项）；`cargo test project:: --lib`：退出码 0（7 项）。
- `cargo test`：退出码 0（334 lib 通过、4 ignored；集成 1 项通过）；`cargo fmt --all --check`：退出码 0，无新增 Rust warning。
- `pnpm exec vitest run src/harness` 最终：退出码 0（10 文件、42 项）；`pnpm test`：退出码 0（68 文件、525 项）；`pnpm build`：退出码 0，仅既有 bundle >500 kB warning；`git diff --check`：退出码 0。
- Windows ACL/可执行来源权限未做真机验证；当前 Unix 权限门禁不能替代 Windows 安装根 ACL 验证。真实签名安装/升级事务仍未实现。

## H1.5 最小实施包 4：Agent 会话集成（2026-09-07）

- 修正受信启动编排顺序：前端先生成不可复用 session/worker ID，创建 Registry snapshot、authorize 并注册 Broker，之后通过 `TauriWorkerTransport.startSession(sessionId)` 启动；宿主返回 workerId 必须与 snapshot 一致才进入 running。启动前失败不会产生 Worker，启动后失败统一 close/cancel。
- 新增 `sessionState.ts` 与 coordinator/hook：候选仅保留 trusted+enabled+harnessApi=1+minAppVersion compatible；Harness runtime 按 tabId 存于独立内存 Map，两个会话隔离；tab/项目关闭通过 close/retain 幂等清理，组件卸载清空全部 runtime。reload 不读取 workspace 持久化状态，因此不会自动重放 Worker。
- New Session 菜单为每个可用 Agent 展示可选 Harness plugin/version；普通 Shell、SSH 和无 Harness Agent 入口保持原行为。Harness 必须先完整启动，再创建 Agent tab；tab 创建失败会关闭 runtime，不留下半活 tab/Worker。
- Workbench 对活动 Harness tab 展示 plugin/version、grants、runtime、cancelled/resumable；`reconcile-required` 使用明确警示边框。状态不写入 `WorkspaceTab`，未修改 AgentKind/shared workspace contract。
- 当前 package 5 审批 UI 未接，因此 Patch/Command confirm 默认安全拒绝；read 工具也因初始 grants 为空而默认拒绝。不得把“Worker running”解释为已授权能力。
- 修改文件：`src/harness/sessionState.ts`、`sessionState.test.ts`、`sessionRuntime.ts`、`sessionRuntime.test.ts`、`src/workspace/components/{NewSessionMenu,Sidebar}.tsx`、`src/components/{Workbench.tsx,workbench.css}`、`src/App.tsx` 与本文档。
- TDD 首轮因受信启动顺序变化有 4 项旧回滚断言失败：snapshot/Broker 阶段 Worker 尚未创建，修正为断言 transport close 零调用；同时修复 hook ref 初始化类型。
- `pnpm exec vitest run src/harness`：退出码 0（11 文件、46 项）；覆盖无插件/候选过滤、成功启动与失败回滚、双会话隔离、close/retain、reload 空态及既有 reconcile/cancel/crash 语义。
- `pnpm test`：退出码 0（69 文件、530 项）；`pnpm build`：退出码 0，仅既有 bundle >500 kB warning；`git diff --check`：退出码 0。
- `cargo test`：退出码 0（334 lib 通过、4 ignored；集成 1 项通过）；`cargo fmt --all --check`：退出码 0，无新增 Rust warning。
- 包 5 最小接口：`HarnessApprovalState = { queue: ApprovalItem[]; active?: ApprovalItem }`；`ApprovalItem` 为 `{ kind: "patch"; preview; request; resolve(boolean) } | { kind: "command"; approval; request; resolve(boolean) }`。PatchClient/CommandClient 的现有 async `confirm` 回调负责入队并等待 resolve；UI 只返回 allow/deny，不接触 approvalToken。另订阅 `harness-patch-audit`/`harness-command-audit` 形成只读事件流，按 sessionId 过滤后更新 active tab 状态。

## H1.5 最小实施包 5：统一授权与审批 UI（2026-09-07）

- 新增 `ApprovalQueue`，统一 capability、patch、command 三类结构化审批；公开 view 与私有 resolver/timer 分离，每项只 resolve 一次。拒绝、弹窗关闭、超时、session close、Worker crash 和 app unmount 均默认拒绝；按 sessionId 失效，不影响其他会话。
- capability 在 snapshot/start 前审批，允许后才把插件声明 capabilities 写入 Registry/Broker；新增显式撤权按钮，成功清空 grants，双写失败展示 `reconcile-required` 并停止伪报成功。
- Patch UI 仅展示 relative path、`-oldLines/+newLines`、final bytes 和截短 replacement digest，不持有 approval token，不展示 replacement 正文；Command 展示 executable、逐项 argv、cwd、timeout 和 env 键名，不展示 env 值。token 仍只在 PatchClient/CommandClient 内完成 approve/apply/execute。
- AppOverlays 最小接入 `ApprovalDialog`；关闭/Escape/点外默认拒绝，默认焦点在拒绝，卸载恢复原焦点。面板 max-height 可滚动，720px 下切单列，复用亮暗主题变量。
- 修改文件：`src/harness/{approvalState,approvalState.test,sessionState,sessionState.test}.ts`、`src/harness/components/{ApprovalDialog.tsx,approvalDialog.css}`、`src/components/{AppOverlays,Workbench}.tsx`、`src/components/workbench.css`、`src/App.tsx` 与本文档。只新增局部 optional props；未改 AgentKind、Provider、持久 schema、legacy plugins、依赖、CI 或 Git。
- TDD 覆盖批准/拒绝/重复点击、关闭/过期、双 session 隔离、env 脱敏、撤权与 reconcile；既有 Patch/Command/SessionRuntime 测试继续覆盖取消、crash、重复终态和 token 私有执行。
- `pnpm exec vitest run src/harness`：退出码 0（12 文件、51 项）；`pnpm test`：退出码 0（70 文件、535 项）。
- `pnpm build`：退出码 0，仅既有 bundle >500 kB warning；`git diff --check`：退出码 0。
- `cargo test`：退出码 0（334 lib 通过、4 ignored；集成 1 项通过）；`cargo fmt --all --check`：退出码 0，无新增 Rust warning。

### H1 集成自审与剩余缺口

- 尚无真实签名安装/升级/回滚事务；`managed:` 文件目前依赖宿主安装根与 digest/权限校验，但 UI install/update 仍应保持禁用。
- Patch 宿主当前只返回结构元数据，UI 尚不能展示逐行 diff 正文；若产品要求内容 diff，应由 Rust 返回有界、脱敏、不可编辑的 diff hunks，不能让 UI自行读取文件或信任 Worker replacement。
- 审计事件尚未汇入持久可浏览的产品审计面板；当前只有 Tauri event 与单元测试证据。
- Windows ACL、process tree、原子替换、真实 WebView 焦点/滚动及 720×480 桌面冒烟未验证；macOS 测试不能替代。
- 尚未接真实模型/provider/凭证/网络能力，H1 不能视为完整产品发布。下一建议阶段：H1.6 安装信任链与宿主管理的 artifact transaction，其后再做真实桌面 E2E/Windows 验收。

## H1.7 宿主有界 Diff 预览（2026-09-07）

- Rust `PatchBroker` 现在从旧内容与 replacement 计算结构化 diff hunks，返回行号、context/add/delete、hunk 起点及截断元数据；Worker/前端不能伪造 hunks。
- 预览边界为单文件 512 KiB、最多 32 个 hunk、每 hunk 200 行、预览文本 64 KiB；超限只截断显示，apply 仍绑定完整 replacement digest、session/worker/preview/token。
- 宿主处理 CRLF、末尾换行、空文件、超长单行、控制字符和 bidi 标记；UI 以 React 文本节点安全渲染有界内容，不使用 `innerHTML`。审计不含正文。
- 修改文件：`docs/harness/patch-diff-design.md`、`src-tauri/src/harness/patch/{diff,mod,types,tests}.rs`、`src/harness/{protocol,patchClient,patchClient.test,approvalState,approvalState.test}.ts`、`src/harness/components/{ApprovalDialog,approvalDialog.css}`。
- 验证：Rust patch 定向 10 项通过；前端 Harness 定向 54 项通过；`pnpm build` 退出码 0，仅既有 bundle >500 kB warning。

## H1.8 Harness 审计面板与事件查询（2026-09-07）

- 新增宿主内存审计环（上限 1000 条）与窄只读 `harness_audit_query` 命令，查询支持 session/worker/plugin/version 过滤、cursor/limit 分页（单页最多 100）。摘要在宿主截断至 512 字符，前端再次校验并安全降级未知 phase。
- 审计模型只包含生命周期 phase、时间、duration、错误码、截断标记和脱敏摘要；不暴露 token、replacement、环境值、凭证、完整宿主路径或其他会话事件。历史仅供读取，重启/Worker crash 不触发执行恢复。
- Settings Harness 区新增键盘可达、可滚动审计列表，支持 session/worker 查询和空态/错误态；复用现有主题变量。
- 修改文件：`src-tauri/src/harness/{mod,commands}.rs`、`src-tauri/src/lib.rs`、`src/harness/auditClient.ts`、`src/harness/auditClient.test.ts`、`src/harness/components/{AuditSection,auditSection.css}.tsx`、`src/settings/SettingsPanel.tsx`。
- 验证：Harness Rust 60 项通过；前端新增审计 client 测试并纳入全量门禁。当前事件记录首先覆盖 command audit；broker/patch/registry 事件仍通过既有 Tauri event 通道，后续可统一写入同一宿主环而不改变查询契约。
- 剩余缺口：Windows/WebView E2E、应用重启后的持久审计历史、真实签名依赖与 publisher trust store；当前实现刻意不提供跨会话查询权限，查询命令返回的内存记录还需在产品权限上下文中绑定调用者身份。

## H1.6 安装信任链第一包（2026-09-07）

- 新增 `install-trust-design.md` 基线与 Registry 私有 local manifest：仅接受系统文件选择器明确选择的 UTF-8 普通文件；manifest 64 KiB、Worker 1 MiB，严格拒绝未知/重复字段、非法 ID/semver、未知或重复 tool/capability、symlink 与特殊文件。
- preview 固定 manifest/Worker digest、Registry revision 和安全摘要；commit 重新以 no-follow 打开并复核 digest。前端只能提交两个来源文件路径和不透明 preview ID，不能提交 trusted、目标路径、source、executable 或 argv。
- artifact 写入安装根随机 `.tmp-*`，文件与目录 fsync 后 rename 为 `plugin/version`；再以单 Registry revision install/update。版本已存在、降级、revision 冲突或 Registry 写入失败均回滚 artifact，并清理临时目录；新 preview 会恢复清理崩溃遗留 `.tmp-*`。
- Settings 增加本地导入、结构化预览和二次确认；展示 plugin/version/capability/digest 与醒目的“未验证发布者签名”警告。取消显式释放 preview；revision conflict 重新读取 Registry。
- trust 状态仅为 `local-user-approved/integrity-checked`，`signed=false`。现有 Registry `trusted=true` 在本包只表达用户本地批准并用于既有 runnable 门禁，不代表 publisher-signed。
- 修改文件：`docs/harness/{install-trust-design,implementation}.md`、`src-tauri/src/harness/registry/{install,install_tests,mod,commands}.rs`、`src-tauri/src/lib.rs`、`src/harness/{registryClient,registryClient.test}.ts`、`src/harness/components/{RegistrySection.tsx,registrySection.css}`。
- 签名依赖提案：Ed25519（`ed25519-dalek`，仅 `std` feature）+ SHA-256（`sha2`）；签名 envelope 与 key-id/revocation/rotation 格式见设计基线。本包未新增依赖，待明确授权后实施。
- 未验证/剩余：Windows 真机 reparse-point/ACL 与文件选择器、真实 WebView 720×480、真实磁盘写满/断电。rename 后、Registry commit 前的进程硬崩溃仍可能留下 final orphan（正常错误路径可补偿回滚）；下一包应增加启动恢复 journal/orphan reconciliation，再接 publisher signature trust store。
- 验证：`pnpm exec vitest run src/harness` 退出码 0（12 文件、52 项）；`pnpm test` 退出码 0（70 文件、536 项）；`pnpm build` 退出码 0，仅既有 bundle >500 kB warning；`git diff --check` 退出码 0；Worker 残留进程检查为空。
- Rust：`cargo test harness::registry --lib` 退出码 0（17 项）；`cargo test harness:: --lib` 退出码 0（57 项）；首次并行 `cargo test project:: --lib` 退出码 101（既有 project 测试共享临时目录竞态，2 项失败），随后 `cargo test project:: --lib -- --test-threads=1` 退出码 0（7 项）；`cargo test` 退出码 0（338 通过、4 ignored，集成 1 通过）；`cargo fmt --all --check` 退出码 0。

## H1.12 最终完成性核验（2026-09-08）

- 按 H0.5、H1.1-H1.11 设计与实施记录复核：Supervisor/NDJSON/Worker transport、Registry/Broker/Patch/Command、安装信任边界、SessionRuntime/Approval、宿主 Diff、脱敏审计与平台 smoke 入口均有代码和测试证据；未扩展 legacy plugins、Provider、根依赖、CI、数据库或 Git。
- `node scripts/harness/desktop-smoke.mjs`：退出码 0；Harness 定向 56 项通过。`pnpm test`：71 文件/540 项通过；`pnpm build`：退出码 0。`cargo test`：343 项通过、4 ignored；`cargo fmt --all --check` 与 `git diff --check`：退出码 0。
- 残留检查：假 Worker 进程扫描为空；仓库内未发现 `.tmp-*` 或安装临时目录残留。Smoke 明确声明未模拟 Tauri/WebView 或 Windows 通过。
- 新增 warning：无。既有 warning 仅 Vite bundle 大于 500 KiB。
- 文件/函数上限复核：本次未新增超长函数；Harness 中若干历史测试/模块文件超过建议 300 行（最大约 419 行），属于既有结构性观察项，未在最终核验任务中做无关重构。
- 代码完成结论：H1 代码范围可视为完成，安装仍保持 `local-user-approved/integrity-checked`，不应对外宣称 publisher-signed、跨平台桌面 E2E 通过或可发布生产。
- 未验证/外部事项：Windows/WebView 真实 E2E、Windows ACL/reparse-point、真实断电/磁盘写满恢复、OS 用户授权上下文、Ed25519/SHA-256 依赖授权与 publisher trust store/撤销轮换实现。

## H1.13 旧插件界面下线（2026-09-08）

- Settings 导航移除 legacy `plugins` 项与 `PluginPanel` 挂载，仅保留 Harness Registry/Audit 入口；未删除 `src/plugins` 或 `src-tauri/src/plugins` 文件。
- 导出 `normalizeSettingsSection` 对旧插件路由或未知状态安全回退到默认外观设置，Harness 路由继续可用；新增导航纯逻辑测试。
- 修改文件：`src/settings/SettingsPanel.tsx`、`src/settings/SettingsPanel.test.ts`、本文档。未改后端协议、共享类型、根依赖或 Git。

## H1.14 Harness 首次使用体验（2026-09-08）

- 新增可直接导入的 `examples/harness/readonly-project/`：manifest、Worker 和中文 README。示例仅声明 `project.list/project.read` 与 `project.read`，不写文件、不执行命令、不联网、不读取凭证。
- Settings Harness 顶部与空态明确四步：依次选择 manifest/Worker、检查摘要、二次确认、在新建会话菜单选择 Codex/Claude · Harness；导入失败文案保留 manifest/Worker/兼容/权限错误分类边界。
- NewSessionMenu 有可用 Harness 时显示按 Agent 分组的 Harness 入口；无 Harness 时提示先到设置 → Harness 导入示例包。
- `desktop-smoke.mjs` 增加示例 manifest 的真实文件校验；Tauri/WebView 原生安装与运行仍由现有 Rust Harness 套件和目标桌面环境验证，不模拟成功。

## H1.15 首次使用示例包补齐（2026-09-08）

- 新增 `examples/harness/readonly-project/{manifest.json,worker.mjs,README.zh-CN.md}`，可直接通过 Settings Harness 导入；仅 project.read，支持 project.list/project.read，不写文件、不执行命令、不联网、不读凭证。
- Settings 顶部/空态明确导入四步与安装成功后的 Codex/Claude · Harness 入口；NewSessionMenu 无 Harness 时给出设置导入提示。
- `desktop-smoke.mjs` 校验示例 manifest 的只读能力并运行现有 Harness 安装/Registry/session/Worker/read/patch/command/audit/revoke-close 证据套件。
- 验证：smoke 退出码 0；Harness 定向 59 项、全量前端 543 项、`pnpm build`、Cargo 全量、fmt、diff check 通过。仅既有 Vite bundle >500 KiB warning。

## H1.10 审计访问权限与崩溃恢复加固（2026-09-08）

- `harness_audit_query` 强制 session scope，并由宿主核对 Registry snapshot；未知、已取消、不可恢复或 worker/plugin/version 不匹配均拒绝，前端不承担权限判断。
- 审计 JSONL 启动恢复跳过半行/截断 JSON/未知字段，清理残留临时文件；重复事件按 id 幂等，仍限制 1000 条，原子替换失败不覆盖原件。
- 验证：Harness Rust 62 项、前端 540 项、完整 Cargo、`pnpm build`、fmt、diff check 均通过。仅既有 bundle >500 KiB warning。
- 剩余：Windows/WebView E2E、真实断电轮转、OS 用户授权上下文和签名 trust store。

## H1.11 平台验收与签名边界收尾（2026-09-08）

- 新增可执行 `scripts/harness/desktop-smoke.mjs`：运行 Harness 前端与 Rust 生命周期/Registry/Patch 定向套件，并明确列出安装 preview/commit、Registry list、snapshot/authorize、受信 Worker、read/patch/command、audit、撤权/取消/关闭覆盖；可选清理 `HARNESS_SMOKE_INSTALL_ROOT`。
- macOS 可运行自动化证据来自现有 Harness suites；脚本不会模拟 Tauri/WebView 或 Windows 通过，明确输出未验证并清理测试安装根。
- 新增 `signing-trust-store-design.md`，定义 Ed25519+SHA-256、key-id、撤销/轮换、签名覆盖字段、安装时机、错误码和旧 Registry 迁移兼容；不新增依赖、不标记 publisher-signed。
- H1 安全矩阵复核：宿主仍是 Registry/Broker/Patch/Command/Worker/audit 唯一 owner；前端只持脱敏 snapshot/summary，不持 token、replacement、环境值或完整路径；安装与 patch 均有 digest/revision/TOCTOU 校验；审计查询 session-scoped。
- 验证：`node scripts/harness/desktop-smoke.mjs`、`pnpm test`、`pnpm build`、`cargo test`、`cargo fmt --all --check`、`git diff --check` 均应作为平台验收入口；Windows/WebView 与签名 trust store 仍属外部环境/授权缺口。

## H1.16 安装事务启动恢复（2026-09-09）

- 安装/更新在 artifact rename 与 Registry commit 之间写入原子 journal，记录仅含版本、相对路径和阶段，不含凭证或运行时授权。
- Registry 创建时执行恢复：清理残留 `.tmp-*`、journal 指向且未被 Registry/history 引用的 final artifact，以及未引用的版本目录；已引用 artifact 永不删除。
- 损坏 journal、安装根符号链接、路径越界和未知特殊文件均 fail closed，保留现场并返回结构化恢复错误；重复恢复幂等。
- 新增恢复测试覆盖 orphan/journal 清理、Registry 引用保护、损坏 journal、安装根 symlink、版本冲突和恢复幂等。
- 验证：`cargo test harness::registry --lib -- --test-threads=1` 退出码 0（20 项）；`cargo test` 退出码 0（362 lib 通过、4 ignored，集成 1 项通过）；`pnpm test` 退出码 0（73 文件、551 项）；`pnpm build` 退出码 0；`cargo fmt --all --check` 与 `git diff --check` 退出码 0。
- 签名状态仍为 `local-user-approved/integrity-checked`，未新增 Ed25519/SHA-256 依赖，也未实现 publisher trust store。
