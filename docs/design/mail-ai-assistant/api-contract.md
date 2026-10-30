# Mail AI Assistant — API 契约

状态：设计稿 v0.3；用于后端实现与 UI 模拟数据对齐，**尚无已实现接口或已验证服务商**。
负责人：后端开发工程师。基线：[brief.md](brief.md)、[delivery-plan.md](delivery-plan.md)。
配套：[backend-design.md](backend-design.md)。示例域名、账户、密钥和数据均为占位示例。

## 1. 首版决策与通用约定

- 独立服务，同源 Web UI，API 前缀 `/api/v1`；单用户部署，数据模型支持多个邮箱和任务。
- M1 验证一个 IMAP Inbox 与一个 `summary` 任务。M2 开放并验证 Gmail、Microsoft Graph、多账户和全部六种任务模板。M3 才做历史导入、附件内容、汇总报告和外部输出。
- 邮箱配置默认停用定时检查；间隔默认 300 秒，可配置为 60–86400 秒。`enabled` 仅表示定时检查开关，不表示连接是否健康。
- 首次启用或首次手动同步固定 `activatedAt`；只处理服务商接收时间不早于该时刻的 Inbox 邮件。已读状态不参与筛选；更早邮件即使后来移入 Inbox，仍属于历史导入范围。
- 所有 JSON 字段使用 camelCase；时间使用 UTC RFC 3339。`id` 是带类型前缀的不可解析字符串；示例中的 `mbx_demo` 等不是生产 ID 格式承诺。
- 成功返回资源本身；集合统一为 `{ "items": [], "nextCursor": null }`。`limit` 默认 50、最大 100；游标绑定查询条件，分页按时间与 ID 稳定排序。
- `null` 表示未知或不适用；列表为空用 `[]`。不能把模型没有找到的负责人、截止时间、金额补成猜测值。
- 所有接口需已认证的单用户会话；修改请求还需 CSRF 校验。登录与部署入口由部署设计提供，接口不能因“只有一个用户”而匿名开放。
- 修改可变资源使用 `If-Match`，其值来自 GET/PATCH 响应的 `ETag`。缺失返回 428，版本不符返回 412；响应中的 `revision` 与 ETag 对应。
- 所有 POST 操作要求 `Idempotency-Key`，最长 128 字符；同一用户、方法、路径、键、规范化请求体在 24 小时内返回原资源和原状态码。键相同但请求体不同返回 409。含 secretInput 的请求只保存带独立密钥的请求体 HMAC，不保存原请求体或可离线猜测密码的普通 hash。超过 24 小时仍受邮件、任务运行的数据库唯一约束保护。
- 密钥只出现在专门的写入字段中，通过 TLS 提交；响应只给 `credentialConfigured`、更新时间等摘要。普通配置不接受客户端任意指定内部密钥引用。
- 文档中的 JSON 是目标行为示例。原型须明确显示“模拟数据 / 未连接真实邮箱”，不能把能力规划当作已验证支持。

## 2. 类型与状态：UI 必须使用这些值

| 类型 / 字段 | 值 | 语义 |
| --- | --- | --- |
| `MailboxConnection.provider` | `imap`, `gmail`, `graph` | 分别为通用 IMAP、Gmail API、Microsoft Graph |
| `connectionState`（邮箱及 AI 服务） | `untested`, `connected`, `auth_required`, `error` | 最近一次测试或实际调用的连接健康；调度暂停不改变此值 |
| `implementationStatus` | `planned`, `implemented`, `verified` | 能力实现/验证程度；验证还需注明服务商与账户类型 |
| `ConnectionTest.status` | `queued`, `running`, `succeeded`, `failed` | 测试单独建记录；运行中不覆盖上一次已知连接健康 |
| `ConnectionTest.checks[].status` | `passed`, `failed`, `skipped` | 单个检查项结果 |
| `SyncRun.status` | `queued`, `running`, `waiting_retry`, `succeeded`, `partial`, `failed`, `cancelled` | `partial` 表示已持久化部分内容，但本轮仍有失败或待人工判定项 |
| `AITaskRun.status` | `queued`, `running`, `waiting_retry`, `succeeded`, `failed`, `cancelled` | AI 任务没有 `partial` 状态；一个任务失败不影响其他任务 |
| `run.kind` | `sync`, `ai` | 运行历史判别字段 |
| `run.trigger` | `schedule`, `manual`, `continuation`, `message_ingest` | 重试不改最初 trigger，用 attempt 表示 |
| `SyncRun.phase` | `initializing`, `incremental`, `recovering` | 首次边界初始化、正常增量、游标/UIDVALIDITY 恢复 |
| `run.waitReason` | `transient_error`, `backpressure`, `rate_limit`, `null` | 仅在等待状态有值 |
| `MailMessage.contentState` | `available`, `quarantined`, `too_large`, `unavailable`, `expired` | 只有 available 的正文能送入 AI |
| `Result.status` | `ready`, `edited`, `expired` | 成功输出、用户修改过的草稿、内容已按保留策略清理 |
| `AITaskDefinition.template` | `summary`, `classification`, `todo_extraction`, `field_extraction`, `translation`, `reply_draft` | 自定义指令扩展这些模板，不新增无约束的执行工具 |
| `RecoveryItem.status` | `pending`, `linked`, `kept_separate` | IMAP 跨 UIDVALIDITY 身份不确定时的人工处理状态 |

状态约束：`waiting_retry` 返回 `nextAttemptAt`；运行终态返回 `finishedAt`；没有错误时 `error: null`。连接重新授权后，旧失败运行仍保留，重试需显式提交或由尚未终结的自动重试继续。空同步是 `succeeded` 且计数为 0；AI 失败不把已经成功的同步改成失败。`cancelled` 保留给管理操作及后续取消能力，M1 UI 不显示尚未提供的取消按钮。

## 3. 能力及核心配置

`GET /capabilities` 返回部署实际开放的能力。以下是**设计阶段原型**的示例；未来后端按实际实现填值。

```json
{
  "executionMode": "simulated",
  "mailboxProviders": [
    {"id": "imap", "stage": "M1", "implementationStatus": "planned", "available": false},
    {"id": "gmail", "stage": "M2", "implementationStatus": "planned", "available": false},
    {"id": "graph", "stage": "M2", "implementationStatus": "planned", "available": false}
  ],
  "aiAdapters": [{"id": "deployment_default", "available": false}],
  "taskTemplates": ["summary", "classification", "todo_extraction", "field_extraction", "translation", "reply_draft"],
  "availableTaskTemplates": [],
  "limits": {"minIntervalSeconds": 60, "maxIntervalSeconds": 86400, "maxPageSize": 100},
  "features": {"historyImport": false, "attachmentContent": false, "reports": false, "mailSending": false}
}
```

`executionMode` 为 `simulated` 或 `live`。M1 实际可用时仅开放已实现的 IMAP、摘要模板和一个部署选定的模型适配器；`verified` 必须有真实验证证据。`deployment_default` 是服务端适配器注册表中的稳定别名，不表示任意 URL 都兼容。实际提供方、模型和线协议在首次集成前选定并通过该适配器实现。

`GET /settings` 的目标响应；`PATCH /settings` 用相同可变字段与 If-Match 更新。此处的保留期是首版建议，真实部署前需项目经理确认。

```json
{
  "revision": 1,
  "displayTimezone": "Asia/Shanghai",
  "defaultPollingIntervalSeconds": 300,
  "retention": {"mailContentDays": 90, "resultContentDays": 90, "runDiagnosticDays": 30},
  "defaultAiServiceId": null
}
```

显示时区不改变五分钟间隔的执行逻辑；M3 报告的日历调度有自己的时区。降低保留期返回 `cleanupEffectiveAt`（最早 24 小时后），UI 展示将受影响的内容类型；清理不删除去重墓碑。无设置接口可开启尚未实现的附件处理、报告或邮件发送。

## 4. 邮箱连接、测试与同步策略

### 4.1 创建 IMAP 连接

`POST /mailboxes`，响应 `201 Created`。secretInput 为写入专用字段，不进入响应或日志。

```json
{
  "name": "工作邮箱",
  "provider": "imap",
  "accountEmail": "reader@example.test",
  "imap": {"host": "imap.example.test", "port": 993, "security": "tls", "username": "reader@example.test"},
  "secretInput": {"kind": "password", "value": "<邮箱授权码占位符>"}
}
```

```json
{
  "id": "mbx_demo",
  "revision": 1,
  "name": "工作邮箱",
  "provider": "imap",
  "accountEmail": "reader@example.test",
  "connectionState": "untested",
  "credentialConfigured": true,
  "imap": {"host": "imap.example.test", "port": 993, "security": "tls", "username": "reader@example.test"},
  "syncPolicy": {"enabled": false, "intervalSeconds": 300, "folders": ["inbox"], "activatedAt": null},
  "lastCheckedAt": null,
  "lastSuccessfulSyncAt": null,
  "nextSyncAt": null,
  "activeSyncRunId": null,
  "lastError": null
}
```

M1 固定直接 TLS/993，不支持明文与忽略证书错误；其他安全端口配置待服务商验证后开放。`accountEmail` 是显示身份，实际连接身份仍需测试验证。`GET /mailboxes`、`GET /mailboxes/{mailboxId}` 返回同一资源形状。`PATCH /mailboxes/{mailboxId}` 可改 name；连接身份、provider、host、username 不原地替换，须新建连接，防止旧同步游标被用于另一个邮箱。

`PUT /mailboxes/{mailboxId}/credentials` 接收同形状 secretInput 与 If-Match，返回更新后的连接资源；密钥轮换不改变邮箱身份和激活边界，连接健康回到 untested。没有读取密钥的 GET 接口。

### 4.2 测试连接

`POST /mailboxes/mbx_demo/tests`，请求 `{}`，响应 `202 Accepted`：

```json
{"id": "test_mail_demo", "targetType": "mailbox", "targetId": "mbx_demo", "status": "queued", "createdAt": "2026-10-29T02:00:00Z", "checks": [], "error": null}
```

`GET /connection-tests/test_mail_demo` 完成后：

```json
{
  "id": "test_mail_demo",
  "targetType": "mailbox",
  "targetId": "mbx_demo",
  "status": "succeeded",
  "createdAt": "2026-10-29T02:00:00Z",
  "finishedAt": "2026-10-29T02:00:02Z",
  "checks": [
    {"name": "tls", "status": "passed"},
    {"name": "authentication", "status": "passed"},
    {"name": "inbox_access", "status": "passed"}
  ],
  "error": null
}
```

测试验证 TLS、登录和 Inbox 读取权限；不下载邮件正文、不推进同步游标、不改变已读状态。总超时 30 秒，同一目标同时只运行一个测试；重复发起返回该未完成测试。成功后连接为 connected，鉴权失败为 auth_required，其他失败为 error。测试失败使用第 10 节同形状 error，UI 提供重新配置或重试入口。

### 4.3 启用或暂停定时检查

`PATCH /mailboxes/mbx_demo/sync-policy`，先读取测试后的连接 ETag，例如 `If-Match: "mbx_demo:2"`：

```json
{"enabled": true, "intervalSeconds": 300, "folders": ["inbox"]}
```

响应 `200 OK`，`ETag: "mbx_demo:3"`；返回完整 MailboxConnection，其中：

```json
{
  "syncPolicy": {"enabled": true, "intervalSeconds": 300, "folders": ["inbox"], "activatedAt": "2026-10-29T02:01:00Z"},
  "nextSyncAt": "2026-10-29T02:01:00Z"
}
```

这是完整响应中相关字段的节选。首次启用要求最近一次连接测试成功；`activatedAt` 由服务端写入，不接受客户端修改。禁用只停止创建后续定时/延续运行，已开始的运行完成当前工作；不取消已经生成的 AI 任务。重新启用保留原边界和游标并补取停用期间仍可读取的新邮件。首版 folders 只允许 `["inbox"]`。

允许没有任务绑定时同步；响应给出 `warnings: [{"code":"NO_ACTIVE_BINDINGS","message":"邮件将保存，但当前没有启用的 AI 任务"}]`。推荐 UI 先配置任务并绑定再启用，不能把“无绑定”误报成收信失败。

### 4.4 Gmail / Graph 授权（M2）

`POST /mailboxes` 使用 `provider: "gmail"` 或 `"graph"`、name；不接收 IMAP 密码。返回 `connectionState: "auth_required"` 的连接。

`POST /mailboxes/{mailboxId}/authorization-sessions` 请求 `{}`，响应 `201`：

```json
{"id": "auth_demo", "authorizationUrl": "https://identity.example.test/authorize?state=opaque", "expiresAt": "2026-10-29T02:10:00Z"}
```

服务端创建并校验一次性 state/PKCE，回调地址固定；token 留在后端，浏览器轮询连接状态。该 URL 仅为形状示例，实际 OAuth 地址由对应适配器生成。Gmail 采用只读邮件 scope，Graph 采用委托 Mail.Read 与续期所需 scope；租户管理员策略仍可能阻止授权。M1 调用此功能返回 `501 FEATURE_NOT_AVAILABLE`，而不是模拟成功。

## 5. AI 服务、任务版本与邮箱绑定

### 5.1 AI 服务

`POST /ai-services` → `201`：

```json
{
  "name": "默认 AI 服务",
  "adapterId": "deployment_default",
  "baseUrl": "https://ai.example.test/v1",
  "defaultModel": "deployment-selected-model",
  "secretInput": {"kind": "api_key", "value": "<AI 服务密钥占位符>"}
}
```

```json
{
  "id": "ais_demo",
  "revision": 1,
  "configVersionId": "aicfg_demo_v1",
  "name": "默认 AI 服务",
  "adapterId": "deployment_default",
  "baseUrl": "https://ai.example.test/v1",
  "defaultModel": "deployment-selected-model",
  "credentialConfigured": true,
  "connectionState": "untested",
  "lastTestedAt": null,
  "lastError": null
}
```

`GET /ai-services`、`GET /ai-services/{id}` 返回上述资源。`GET /ai-services/{id}/config-versions` 列出版本，`GET /ai-services/{id}/config-versions/{configVersionId}` 返回该版本的固定配置、credentialConfigured、connectionState、revision 和 ETag；配置值不可变，凭据/健康摘要改变时视图 revision 更新。

`POST /ai-services/{id}/tests` 请求 `{"configVersionId":"aicfg_demo_v1"}`，返回 ConnectionTest，targetType 为 ai_service，且包含 configVersionId；使用无邮件的固定短样本验证一次真实生成和 schema 解析，UI 提示可能产生少量模型调用费用。测试固定凭据版本，期间发生配置/凭据变化时以 CONFIGURATION_CHANGED 结束，不覆盖新版本健康状态。

轮换凭据使用 `PUT /ai-services/ais_demo/config-versions/aicfg_demo_v1/credentials`，If-Match 来自该版本 GET：

```json
{"secretInput": {"kind": "api_key", "value": "<只用于本配置目标的密钥占位符>"}}
```

返回更新后的配置版本视图。服务端从版本确定目标地址与绑定，不接受任意 secretRef。`DELETE /ai-services/{id}/config-versions/{configVersionId}/credentials` 使用该版本的 If-Match 撤销绑定，响应 204；已有任务转为需要修复该版本凭据，不能改用其他版本密钥。

`PATCH /ai-services/{id}` 修改配置需 If-Match；adapterId、baseUrl、defaultModel 改变时生成新的 configVersionId 和独立凭据绑定。**新版本默认 credentialConfigured=false、connectionState=untested；旧任务始终使用原配置地址及原绑定，绝不读取服务级“最新密钥”。** 可在创建新版本的 PATCH 中显式给 secretInput，或在 adapter、完整规范 baseUrl、账户/tenant audience 均相同时使用 reuseCredentialFromConfigVersionId，服务端把密钥复制到新绑定。主机、端口、协议或 path 改变时禁止复用。

例如配置 v1 指向 `https://old-ai.example.test/v1`，其密钥只属于绑定 B1；改为 `https://new-ai.example.test/v1` 的 v2 使用新绑定 B2。给 B2 写入密钥不会影响排队中的 v1 调用。轮换 B1 仅影响同一版本、同一目标的调用。HTTP 请求不自动跟随重定向。任务采用新服务配置须保存新任务版本，输出与运行保留所用版本链。

### 5.2 创建任务

`POST /tasks` → `201`：

```json
{
  "name": "邮件摘要",
  "enabled": true,
  "definition": {
    "template": "summary",
    "instructions": "用中文概括重点，区分邮件中明确写出的事项与未知信息。",
    "matching": {"senderDomains": [], "subjectContainsAny": [], "hasAttachments": null},
    "aiServiceId": "ais_demo",
    "aiServiceConfigVersionId": "aicfg_demo_v1",
    "model": "deployment-selected-model",
    "modelSettings": {"temperature": 0.2, "maxOutputTokens": 1200},
    "templateOptions": {"language": "zh-CN"}
  }
}
```

```json
{
  "id": "task_summary",
  "revision": 1,
  "name": "邮件摘要",
  "enabled": true,
  "currentVersion": {
    "id": "taskver_summary_v1",
    "number": 1,
    "template": "summary",
    "aiServiceId": "ais_demo",
    "aiServiceConfigVersionId": "aicfg_demo_v1",
    "model": "deployment-selected-model",
    "outputSchemaVersion": "summary.v1",
    "createdAt": "2026-10-29T02:00:30Z"
  }
}
```

创建响应中的 currentVersion 为摘要；`GET /tasks/{id}` 还返回完整 definition 与只读 outputSchema。`GET /tasks/{id}/versions` 列出不可变版本；`GET /tasks` 返回摘要资源。matching 的维度之间为 AND，同一数组内为 OR；空数组/null 不限制该维度。M1 只允许全匹配，筛选条件与其他模板在 M2 开放；不支持任意表达式执行。

`PATCH /tasks/task_summary` 提交 name/enabled 或完整 definition，需 If-Match。instructions、matching、模板选项、模型、服务配置或 schema 发生变化时创建新 taskVersionId；name/enabled 只改变任务 revision。响应形状同创建，例如版本变为 `taskver_summary_v2`、number 为 2。保存任务不自动重跑旧邮件；既有排队任务继续执行已固定的版本。

模板输出契约：

| template | `output` 的必需字段 | 规则 |
| --- | --- | --- |
| summary | summary: string, keyPoints: string[], language: string | M1 首个模板 |
| classification | category: string或null, confidence: number或null, reason: string | category 必须来自 templateOptions.categories；confidence 为 0–1 |
| todo_extraction | items: array | 每项有 text、owner、dueDate、sourceQuote；后三项允许 null，dueDate 为 YYYY-MM-DD |
| field_extraction | fields: object | templateOptions.fields 定义名称/类型；每个值允许 null；服务端生成有限 JSON Schema |
| translation | targetLanguage: string, translatedText: string | 目标语言来自配置 |
| reply_draft | subject: string, bodyText: string, language: string | 输出可编辑，无发送动作 |

templateOptions 随模板校验；不接受远程 `$ref`、可执行代码或任意工具定义。模型不支持某个 modelSettings 字段时返回 422 MODEL_SETTING_UNSUPPORTED，不能默默忽略。输出必须通过固定 taskVersion 对应的 schema 校验，失败只生成失败运行记录，不生成伪造成功结果。

#### templateOptions 输入定义（v0.3 补齐）

templateOptions 必须是对象；每种模板只接受下表字段，未知字段返回 422 VALIDATION_FAILED。默认值在保存时填入服务端返回的 definition，并参与任务版本 hash。

| template | 接受的字段 | 必填、默认与上限 |
| --- | --- | --- |
| summary | language: string | 可省略，默认 zh-CN |
| classification | categories: string[] | 必填，1–20 项；每项去除首尾空白后 1–40 字符；不得重复，区分大小写 |
| todo_extraction | language: string | 可省略，默认 zh-CN；不接受推测负责人或补日期的选项 |
| field_extraction | fields: FieldDefinition[] | 必填，1–20 项；具体 schema 见下文 |
| translation | targetLanguage: string | 必填，无默认目标语言 |
| reply_draft | language: string | 可省略，默认 zh-CN；不接受收件人、发送开关或工具权限 |

language/targetLanguage 使用 2–35 字符的有效 BCP 47 语言标签（例如 zh-CN、en、ja）；所选适配器明确不支持时返回 422 MODEL_LANGUAGE_UNSUPPORTED。日期、金额等提取语义写入任务 instructions；M2 的 fields 不支持数组、嵌套对象、默认值、计算表达式或专门的金额/日期类型，需保留原始格式时使用 string。

FieldExtractionOptions 的 JSON Schema 2020-12：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["fields"],
  "properties": {
    "fields": {
      "type": "array",
      "minItems": 1,
      "maxItems": 20,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "type"],
        "properties": {
          "name": {
            "type": "string",
            "pattern": "^[A-Za-z][A-Za-z0-9_]{0,39}$",
            "maxLength": 40,
            "not": {"enum": ["constructor", "prototype"]}
          },
          "type": {"enum": ["string", "number", "boolean"]}
        }
      }
    }
  }
}
```

另有跨项校验：name 去除首尾空白后按区分大小写的键判重，不能以同名不同 type 绕过；字段名即 output.fields 的键。字段顺序用于展示并属于版本定义。示例 templateOptions：

```json
{"fields": [{"name": "invoiceNumber", "type": "string"}, {"name": "amount", "type": "number"}, {"name": "currency", "type": "string"}]}
```

生成的输出 schema 要求 fields 对象包含全部配置键，各值类型为配置类型或 null，additionalProperties=false。number 必须为有限 JSON 数值；unknown 保持 null，不能用空字符串、0、false 代替缺失。错误在 error.details.fieldErrors 中以 `{path,code,message}` 给出，例如 path 为 `definition.templateOptions.fields[1].name`、code 为 DUPLICATE_FIELD_NAME。列表长度、保留名称或未知类型同样返回字段级错误，不保存一半定义。

### 5.3 绑定与解绑

`POST /task-bindings` → `201`：

```json
{"mailboxId": "mbx_demo", "taskId": "task_summary", "enabled": true}
```

```json
{"id": "bind_demo", "revision": 1, "mailboxId": "mbx_demo", "taskId": "task_summary", "enabled": true, "effectiveFrom": "2026-10-29T02:00:40Z", "appliesTo": "future_ingest"}
```

`GET /task-bindings?mailboxId=mbx_demo` 查询；`PATCH /task-bindings/{id}` 接收 `{"enabled":false}` 或 true 与 If-Match。每个 mailboxId/taskId 最多一条绑定，重新启用更新 effectiveFrom。绑定与任务均启用时，对**此后首次入库**且匹配的邮件生成任务；保存或重新启用绑定不追溯已有邮件。AI 运行在入库事务中固定当时的任务版本。

停用任务/绑定只影响后续入库，不取消已有 AI 运行。已入库邮件可通过下一节显式发起任务；批量历史回填属于 M3。UI 在绑定保存处说明上述范围。

## 6. 同步、执行、进度与重试

### 6.1 手动同步

`POST /sync-runs` → `202`：

```json
{"mailboxId": "mbx_demo"}
```

```json
{
  "id": "sync_demo",
  "kind": "sync",
  "mailboxId": "mbx_demo",
  "status": "queued",
  "phase": "incremental",
  "trigger": "manual",
  "attempt": 0,
  "createdAt": "2026-10-29T02:02:00Z",
  "startedAt": null,
  "finishedAt": null,
  "nextAttemptAt": null,
  "waitReason": null,
  "progress": {"scanned": 0, "persisted": 0, "duplicates": 0, "ignoredHistorical": 0, "unavailable": 0, "quarantined": 0, "aiRunsQueued": 0, "hasMore": false},
  "error": null
}
```

已经有 queued/running/waiting_retry 的同步时返回 `200` 和该运行（同一邮箱不能重叠）。暂停定时后仍可手动同步；首次手动同步与首次启用一样要求连接已测试成功，否则返回 422 MAILBOX_TEST_REQUIRED。首次手动同步同样设立 activatedAt、使用 initializing phase，不会导入已有历史邮件。

`GET /sync-runs/sync_demo` 返回相同形状；例如完成时 status=succeeded、finishedAt 非空、progress.persisted=3、aiRunsQueued=3。计数为该逻辑运行各次尝试的累计已提交进度，不代表 AI 已完成；重试不会把已提交数量重复累加。不存在可计算总量时不返回虚假的百分比。每轮达到 500 封或 120 秒工作预算后可以 succeeded 且 hasMore=true，下一轮 continuation 继续；定时暂停时不自动延续。

UIDVALIDITY 或 API 游标失效时 phase=recovering，正常恢复过程不是用户鉴权失败。发生身份歧义则 partial，并提供待处理项数量与入口（第 9 节）。

### 6.2 对已保存邮件显式执行任务

`POST /messages/msg_demo/task-runs`：

```json
{"taskId": "task_summary", "taskVersionId": "taskver_summary_v2"}
```

首次执行返回 `202`：

```json
{
  "id": "airun_demo_v2",
  "kind": "ai",
  "mailboxId": "mbx_demo",
  "messageId": "msg_demo",
  "taskId": "task_summary",
  "taskVersionId": "taskver_summary_v2",
  "status": "queued",
  "trigger": "manual",
  "attempt": 0,
  "createdAt": "2026-10-29T02:05:00Z",
  "startedAt": null,
  "finishedAt": null,
  "nextAttemptAt": null,
  "waitReason": null,
  "resultId": null,
  "error": null
}
```

taskVersionId 必填，UI 显示将使用的版本；任务必须与该邮箱有绑定，允许用户显式运行已暂停的绑定，但源内容必须 available。`(messageId, taskVersionId)` 唯一：已有逻辑运行时返回 `200` 和原运行，无论它成功或失败；失败运行须走 retry。改变 Idempotency-Key 不会强制生成同版本的第二份结果。新版本产生新运行、新结果，旧结果保留。同版本“再抽一次”、批量重跑推迟到 M3。

### 6.3 运行列表与详情

`GET /runs?kind=ai&mailboxId=mbx_demo&status=failed&limit=50`：

```json
{
  "items": [
    {"id": "airun_summary_v1", "kind": "ai", "mailboxId": "mbx_demo", "messageId": "msg_demo", "taskId": "task_summary", "taskVersionId": "taskver_summary_v1", "status": "failed", "trigger": "message_ingest", "attempt": 5, "createdAt": "2026-10-29T02:02:02Z", "startedAt": "2026-10-29T02:20:00Z", "finishedAt": "2026-10-29T02:21:30Z", "nextAttemptAt": null, "waitReason": null, "resultId": null, "error": {"code": "AI_SERVICE_TIMEOUT", "message": "AI 服务调用超时，自动重试已用尽。", "retryable": true, "action": "retry_run", "requestId": "req_demo"}}
  ],
  "nextCursor": null
}
```

支持 kind、mailboxId、taskId、status、createdFrom、createdTo；时间范围 `[from,to)`。详情为 `GET /sync-runs/{id}` 或 `GET /ai-task-runs/{id}`，额外带 attempts（序号、时间、耗时、结果、已脱敏错误）。UI 根据 kind 选择详情，不能把同步状态当成 AI 状态。活动运行每 2 秒轮询，失焦降频，终态停止；SSE 不属于 M1 依赖。

### 6.4 重试

`POST /ai-task-runs/airun_summary_v1/retry` 或 `POST /sync-runs/{id}/retry`，请求 `{}`，响应 `202` 和原运行资源，status=queued、finishedAt=null；保留历史 attempts，下次领取时 attempt 加一。

- 只接受 failed/partial 且允许恢复的运行；成功、取消、正在运行的对象返回 409 RUN_NOT_RETRYABLE。身份问题需要先修复凭据，永久 schema/配置问题需要新任务版本或修复配置。
- AI 重试沿用原 messageId、taskVersionId、模型及配置版本；手动重试重新给最多 5 次尝试预算，但不抹除总尝试次数与历史诊断。
- 同步从已经提交的游标继续，不从头回滚；若此后别的运行已经接管/推进该邮箱，则返回 409 RUN_SUPERSEDED 和 activeRunId 或 latestRunId，UI 跳转该运行或发起新的增量同步。
- 等待自动重试时 UI 显示 nextAttemptAt，不提供另开一次的按钮；停止自动重试暂通过暂停服务/修复配置处理，细粒度取消和强制提前重试不属于 M1。

## 7. 结果与原邮件

`GET /results?mailboxId=mbx_demo&template=summary&createdFrom=2026-10-29T00:00:00Z&createdTo=2026-10-30T00:00:00Z`，支持 mailboxId、taskId、taskVersionId、template、createdFrom、createdTo、includeExpired（默认 false）。返回集合信封，items 为结果摘要。`GET /results/res_demo` 返回详情：

```json
{
  "id": "res_demo",
  "revision": 1,
  "status": "ready",
  "mailboxId": "mbx_demo",
  "messageId": "msg_demo",
  "taskId": "task_summary",
  "taskVersionId": "taskver_summary_v1",
  "aiTaskRunId": "airun_summary_v1",
  "template": "summary",
  "outputSchemaVersion": "summary.v1",
  "output": {"summary": "邮件请求确认会议时间。", "keyPoints": ["尚未指定最终参会人。"], "language": "zh-CN"},
  "draft": null,
  "warnings": [],
  "createdAt": "2026-10-29T02:25:20Z",
  "updatedAt": "2026-10-29T02:25:20Z"
}
```

结果列表使用下节 ResultSummary，完整 output/draft/warnings 只在详情返回。失败任务只在运行历史中显示错误，不混成 Result；上例表示前述 airun_summary_v1 重试成功后的结果。`GET /messages?mailboxId=mbx_demo&syncRunId=sync_demo` 返回邮件摘要集合（不含 bodyText），另支持 contentState、receivedFrom、receivedTo。用于查看本轮入库邮件及选择未执行任务的邮件；syncRunId 指首次入库的同步运行。源邮件详情请求 `GET /messages/msg_demo`：

```json
{
  "id": "msg_demo",
  "mailboxId": "mbx_demo",
  "subject": "确认会议时间",
  "from": {"name": "示例发件人", "address": "sender@example.test"},
  "receivedAt": "2026-10-29T02:01:20Z",
  "ingestedAt": "2026-10-29T02:02:02Z",
  "contentState": "available",
  "bodyText": "请确认明天的会议时间。参会人待定。",
  "attachments": [{"id": "att_demo", "filename": "agenda.pdf", "contentType": "application/pdf", "sizeBytes": 2048, "contentProcessing": "not_supported"}],
  "source": {"provider": "imap", "folderRole": "inbox", "remoteState": "present"}
}
```

只返回安全纯文本；不返回可直接执行/渲染的原始邮件 HTML。`source.remoteState` 为 present、removed 或 unknown；远端删除不立即删除已持久化本地内容。附件元数据的 sizeBytes 可为 null；M1/M2 不提供附件下载或读取内容的接口。

保留期清理后 MailMessage.contentState=expired、bodyText/subject/from=null，仍保留 ID 与最小来源元数据；Result.status=expired、output/draft=null。历史运行继续指向这些墓碑；不得把过期内容标记为仍可阅读或可重试。全文搜索属于后续能力，首版只提供上面的结构化筛选。

### 7.1 结果列表元数据与分页（v0.3 补齐）

首版选定由 `/results` 一次返回足够画列表的关联摘要，UI 不必为每行分别请求 `/messages`。详情正文仍按用户打开的邮件惰性读取。`GET /results?mailboxId=mbx_demo&limit=50` 的 ResultSummary 形状：

```json
{
  "items": [
    {
      "id": "res_demo",
      "revision": 1,
      "status": "ready",
      "mailboxId": "mbx_demo",
      "messageId": "msg_demo",
      "taskId": "task_summary",
      "taskVersionId": "taskver_summary_v1",
      "aiTaskRunId": "airun_summary_v1",
      "template": "summary",
      "outputSchemaVersion": "summary.v1",
      "preview": "邮件请求确认会议时间。",
      "mailbox": {"id": "mbx_demo", "name": "工作邮箱", "provider": "imap"},
      "task": {"id": "task_summary", "name": "邮件摘要", "versionNumber": 1},
      "message": {
        "id": "msg_demo",
        "subject": "确认会议时间",
        "from": {"name": "示例发件人", "address": "sender@example.test"},
        "receivedAt": "2026-10-29T02:01:20Z",
        "contentState": "available",
        "attachmentCount": 1
      },
      "createdAt": "2026-10-29T02:25:20Z",
      "updatedAt": "2026-10-29T02:25:20Z"
    }
  ],
  "nextCursor": null
}
```

preview 为最多 160 字的纯文本；回复草稿采用当前 draft，其余模板从 output 生成，结果内容过期后为 null。mailbox/task 名称为当前名称，task.versionNumber 固定为生成该结果的版本；关联对象只剩墓碑时 name 可为 null，以 ID 展示。message.subject/from 在源内容过期或不可读取时为 null；attachmentCount 为非负整数，元数据已清理时为 null。关联摘要是只读投影，不改变各资源的所有权或凭据范围。

分页固定按 `(createdAt DESC, id DESC)`，不按会变化的 updatedAt 排序。首次不传 cursor；返回 nextCursor 非空时，后续请求原样传为 `cursor` 并保留原筛选和 limit。服务端使用签名的不透明 keyset 游标，绑定用户、筛选、limit、最后一项排序键，15 分钟过期；筛选改变、游标篡改或过期均返回 400 INVALID_CURSOR。UI 保留筛选并从第一页重载，不能自行拆解 token。

服务端读取 limit+1 项决定 nextCursor，null 才表示到底；不返回虚构 total、页码或百分比。跨页不承诺数据库事务快照：用户刷新第一页查看新结果，内容清理或并发提交可能改变之后可见的集合。按 ID 合并已加载结果，变更筛选时清空原游标与页面缓存。

## 8. 回复草稿编辑与复制（模板能力 M2）

reply_draft 的 Result.output 是不可变的模型原始输出；`draft` 为用户当前编辑版本，初次生成时由原始 subject/bodyText 初始化。示例：

```json
{"output": {"subject": "Re: 确认会议时间", "bodyText": "您好，请问明天几点方便开会？", "language": "zh-CN"}, "draft": {"subject": "Re: 确认会议时间", "bodyText": "您好，请问明天几点方便开会？", "editedAt": null}}
```

`PATCH /results/res_draft/draft`，`If-Match: "res_draft:1"`：

```json
{"subject": "Re: 确认会议时间", "bodyText": "您好，我明天下午三点方便，您看是否合适？"}
```

返回完整 Result，revision=2、status=edited，draft 更新且 editedAt 非空，output 不变。两个页面同时编辑用 412 防止覆盖；UI 保留用户未保存文字并提示重新加载/合并。

“复制正文”使用当前编辑器中的文字，“复制主题与正文”按 `主题：…\n\n…` 组合；有未保存修改时先提示其仅复制、尚未保存。复制在浏览器本地调用剪贴板 API，不发后端请求、不触发 AI、不发送邮件；失败时保留可选择文本供键盘复制。首版没有发送邮件接口。

## 9. IMAP 恢复待判定项

跨 UIDVALIDITY 无法可靠确认同一封邮件时，持久化 RecoveryItem，暂不产生新的 AI 结果。M1 通用 IMAP 没有已验证的原生稳定对象 ID 时，对恢复快照中所有身份未确认的条目采用此路径；候选可以是 0/1/多个，不因内容相似就静默合并。reason 为 identity_unconfirmed 或 identity_ambiguous。`GET /mailboxes/{id}/recovery-items?status=pending` 返回：

```json
{"items": [{"id": "recovery_demo", "status": "pending", "mailboxId": "mbx_demo", "reason": "identity_ambiguous", "candidateMessageIds": ["msg_demo"], "receivedAt": "2026-10-29T02:01:20Z", "subject": "确认会议时间", "createdAt": "2026-10-29T03:00:00Z"}], "nextCursor": null}
```

`POST /recovery-items/recovery_demo/resolve` 接收 `{"action":"link_existing","messageId":"msg_demo"}`，或 `{"action":"keep_separate"}`。前者把新来源别名关联已有邮件，不重复执行同版本任务；后者显式确认是独立邮件并创建新 MailMessage、按当前启用的绑定生成任务。响应 `200`：`{"id":"recovery_demo","status":"linked","messageId":"msg_demo"}`；keep_separate 时 status 为 kept_separate。

候选邮件必须同邮箱且属于该恢复项；重复同一决定返回原结果，相反决定返回 409 RECOVERY_ALREADY_RESOLVED。正文比对通过候选的 `/messages/{id}` 及 `GET /recovery-items/{id}` 读取，后者在列表字段之外返回 contentState、bodyText、attachments，与 MailMessage 使用相同类型。恢复项过期/内容不足时返回明确的不可判定原因，不默默丢弃。此接口是 M1 IMAP 恢复设计的一部分；原型若仅展示告警而未展示处理入口，应在 UI 交接中注明缺口。

### 9.1 RecoveryItem 详情 DTO（v0.3 补齐）

`GET /recovery-items/recovery_demo` 返回以下完整形状。恢复项的 contentState=available 只表示待判定正文可读；是否已确认身份由 status 决定，不据此自动执行 AI。

```json
{
  "id": "recovery_demo",
  "status": "pending",
  "mailboxId": "mbx_demo",
  "reason": "identity_ambiguous",
  "source": {"provider": "imap", "folderRole": "inbox", "remoteState": "present"},
  "subject": "确认会议时间",
  "from": {"name": "示例发件人", "address": "sender@example.test"},
  "receivedAt": "2026-10-29T02:01:20Z",
  "contentState": "available",
  "contentUnavailableReason": null,
  "bodyText": "请确认明天的会议时间。参会人待定。",
  "attachments": [{"id": "att_recovery_demo", "filename": "agenda.pdf", "contentType": "application/pdf", "sizeBytes": 2048, "contentProcessing": "not_supported"}],
  "candidateMessageIds": ["msg_demo"],
  "allowedActions": ["link_existing", "keep_separate"],
  "resolution": null,
  "createdAt": "2026-10-29T03:00:00Z"
}
```

所有字段均返回。subject/from/receivedAt 在尚未取到合法元数据或按政策清理时允许 null；bodyText 不可用时为 null，不用空串冒充完整正文。attachments 与 MailMessage 相同，无元数据用 []；candidateMessageIds 为同邮箱建议候选 ID 数组，可以为空，UI 选中候选后读取其 `/messages/{id}` 对照。

contentUnavailableReason 为 null、expired、too_large、fetch_failed、normalization_failed 之一；非空时附带可理解的不可用提示。待判定且完整内容可用时，存在候选才提供 link_existing，keep_separate 可用；内容不完整/过期时 allowedActions=[]，不允许通过“保留独立邮件”把缺失正文送入 AI。服务端重新校验动作，不能信任客户端缓存的 allowedActions；不可判定提交返回 409 RECOVERY_CONTENT_UNAVAILABLE。

已决定时 status 为 linked/kept_separate，allowedActions=[]，resolution 为 `{action,messageId,decidedAt}`，均为非空值；其余身份字段保留，正文仍受保留期控制。候选内容已经过期时，UI 明示候选原文不可读，不能把标题/指纹建议当成自动关联证据。此 DTO 不提供原始 UID、游标、凭据或未脱敏服务商错误。

## 10. 错误契约

非 2xx 统一返回：

```json
{
  "error": {
    "code": "MAILBOX_AUTH_REQUIRED",
    "message": "邮箱授权已失效，请重新授权后重试。",
    "retryable": false,
    "action": "reauthorize_mailbox",
    "requestId": "req_demo",
    "details": {"mailboxId": "mbx_demo"}
  }
}
```

异步失败保留在 ConnectionTest/Run.error；查询该失败资源仍返回 200。error.action 为 none、edit_configuration、reauthorize_mailbox、retry_run、wait、review_recovery、reload_resource 之一。details 只含经过白名单处理的字段（例如 fieldErrors、retryAfterSeconds、activeRunId、latestRunId），不返回密码、token、原始提供方响应、邮件正文或完整提示词。

| HTTP | code 示例 | UI / 调用方处理 |
| --- | --- | --- |
| 400 | INVALID_CURSOR, INVALID_REQUEST | 修正请求或从第一页重新查询 |
| 401 / 403 | UNAUTHENTICATED / FORBIDDEN, CSRF_FAILED | 恢复登录或会话校验 |
| 404 | RESOURCE_NOT_FOUND | 显示资源不存在，不泄露其他用户资源 |
| 409 | IDEMPOTENCY_KEY_REUSED, RUN_NOT_RETRYABLE, RUN_SUPERSEDED, SOURCE_CONTENT_UNAVAILABLE, RECOVERY_ALREADY_RESOLVED, RECOVERY_CONTENT_UNAVAILABLE, CONFIGURATION_CHANGED, CREDENTIAL_AUDIENCE_MISMATCH | 显示冲突及恢复入口；有已有运行时跳转，凭据目标不匹配时配置该版本的新密钥 |
| 412 / 428 | REVISION_CONFLICT / PRECONDITION_REQUIRED | 保留编辑文本，重新读取 ETag |
| 422 | VALIDATION_FAILED, MODEL_SETTING_UNSUPPORTED, MODEL_LANGUAGE_UNSUPPORTED, MAILBOX_AUTH_REQUIRED, MAILBOX_TEST_REQUIRED | 展示字段错误、连接测试或授权入口；不要立即循环重试 |
| 429 | RATE_LIMITED, QUEUE_CAPACITY_REACHED | HTTP Retry-After 与 details.retryAfterSeconds 一致；等待后重试 |
| 501 | FEATURE_NOT_AVAILABLE | 明确展示后续阶段能力，不伪造成功 |
| 503 | DEPENDENCY_UNAVAILABLE | 有界重试；已接受的异步运行不另开一份 |

运行内还可能出现 MAILBOX_NETWORK_ERROR、AI_SERVICE_AUTH_REQUIRED、AI_SERVICE_TIMEOUT、AI_RATE_LIMITED、AI_OUTPUT_INVALID、MAIL_CONTENT_TOO_LARGE、SYNC_CURSOR_EXPIRED、DEDUP_REVIEW_REQUIRED、BACKPRESSURE、CONTENT_EXPIRED。AI 凭据失效时 AITaskRun.status=failed、对应配置版本 connectionState=auth_required，error.action=edit_configuration，details 指向原 configVersionId；auth_required 不是 AI 运行状态。游标失效通常由后端自行恢复；结构化输出无效最多再尝试一次，之后需要检查模型/任务配置。429 不等于认证失败，不能清空有效凭据。

## 11. 实现与联调自查清单

- 请求/响应的 ID、template、run.kind、状态枚举及错误 action 必须按本契约一致使用。
- UI 以连接状态、syncPolicy.enabled、activeSyncRunId、各 AI 运行分别渲染；显示上次成功、下次计划检查与等待重试时间。
- 以“同请求重放、同邮件重复同步、同版本重试、新版本重跑”四种场景验证唯一性；结果详情保留完整来源与版本链。
- M1 邮箱测试不读取正文；AI 服务测试只使用固定样本；设计和原型不执行真实连接。
- 验证草稿 412 冲突、剪贴板失败、空同步、单任务失败、队列背压与 UIDVALIDITY 恢复入口。
- 本文的接口设计不构成测试通过声明；交接中的实际文档检查结果记录在 backend-design.md。
