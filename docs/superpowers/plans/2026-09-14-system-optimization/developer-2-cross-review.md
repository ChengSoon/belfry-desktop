# 开发 2 交叉审查：CI、发布与工作区恢复

任务：`w4r7c0gn`。审查完成于 2026-09-15，范围为当前共享差异。确认 **1 项 P1、3 项 P2**；其中 P1 会使正常构建产物无法通过公开草稿前的检查。工作区抽查未发现新增回归。

本次只新增本报告；生产文件和其他开发的代码保持只读。未触发远程 workflow，未提交、推送或还原共享修改。使用 `belfry` 回报。

## 问题（按优先级）

### P1：发布门禁不兼容实际使用的 tauri-action v1 更新地址

- **位置**：`.github/workflows/release-assets.mjs:23`、`:26`、`:29`；调用方 `.github/workflows/release.yml:88`、`:126`。
- **触发条件**：三个目标正常构建并由当前 `tauri-apps/tauri-action@v1` 生成 `latest.json`，随后运行 publish job。
- **证据**：本次只读查询中，官方 `v1` 指向 `1deb371b0cd8bd54025b384f1cd735e725c4060f`。该版本 [inputs.ts:64](https://github.com/tauri-apps/tauri-action/blob/1deb371b0cd8bd54025b384f1cd735e725c4060f/src/inputs.ts#L64) 默认使用 `https://api.github.com`；[upload-version-json.ts:97](https://github.com/tauri-apps/tauri-action/blob/1deb371b0cd8bd54025b384f1cd735e725c4060f/src/upload-version-json.ts#L97) 生成 `/repos/<owner>/<repo>/releases/assets/<id>`，并在第 242 行写入平台条目。实际执行的 `dist/index.js` 也包含同一生成逻辑，已核对，并非只依据未编译源码。
- **复现**：保留三个平台、全部非空资产与签名，将完整 fixture 的平台 URL 设置为对应资产 API URL，例如 `https://api.github.com/repos/ChengSoon/belfry-desktop/releases/assets/100`。本地直接调用 `validateReleaseAssets` 得到 `darwin-aarch64 的更新地址不属于本次发布`。
- **影响**：检查固定要求 `github.com` 网页下载路径，因此正常生成的清单也会失败，草稿不能公开。仅放宽 host 仍不足够：第 25 行把 API URL 末尾的资产 ID 当成文件名，第 29 行仍无法匹配资产。
- **最小修复建议**：把清单 URL 精确绑定到本 release 的非空资产记录，支持该记录的 `url`（API 地址）和 `browser_download_url`；从匹配记录取得 `name` 后检查签名与目标间重复。补一个采用 Action v1 实际输出格式的完整 fixture；现有测试只使用网页下载地址。

### P2：sidecar 前置会更新锁文件，绕过后续 --locked 门禁

- **位置**：`.github/workflows/checks.yml:45`、`:51`；`scripts/bundle-cli.mjs:24`。
- **触发条件**：PR 修改 Rust workspace 的包或依赖信息，但未同步提交 `Cargo.lock`。
- **证据与复现**：在独立临时目录创建无外部依赖的 Cargo workspace，包名为 `belfry-cli`，二进制名为 `belfry`；复制当前 `bundle-cli.mjs`。生成 0.1.0 的锁文件后，仅将包版本改为 0.2.0，然后按以下顺序执行：

  ```text
  cargo test --workspace --locked --offline  -> exit 101，锁文件需要更新
  TAURI_ENV_DEBUG=true node scripts/bundle-cli.mjs -> exit 0，锁文件被更新
  cargo test --workspace --locked --offline  -> exit 0
  ```

- **影响**：新检查流水线中的 sidecar 准备发生在 `cargo test --locked` 前；无锁约束的 `cargo build` 已经修正工作树里的锁文件，后一步无法验证提交中的锁文件是否有效。该脚本行为原已存在，本次新增检查次序将其带入门禁。
- **最小修复建议**：sidecar 的 Cargo 参数加入 `--locked`，并保留真实 sidecar 构建；或在任何可能更新锁文件的前置之前先做不可改锁的校验。增加一个过期锁文件负例，要求前置直接失败且锁文件字节不变。
- **本地证据**：`/var/folders/kp/vs8hqjps3jvd_9zbqtwc9hdh0000gn/T/belfry-d2-cross-review-lock-0lbenbrc/reproduction.log`，包含命令、退出码及前后 SHA256。未改动仓库的 Cargo 文件。

### P2：网页更新地址多一层路径仍能通过完整性检查

- **位置**：`.github/workflows/release-assets.mjs:27`、`:28`。
- **触发条件**：清单中的网页下载 URL 被误写为 `/releases/download/extra/v0.20.2/<filename>`，真实 release 的 tag 仍为 `v0.20.2`。
- **复现**：使用现有完整 fixture，仅把 Windows URL 中的 `/download/` 替换为 `/download/extra/`；本地调用 `validateReleaseAssets` **未抛错**。测试程序已断言这一错误放行行为。
- **影响**：前缀和倒数第二段分别匹配，但整个 URL 并不指向当前 release 的资产；安装器、签名和文件名都存在也不能保证该地址可下载，错误清单仍可能随草稿公开。
- **最小修复建议**：与当前 release 的资产下载 URL 精确匹配，或验证完整下载路径，拒绝额外路径段；补对应负例。P1 建议中的资产 URL 绑定可同时修复本项。

### P2：新增生产 CSS 回归在当前 Node 20 环境立即失败

- **位置**：`src/components/lazy/testing/production-panels.case.mjs:44`；纳入必跑集合的位置为 `.github/workflows/verify-plugins.mjs:22`。
- **触发条件**：在当前工作区实际使用的 Node `v20.19.2` 下运行新增生产回归。该运行时没有 `Promise.withResolvers`。
- **复现命令**：

  ```bash
  node --test --test-name-pattern='production CSS retries' src/components/lazy/testing/production-panels.case.mjs
  ```

  实际 exit 1，目标用例报 `TypeError: Promise.withResolvers is not a function`，位置为第 44 行；其余 3 项因定向筛选跳过。这不是浏览器或 CSS 加载失败，异常发生在 fixture 启动前。

- **影响**：当前本地的生产 CSS 验证无法执行，完整 Node 运行器也会因该用例失败退出。CI 配置使用 Node LTS，本结论限定于已执行的 Node 20 环境，不声称 Windows CI 会出现同一错误。
- **最小修复建议**：使用普通 `new Promise` 保存 resolver，避免单个测试引入更高运行时要求；若决定统一升级开发 Node，则明确版本前置并重新运行整套回归。
- **在途说明**：该文件属于开发 3 正在补充的生产测试，本项依据下方 SHA256 快照记录，未代改。

## 已核对范围

| 范围 | 核对结论 |
| --- | --- |
| macOS / Windows 检查 | 两个平台使用同一显式步骤：前端测试、构建、真实 host sidecar、Rust workspace、插件/浏览器、发布校验；Windows 额外使用 `pwsh` 运行安装脚本测试。 |
| 测试枚举与跨平台命令 | Node 枚举路径并以参数数组调用 `process.execPath`，不依赖 shell glob。当前选择 36 个插件 case 文件、2 个面板 case 文件、1 个工作区 case 文件，再加命令库脚本，共 40 个文件；生产面板测试已纳入。 |
| 浏览器必须执行 | 运行器先检查 `dist/index.html` 和浏览器，再向子进程强制传递 `BELFRY_REQUIRE_BROWSER_TESTS=1`；非零退出和 TAP skip 都使运行器失败。临时负例验证了缺 dist、非法浏览器路径、子测试 skip、缺上游 fixture 均非零退出。 |
| 生产构建前置 | 检查步骤先执行 `pnpm build`；生产 fixture 从 `dist` 读取字节并注入 HTTP 503，不启动 Vite。路径使用 `node:path` 并将服务 URL 分隔符规范为 `/`。 |
| sidecar | host triple 从 `rustc -vV` 获取；debug 构建不强行使用交叉 target，Windows 使用 `.exe`。release 的 beforeBuildCommand 会构建前端和目标 sidecar。锁文件问题见上。 |
| 排除项说明 | 只有 `upstream-runtime.case.mjs` 的 Browser / Git Lens / Log Viewer 三项，以及 `todo-interop.case.mjs` 的 Todo 一项被排除，确为 4 项。README 中英文及步骤摘要均明确另行验收，没有把它们计入通过。提供 `BELFRY_PI_SOURCE` 后检查四个 manifest 并纳入集合；固定上游 commit 仍由提供 fixture 的人保证，运行器不校验 Git SHA。 |
| 草稿与发布依赖 | checks 成功后才 prepare；版本/tag 一致性、已公开 release 拒绝追加、同一草稿、三个目标串行上传、全部 build 成功后 publish 的依赖均已核对。publish 的唯一公开操作在资产校验之后。URL 契约问题见 P1。 |
| 签名及安装器 | 当前 Action v1 的 `uploadUpdaterSignatures` 默认值为 `true`，未发现遗漏 `.sig` 上传开关。门禁要求两个 macOS DMG、Windows NSIS、三平台签名更新包；它没有额外要求 MSI，未将此扩大为缺陷。 |
| Action 版本 | `checkout@v7`、`pnpm/action-setup@v6`、`setup-node@v7`、`upload-artifact@v6`、`github-script@v8`、`tauri-action@v1` 的官方 `action.yml` 均 GET 200；没有根据旧版本印象判定引用无效。 |
| 工作区拆分抽查 | 对照 HEAD 旧实现阅读 bootstrap、persistence、state、environment、projects 和调用顺序；保存内容去重、失败后重试、恢复身份及启动竞态的 6 项浏览器回归通过，未发现新增回归。 |

## 本次实际验证与限制

| 命令 / 验证 | 实际结果 |
| --- | --- |
| `node --test .github/workflows/release-assets.case.mjs` | exit 0，4 项通过，0 跳过；现有 fixture 未覆盖 P1 的 Action API URL。 |
| `node --test src/workspace/testing/workspace.case.mjs` | exit 0，6 项通过，0 跳过，使用本机真实临时 Chrome 实例。 |
| 生产 CSS 定向命令（见 P2） | exit 1，1 项失败；3 项因名称筛选跳过。 |
| 两个 URL 定向负例 | 断言确认：完整 API 资产 URL 被拒绝；带额外路径的网页 URL 被放行。仅本地调用校验模块，没有网络发布。 |
| 隔离 Cargo workspace | 过期锁 `101` → sidecar `0` 且锁发生变化 → locked test `0`，全程 offline。 |
| 运行器四个临时负例 | 缺 dist、非法浏览器路径、刻意 skip、缺上游 fixture 均 exit 1，预期错误文案全部匹配。 |
| Ruby / Psych 解析两个 YAML | 均解析成功；这只证明 YAML 可解析，不等同于 GitHub 执行验证。 |
| 官方 Action 核对 | 只读 GET 定义与源码；核对 `v1` 的实际 `dist/index.js` 中 API 资产 URL 生成逻辑。 |

运行器负例日志：`/var/folders/kp/vs8hqjps3jvd_9zbqtwc9hdh0000gn/T/belfry-d2-cross-review-runner-6uvfazff/runner-negative-cases.log`。

Action 源码证据：`/var/folders/kp/vs8hqjps3jvd_9zbqtwc9hdh0000gn/T/belfry-d2-cross-review-tauri-action-9oh3ueyy/`；实际运行包：`/var/folders/kp/vs8hqjps3jvd_9zbqtwc9hdh0000gn/T/belfry-d2-cross-review-action-runtime-ilhte946/index.js`。

验证平台为 macOS / Node 20.19.2。Windows runner、安装脚本原生执行、真实签名发布、资产下载及更新客户端端到端未执行。本次没有重复项目经理正在进行的全量前端、Rust 与生产浏览器验收；其最终结果仍需统一收口。

## 共享差异快照

- HEAD：`439302a69286b6ff96dbc780433e6491b5a838ea`。
- 首次快照：2026-09-14 23:19:46 +08:00；扩充生产测试快照：23:33:26 +08:00；内容复核：2026-09-15 00:18:32 +08:00。
- 最初记录的 10 个文件在内容复核时 SHA256 均相同；后补记录的生产测试及 README 在扩充快照至复核之间也未变化。共享分支已有大量其他开发的修改，均按所见保留。

| 文件 | 复核 SHA256 |
| --- | --- |
| `.github/workflows/checks.yml` | `8cfae452ee75be65beaed095c59437e373547b921fcc8d3b57f0cae5aa21c8a7` |
| `.github/workflows/release.yml` | `a56c9e2c7fff6f9d9c3277569d0f640d248241448afbb4268cda232e055fbb09` |
| `.github/workflows/verify-plugins.mjs` | `5954d2184af072e665366ece3364343ee1a76ad7707abaf270f3cc51c6a09169` |
| `.github/workflows/release-assets.mjs` | `cf6dc965ede7e71238022bec0ce618410acf72332bd2fdad42301329e9820666` |
| `.github/workflows/release-assets.case.mjs` | `4e88213dfa0511829463e1d9256e8440f7a7c756cd47997c67ca75cdaad4d2fe` |
| `scripts/bundle-cli.mjs` | `674bd22fc6e99ce5b80b25e24c70f45e8f7bb99cdbe357260164b1d87f3f8473` |
| `src-tauri/tauri.conf.json` | `25165dda3b1626a1a595cec2eb01671d8ff591c5b0e8132274f9855fd614ff40` |
| `src-tauri/src/plugins/node/browser-process.mjs` | `1869c0b6cf096ebedc39fbe04df525d00df9e292b873a9d8c5c540c26fac65e1` |
| `src/workspace/useWorkspaceBootstrap.ts` | `71f882f62384b8868641c7c479acee25035897785c83bd6128d2130b544d238c` |
| `src/workspace/useWorkspacePersistence.ts` | `2cdb7fcfde9e0d6645f75741dee89351fb506a8505f1201ce74dffaec6dce889` |
| `src/components/lazy/testing/production-panels.case.mjs` | `b2e2891cf83a5f7f7217235716d4422d8b6c031ad651c6e38f3f598c7354419d` |
| `src/components/lazy/testing/productionFixture.mjs` | `d7aab24446db8ebad722e4975db8b9da94f52af1f738d4c8828712df269d1241` |
| `README.md` | `633ba59eb2f7aeb4aeaf927f26730e7545d3dd5814acaea352cf467dba5685e7` |
| `README.en.md` | `a27fc6a6014bb13fc859f3b0d299b38be1b8c818666fe0ff2a3e4efcafcf3d7f` |
