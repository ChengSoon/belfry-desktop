# 插件系统技术设计草案

本文约束功能语义，代码由「开发」实现。P0 协议定稿前须核对实现成本。
第二阶段对原文快照、revision、结果封套、故障恢复及回退来源的细化，
以 [第二阶段详细设计](./phase-two-design.md) 为准。

## 1. 现有架构证据

| 文件 | 已确认事实 | 设计影响 |
| --- | --- | --- |
| `package.json`、`src-tauri/Cargo.toml` | v0.19.0，React 19 / Tauri 2 / Rust | 不引入另一个 UI 或运行时框架 |
| `src/settings/SettingsPanel.tsx` | 分类导航，guarded 保护未完成操作 | 插件管理作为新分类接入 |
| `src/quickopen/items.ts`、`model.ts` | 宿主动作静态列表，action 类型可携带 value | 插件动作聚合为宿主 action，保持稳定命名空间 |
| `src/recipe/contracts.ts`、`useRecipes.ts` | 模板、变量、运行快照，20 步上限 | 插件模板编译为同样的运行输入 |
| `src/recipe/storage.ts` | 用户 Recipe localStorage v1，40 条限制 | 不混存插件模板，不迁移用户 Recipe |
| `src/prompt/runtime.ts` | 单队列、busy 等待、in-flight、重挂回滚 | 复用 enqueueRun/removeRun，不另造发送器 |
| `src/prompt/contracts.ts` | origin 只有 runId/stepId | 插件来源优先按 runId 外挂关联 |
| `src/agent/contracts.ts` | AgentKind 为 codex/claude | 不在 P0 扩展 Agent 类型 |
| `src-tauri/src/lib.rs` | 集中注册命令与 state | 接入由开发统一收尾，属需确认边界 |
| `src-tauri/src/atomic.rs` | 同目录临时文件 + rename | 存储方案参考；不宣称已保证断电耐久性 |
| `src-tauri/tauri.conf.json` | CSP 为 null | P0 不加载第三方 HTML/JS，不借本功能修改全局 CSP |

## 2. 模块职责

前端 `src/plugins/`：私有数据类型、数据解析边界、目录聚合、管理状态、
列表/详情/导入预览、模板启动预览、运行来源关联、诊断呈现。
后端 `src-tauri/src/plugins/`：有限文件读取、再次校验、受管存储、原子状态替换、恢复、命令接口。
现有 Recipe/Prompt：继续拥有队列、生命周期、步骤重试/跳过/中止和实际投递。
宿主组合层：把插件入口与设置、Quick Open、Recipe 接起来；插件内容不能决定 React 组件路径。

数据流：系统选择器 → 后端有限读取与校验 → 预览快照 → 用户安装 → 后端提交存储 →
前端获取目录 → 用户启用 → 目录索引 → 用户选择模板 → 会话/变量/预览 →
既有 enqueueRun → 既有终端发送 → 既有投递状态。

## 3. 插件文件格式 v1

文件建议名 `<publisher>.<name>.belfry-plugin.json`，后缀仅帮助识别，不构成信任。
单个 JSON 对象；文本全部内联；P0 不支持资源文件、URL 或 package dependency。

```json
{
  "schemaVersion": 1,
  "id": "example.review-kit",
  "name": "代码审查助手",
  "version": "1.0.0",
  "description": "复用代码审查与验证指令",
  "author": "Example Team",
  "compatibility": {
    "pluginApi": 1,
    "minAppVersion": "0.19.0"
  },
  "contributes": {
    "templates": [
      {
        "id": "review",
        "kind": "prompt",
        "name": "审查改动",
        "description": "按指定范围报告可执行问题",
        "steps": [
          { "id": "inspect", "text": "审查 {{scope}}，先阅读项目规则，再报告有证据的缺陷。" }
        ]
      },
      {
        "id": "plan-check",
        "kind": "recipe",
        "name": "计划与检查",
        "steps": [
          { "id": "plan", "text": "针对 {{goal}} 制定最小实施计划。" },
          { "id": "check", "text": "检查上述计划的风险、边界和验证方式。" }
        ]
      }
    ],
    "actions": [
      { "id": "open-review", "title": "审查改动", "templateId": "review", "keywords": ["review", "审查"] }
    ]
  }
}
```

`minAppVersion` 示例只是格式例子，不宣称尚未发布的宿主已有插件能力；
真实首发样例须填写实际包含插件系统的宿主版本，并同时匹配 pluginApi。

## 4. 字段校验

| 字段 | 规则 |
| --- | --- |
| schemaVersion / pluginApi | 必须均为整数 1；未知版本拒绝 |
| id | `publisher.name`，恰好一处点；两段均以小写字母开头，只含 a-z、0-9、连字符，总长 ≤ 80 |
| name / author | 去首尾空白后非空，分别 ≤ 60 / 80 Unicode 码点 |
| description | 可省略，提供时为字符串，≤ 500 码点 |
| version | P0 简化 SemVer：三个无前导零的非负整数，各 ≤ 65535；不支持预发布/build 后缀 |
| compatibility | 必含 minAppVersion；可含 maxAppVersionExclusive；均为同样三段版本，上界必须大于下界 |
| contributes | templates 必须有 1–40 条；actions 可省略或 0–40 条 |
| template id / action id / step id | 小写字母开头，后接小写字母、数字、连字符，≤ 60 字符 |
| template kind | 仅 prompt 或 recipe；prompt 恰好 1 步，recipe 1–20 步 |
| template name / action title | 非空，≤ 60 码点；描述规则同上 |
| steps text | 非空白，单步 ≤ 16384 UTF-8 字节，保留原文本；限制不可静默截断 |
| templateId | 必须指向当前插件已声明模板；不能指向其他插件或宿主 ID |
| keywords | 可省略；最多 10 个非空字符串，每个 ≤ 40 码点 |

所有已定义对象拒绝未知字段，避免作者误以为脚本/权限已生效。
各命名空间独立判重：插件内模板 ID、动作 ID 唯一，单模板步骤 ID 唯一。
JSON 重复对象键应拒绝，不能靠不同解析器的“最后值胜出”产生校验差异。
拒绝 BOM 以外的非 UTF-8 输入；可接受一个 UTF-8 BOM 后再解析。
限制嵌套深度 ≤ 16，字符串拒绝 NUL；显示元数据拒绝不可见控制字符。
步骤允许 LF/CRLF/Tab，拒绝 ESC、NUL 和其他 C0/C1 控制字符，防止把终端控制序列当正文投递。
双向控制字符在元数据拒绝，在步骤预览中显式提示其存在；不可无提示改变正文语义。
兼容判断先检查协议，再检查 `[minAppVersion, maxAppVersionExclusive)`；缺上界代表无上界。
宿主预发布版本 P0 按数值三元组检查并在详情显示原始完整版本，测试固定该行为。

## 5. 配额与身份

源文件读取上限 1MiB（1,048,576 bytes），实际采用 limit+1 读取确认越界，不能仅信文件 metadata。
全局最多 50 个插件；当前版本加回退槽的 manifest 总序列化字节数 ≤ 20MiB。
持久化文件读取硬上限 24MiB，预留索引/诊断空间；超限不给整文件无限分配内存。
运行变量最终展开后，每步仍需满足 16384 字节，整轮 ≤ 256KiB。
拒绝过长版本号和数值溢出；JSON 字段数量受总大小与结构规则共同约束。

模板身份建议 `plugin:<pluginId>:template:<templateId>`；动作身份为
`plugin:<pluginId>:action:<actionId>`；用户副本用现有随机 UUID。
插件内容不提供文件系统目标路径；源路径只交给有限读接口，存储路径由宿主决定。
manifest ID 不直接拼接 shell 命令；P0 无 Shell 路径与命令执行功能。

## 6. 持久化方案（待用户边界确认后接入）

推荐保存在 Tauri app_data_dir 的 `plugins/registry-v1.json`，由 Rust 独占写入。
该文件是新增独立存储，不修改工作区、Provider、Recipe 历史格式或 CLI 配置。
根结构包含 storeSchemaVersion、revision、plugins；每个插件保存完整当前 manifest、
enabled、installedAt、updatedAt、sourceFileName、可选 previousManifest，以及有限管理诊断。
插件诊断最多每插件 20 条，消息 ≤ 500 码点；卸载记录只留本次内存操作结果。
不保存完整源路径、运行变量、渲染后 Prompt、终端输出或密钥。

以单文件事务避免“manifest 已换、索引没换”两份文件不一致；权衡是更新时重写文件，
所以必须遵守总容量限制并在阻塞线程执行磁盘 I/O。
同一进程内加写锁；每次修改携带 expectedRevision，旧版本请求返回 STATE_CONFLICT。
P0 推荐仅插件子系统由一个实例独占（待用户确认产品限制与落盘边界）。
首个取得 `app_data_dir/plugins/owner.lock` OS 锁的进程持锁到退出；其他实例的
Shell/Agent 正常，但插件管理、运行、重试均不可用，不读旧目录继续操作。
锁文件永不删除，不能依据文件存在或 PID 判断占用；进程退出由 OS 释放锁。
owner 正常退出或崩溃后，其他实例仅在用户显式重试时非阻塞夺锁，成功后重读 registry，
清空旧目录和预览，不恢复旧运行；锁错误与被占用分别报告。
开发建议 Windows 使用 share_mode(0) 持有文件句柄，Unix 使用 flock 薄 FFI；
这是待验证实现方案，必须核对句柄继承/关闭、EINTR、非阻塞及 Rust 1.85 兼容性。
不得在 PTY 子进程继承 owner 锁描述符；测试父进程退出且子进程存活时仍能接管。
所有插件业务命令和运行/重试桥接检查 owner；占用状态查询和显式重试可供非 owner 调用。
同一 owner 内仍要管理操作互斥和 expectedRevision，进程锁不能代替它们。
如果实际实现需要新增依赖或根配置，先提交具体变更请求，不扩大已批准范围。

提交顺序：在锁内重读并验证 revision → 生成下一份完整状态 → 同目录临时文件写入 →
按平台适用能力 flush/sync → 原子替换 → 发布新 revision → 刷新贡献目录。
失败则不发布成功状态。`atomic.rs` 可参考，但文件/目录同步与跨进程互斥需另行验证。
损坏文件不能自动写成空数组；保留原件并进入只读故障态，提供重新读取。
可解析根结构下的单个坏 entry 隔离，不注册该 entry；在未显式修复前禁止整体重写导致丢条目。
应用 Shell 启动与插件目录加载解耦；插件故障只影响插件管理/运行。

## 7. 命令接口建议

接口名为实现草案；所有请求/响应属于新插件模块私有契约，后端为最终校验权威。

| 命令 | 输入重点 | 输出/行为 |
| --- | --- | --- |
| plugins_list | 无 | revision、摘要、可用性、诊断 |
| plugins_inspect | 用户选择的 path | validated manifest、来源文件名、与已安装版本差异；不写磁盘 |
| plugins_install | manifest 快照、sourceFileName、expectedRevision | 后端重新校验同一快照，保存为禁用 |
| plugins_set_enabled | pluginId、enabled、expectedRevision | 校验后切换，返回全新 revision |
| plugins_replace | pluginId、manifest 快照、expectedRevision | 同 ID 验证、保存回退槽、禁用新版本 |
| plugins_rollback | pluginId、expectedRevision | 校验回退版本兼容性，恢复并禁用，清回退槽 |
| plugins_uninstall | pluginId、expectedRevision | 仅移除受管 entry，返回新状态 |

inspect 与 install 之间使用内存快照，不再次读取用户文件，避免预览后源文件变化。
前端不能任意覆盖 inspected 文本；后端仍要重复完整校验。
所有错误返回稳定 code、用户消息与可选 fieldPath，不向界面直接透出含敏感内容的堆栈。
建议 code：INVALID_JSON、INVALID_MANIFEST、LIMIT_EXCEEDED、UNSUPPORTED_SCHEMA、
INCOMPATIBLE_APP、DUPLICATE_VERSION、NOT_FOUND、STATE_CONFLICT、STORAGE_READ、
STORAGE_WRITE、CORRUPT_STORE、NO_ROLLBACK、TARGET_UNAVAILABLE、STALE_PREVIEW。

## 8. 运行与管理操作的一致性

插件桥接层保存 runId → {pluginId, version, catalogRevision}，并将模板转为现有 Recipe 输入。
不向 PromptOrigin 增加字段，不需要把插件来源永久写进 Recipe schema。
来源标签在运行面板的桥接层提供；现有组件可新增可选 props，但须由开发说明边界。
用户副本脱离该关联，按普通 Recipe 管理。

启停/更新/卸载期间先将该插件在本地标记为管理操作中，阻止新运行与旧轮次重试；
确认后中止关联 run（包括已从可见 8 条历史中淘汰但仍可能排队的轮次），再执行持久化。
关联表不能跟随 RUN_HISTORY_LIMIT 直接截断；仅在确定无队列项及 in-flight 后释放。
对没有 in-flight 可观察接口的现状，保守保留本次应用会话中所有关联并设置合理运行数上限，
或提交新增只读查询接口提案；不得仅凭队列为空判定可以安全释放。
建议每次应用会话最多 1000 个插件运行关联，达到上限阻止新轮次并提示重启释放。
这项上限只限制插件运行，不影响手工 Prompt 与普通 Recipe。

同一 UI 事件循环内，运行提交先校验 catalogRevision 和管理操作标记，再创建 run 并记录关联；
开始管理操作后不允许插入新 run。失败回滚入口状态，但已取消的轮次保持中止。
P0 推荐单 owner 进程、单主窗口使用插件；多实例规则见第 6 节。
单靠提交前读取 revision 存在检查后状态变化的竞态，不作为 AC-26 的实现方案。
未来若要求多个实例同时使用插件，须独立设计 IPC 撤销确认、运行租约及故障协议。

## 9. 信任与扩展边界

JSON 是不可信内容，所有标题和模板按字符串处理；禁止 eval、动态 import、innerHTML。
安装不授予插件访问终端的程序能力；只有用户预览确认的模板进入宿主队列。
模板仍可要求 Agent 执行有影响的动作，因此预览与来源可见是必要的产品行为。
不宣称“声明式插件绝对安全”，也不把 author 字符串显示为已认证开发者。
不修改系统技能目录、不改 Codex/Claude 配置、不读取 Provider API Key。
未来能力必须增加协议版本/明确 capability 并设计撤销，不预留通用 arbitraryInvoke 后门。
