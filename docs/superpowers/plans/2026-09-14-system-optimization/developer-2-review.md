# 开发 2：CI / 工作区交叉审查接续

旧任务 `w4r7c0gn` 的完整报告为 [developer-2-cross-review.md](developer-2-cross-review.md)。当时已执行 `belfry done w4r7c0gn`，命令退出 0 并返回“任务 w4r7c0gn 已结”；项目经理当前无法查询旧编号，本文件按新任务 `h7ahddac` 要求补录，保留原审查快照及验证边界。

## 已确认结论

1. **P1，正常发布被 URL 门禁阻断**：`.github/workflows/release-assets.mjs:26` 只接受 `github.com` 网页下载地址，但 `release.yml:88` 使用的官方 `tauri-action@v1` 实际生成 `api.github.com/repos/.../releases/assets/<id>`。已核对官方 commit `1deb371b0cd8bd54025b384f1cd735e725c4060f` 的源码及 `dist/index.js`，并用资产齐全的本地 fixture 复现拒绝。建议把 URL 精确绑定当前 release 的资产记录，从记录读取文件名。
2. **P2，锁文件门禁可被前置绕过**：`checks.yml:45` 先调用 `bundle-cli.mjs` 的无 `--locked` 构建，可能修正过期锁文件，再使后面的 `cargo test --locked` 通过。隔离无依赖 workspace 已复现 `101 → sidecar 0 / 改锁 → locked test 0`。建议 sidecar 同样使用 `--locked`。
3. **P2，错误网页下载路径被放行**：`release-assets.mjs:27` 的前缀校验允许 `/download/extra/v0.20.2/<filename>`。本地负例未抛错；精确匹配资产 URL 可一并修复。
4. **P2，当前 Node 20 无法执行新增生产 CSS 回归**：`production-panels.case.mjs:44` 调用 `Promise.withResolvers()`，在本机 Node 20.19.2 下定向测试 exit 1，报该方法不存在。CI 使用 Node LTS，本结论限定于已执行的本地环境；建议改用普通 Promise 或明确升级运行时前置。

## 已执行验证

- 发布校验模块：4 项通过，0 跳过。
- 工作区真实临时 Chrome 回归：6 项通过，覆盖 StrictMode 首启、命名工作区恢复、会话身份、启动竞态、存储失败重试和历史会话批量恢复；未发现拆分新增回归。
- 运行器当前枚举 40 个文件；明确排除的恰为 4 项原版 PI Browser / Git Lens / Log Viewer / Todo 互操作。缺生产构建、非法浏览器配置、子测试 skip、缺上游 fixture 四个负例均非零退出。
- 两个 workflow 的 YAML 解析通过，六个引用的官方 Action 定义均 GET 200。已核对草稿、构建依赖、同一 release、串行清单合并和全部构建成功后才公开的顺序。

以上是 2026-09-15 00:18:32 +08:00 快照的审查结论，完整 SHA256、复现条件、命令与证据路径见原报告；不代表后续修复已复验。Windows 原生、远程 workflow、真实签名发布及更新客户端端到端仍待项目经理统一验收。
