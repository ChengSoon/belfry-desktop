# 邮件 AI 助手原型 · 验证记录

日期：2026-10-29。基线：`api-contract.md` v0.2。
范围：静态中文交互原型与模拟状态，不验证真实 IMAP、OAuth、AI 提供方、后台调度或生产接口。

## 执行结果

在仓库根目录执行：

```sh
node --test docs/design/mail-ai-assistant/assets/prototype.test.mjs
```

结果：**13 tests / 13 pass / 0 fail / 0 skipped**；全量检查约 26 秒。
完成截图取景复核后，草稿冲突与复制降级用例再次单独通过；原型运行逻辑未因取景调整而改变。

| 用例组 | 实际验证 |
| --- | --- |
| 桌面三入口与六类结果 | 导航、每个结果类型、原邮件切换、资源加载 |
| 从零开始的完整流程 | 新建 IMAP、连接测试、AI 服务测试、任务绑定、手动运行、查看原文、同版本复用、再次检查零新增 |
| 多邮箱统一配置 | Graph 与 IMAP 共用向导，多账号绑定；保存绑定不追溯历史，不无故创建任务新版本 |
| API v0.2 配置版本 | AI 测试携带 configVersionId；换地址产生新配置；旧任务保留旧配置，需显式采用新配置 |
| 授权失效恢复 | 原激活边界、定时状态和失败历史保留；重新连接后显式重试原运行 |
| 同步失败恢复 | 重用 run.id，attempt 增加，保留先前失败记录；其他邮箱不变 |
| 单个 AI 任务失败 | 重试使用原版本；新版本显式重跑生成另一结果；未知负责人／日期保持 null；AI 无 partial |
| 等待自动重试 | 展示 nextAttemptAt，没有重复重试按钮；推进演示时间继续原运行 |
| 草稿保存与复制 | 未保存文本可复制但不保存；output 不变；412 保留输入并允许处理冲突；剪贴板失败保留可选文本 |
| IMAP 身份待确认 | link_existing 不重复处理；keep_separate 创建新邮件并安排当前任务 |
| 筛选、外观与键盘 | 无匹配空态、清除筛选、暖白／石墨／紧凑切换、页签方向键、Tab 焦点约束、Escape 焦点恢复、模拟认证测试失败 |
| 响应式 | 360 / 390 / 768 / 1024 / 1440px 三入口均无横向溢出；390px 可查看原文、配置字段任务和重试失败 |
| 本地文件方式 | file URL 可加载字体、图标、脚本并打开连接向导 |

每组末尾检查：

- 未处理页面异常：0。
- 控制台错误及 CSP 错误：0。
- 本地资源加载失败：0。
- 原型向外部站点或服务发出的请求：0。
- localStorage / sessionStorage 项目：0。

浏览器使用独立、临时 Chrome profile，服务仅监听 127.0.0.1。测试结束关闭浏览器与服务并移除临时目录。
测试中的剪贴板成功与失败使用隔离桩，不写用户系统剪贴板。没有连接真实账号或触发应用生产代码。

## 证据

截图目录为 [screenshots/](screenshots/)，共 18 张。

- [桌面结果与原文](screenshots/desktop-results-1440.png)
- [邮箱连接向导](screenshots/desktop-connect-mailbox.png)
- [桌面配置](screenshots/desktop-configuration-1440.png)
- [桌面运行记录](screenshots/desktop-run-history-1440.png)
- [空状态](screenshots/desktop-empty-state.png)
- [零新增成功](screenshots/desktop-zero-new-mail.png)
- [授权失效](screenshots/desktop-authorization-expired.png)
- [同步失败](screenshots/desktop-sync-failure.png)
- [单任务失败](screenshots/desktop-task-failure.png)
- [草稿冲突](screenshots/desktop-draft-conflict.png)
- [邮件身份确认](screenshots/desktop-identity-recovery.png)
- [石墨外观](screenshots/desktop-graphite-1440.png)
- [手机结果列表](screenshots/mobile-results-390.png)
- [手机结果详情](screenshots/mobile-result-detail-390.png)
- [手机原邮件](screenshots/mobile-original-message-390.png)
- [手机邮箱配置](screenshots/mobile-configuration-390.png)
- [手机任务配置](screenshots/mobile-task-configuration-390.png)
- [手机失败恢复](screenshots/mobile-task-failure-390.png)

关键桌面、手机、石墨、连接向导、草稿冲突画面已目视复核；手机任务标题换行与弹窗焦点问题已修复。

## 验证边界

这是浏览器交互验证，不是后端验收。真实的检查点提交、去重事务、服务重启、OAuth 续期、模型输出质量、配置版本凭据隔离等仍须按交付计划实施与测试。
浏览器复制降级已验证；单份 JSON 导出使用本地 Blob，未在本轮检查下载落盘文件。自动结果数据保留、分页、旧 AI 配置凭据管理及剩余错误分支见 [ui-design.md](../ui-design.md) 的缺口表。
验证夹具只读导入仓库已有 CDP 工具，需在此仓库内运行；HTML 及运行时 assets 可以独立拷贝给评审者。
