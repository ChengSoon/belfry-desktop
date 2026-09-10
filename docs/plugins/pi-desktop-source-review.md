# PI-Desktop 插件源码核对

> 历史调研快照：文中“Belfry 当前”指 2026-09-09 移植前的实现，不代表现在的功能。
> 最新能力、互操作证据与限制见 [移植执行记录](./pi-desktop-port.md)，制作与发布见
> [自有市场使用指南](./own-market-guide.md)。

日期：2026-09-09。对象：用户指定的 `vastsa/PI-Desktop`。
本次通过 GitHub API 确认 HEAD，并固定读取提交
[`4fb58d36f4b0f05e4527d8bdf2da874e31933134`](https://github.com/vastsa/PI-Desktop/commit/4fb58d36f4b0f05e4527d8bdf2da874e31933134)。
结论来自开发文档与实际调用链；未构建或运行上游应用。

## 结论

PI-Desktop 需要 `manifest.json`，并提供工具自动生成初始清单。
作者可以在应用中选模板、使用 CLI，或让内置 Agent 调用开发工具；安装用户选择目录、
`.piplug` 包或市场条目，无需单独创建、选择清单。

上游已实现第三方 JavaScript 的独立进程运行、宿主 API 和插件 UI。
Belfry 当前完成的是静态插件管理，包后缀相同不代表清单和运行时兼容。

## 作者如何生成插件

应用路径：插件页菜单 → 从模板新建插件 → 选模板 → 选空目录。
`PluginsPage.createFromTemplate` 调用 Electron IPC，主进程依次调用
`scaffold`、Rust 的 `plugins.loadDev`、`PluginRuntime.loadFromPath`，然后启动目录监听。
前端再将创建的目录打开为当前项目。

内置模板为 `panel-basic`、`agent-tool-basic`、`skill-pack`、`full-demo`。
`templates.ts` 根据模板构造清单中的身份、入口、权限和贡献，同时写入实际资源；拒绝非空目录。
以 `panel-basic` 为例，生成：

```text
my-plugin/
├── manifest.json
├── main.js
├── README.md
└── renderer/index.html
```

仓库 CLI 路径（以下为上游命令，未在 Belfry 中执行）：

```bash
pnpm install
pnpm --filter @pi-desktop/plugin-devkit... build
pnpm pi-plugin init panel-basic ../my-plugin --id local.my-plugin
pnpm pi-plugin check ../my-plugin
pnpm pi-plugin pack ../my-plugin
```

默认产物为 `../my-plugin/dist/local.my-plugin-0.1.0.piplug`。
devkit 是私有 workspace 包，不能假定可脱离上游仓库直接从 npm 安装。
内置 Agent 的 `PluginScaffold`、`PluginCheck`、`PluginPack` 复用同一套 devkit，并限制在会话工作区内。

来源：[开发指南][guide]、[模板生成][templates]、[CLI][cli]、[创建入口][create]、[Agent 工具][dev-tools]。

## 打包与安装如何接起来

`pack()` 先运行 `check()`，有阻塞错误时不打包；随后生成 ZIP Store 容器，输出
`<id>-<version>.piplug` 和 SHA-256。安装时不编译 TypeScript，也不替插件执行依赖安装。

本地包入口只选择 `.piplug` / `.zip` 文件。Electron 调用 Rust 的
`plugins.installFromPackage`；后端复用目录安装流程，在暂存目录读取或解包，读取清单、
检查资源，再复制到受管目录、保存安装记录；启用后交给 JavaScript 运行时加载。
开发目录直接引用源目录，支持保存后热重载和手动重载。

来源：[打包器][pack]、[包导入入口][install-ui]、[Rust 安装器][installer]。

## 运行架构

| 层 | 实际职责 |
| --- | --- |
| `plugin-devkit` | 模板生成、校验、打包，以及发布材料准备 |
| `plugin-sdk` | 清单、贡献、宿主 API 类型与部分校验 |
| Rust `host-core/plugins.rs` | 安装、注册表、启停状态、开发目录与市场记录 |
| Electron `plugin-runtime.ts` | 每插件进程管理、贡献注册、宿主 API 分发、权限判断、重载与清理 |
| `plugin-host-process.mjs` | 注入全局 `pi`，加载插件入口，执行回调和生命周期 |
| `plugin-panel-host.ts` / `plugin-view-host.ts` | 独立窗口或工作面板视图、受限桥接、隔离会话 |

每个插件由 Electron `utilityProcess.fork` 创建专用 Node 进程。
宿主校验 `manifest.main`，子进程加载 JS 并调用 `onLoad()`；禁用或卸载时调用
`onUnload()`、撤销贡献并终止该插件进程。当前实际触发的生命周期是这两个钩子。

插件通过 `pi.commands.register({ id, title, run })` 注册真正的执行回调；
Agent 工具同样通过进程消息调用。`pi.*` 请求回到宿主，由宿主校验 API 和权限。
HTML 面板获得 `window.pluginBridge`；其窗口启用 `contextIsolation`、`sandbox`，禁用 Node 集成。

来源：[运行时加载][runtime]、[子进程入口][process]、[API 分发][broker]、[面板窗口][panel]。

## 与当前 Belfry 的差距

| 能力 | PI-Desktop 当前源码 | Belfry 当前实现 |
| --- | --- | --- |
| 创建与分发 | UI 模板、CLI、Agent 开发工具 | 示例清单与 Python 打包示例 |
| 包导入 | ZIP Store 包、目录、市场安装 | ZIP32 Store 包、目录安装与开发加载 |
| 清单 | `main`、`engines.piDesktop`、多类贡献 | 私有 `compatibility` 与三类静态贡献 |
| 命令 | JavaScript `run` 回调 | 展示、复制静态正文 |
| Skill | 权限控制后进入 Agent 的可用技能集合 | 查看、复制文本 |
| 设置 | 类型声明、读取、修改与持久化 | 展示静态默认值 |
| 扩展能力 | Agent tools、panel/view、theme、MCP、service、bus | 尚未实现 |
| 插件代码运行 | 独立 Node 进程、`pi` API、生命周期 | 尚未执行第三方代码 |

直接比较上游 `examples/plugins/hello/manifest.json` 和本地示例可以确认：
上游命令声明不含本地要求的 `text`；Skill 可以是路径字符串；设置使用 `key/type`；
本地清单还会拒绝未知字段。因此不能把上游包换后缀后视为可用的 Belfry 插件。
本地依据：[清单解析](../../src-tauri/src/plugins/manifest.rs)、[贡献界面](../../src/plugins/ContributionBrowser.tsx)。

## 采用上游设计时需区分的事实

- 文档描述包安装前权限确认，但本次提交的本地安装处理器直接传 `enable: true`，
  没有独立的预览或授权交互；后端未收到 grants 时采用清单声明。不能把文档描述当作此入口的实测。
- 独立 Node 进程提供进程隔离；原生 Node API 仍可达，权限网关约束的是宿主 `pi.*` API。
  上游开发指南也明确说明尚非操作系统级能力沙箱。
- Electron 的 `utilityProcess`、`BrowserWindow` 不能直接搬到 Belfry 的 Tauri 宿主；
  需要明确插件运行进程、消息协议和 WebView 桥接方案，再逐项验证兼容能力。

后续对齐应优先明确目标清单与可执行命令的验收，再补模板生成、统一校验和打包工具，
并逐步接入 Agent 工具与 UI。基础作者工具有独立价值，不必等市场建设完成。
本轮仅核对源码和更新文档，未改变应用清单、运行时或已验收的静态包行为。

[guide]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/docs/plugin-development.md#L35
[templates]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/packages/plugin-devkit/src/templates.ts#L78
[cli]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/packages/plugin-devkit/src/cli.ts#L8
[create]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/apps/desktop/electron/main/index.ts#L8151
[dev-tools]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/apps/desktop/electron/main/plugin-dev-tools.ts#L76
[pack]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/packages/plugin-devkit/src/pack.ts#L119
[install-ui]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/apps/desktop/electron/main/index.ts#L8214
[installer]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/crates/host-core/src/plugins.rs#L741
[runtime]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/apps/desktop/electron/main/plugin-runtime.ts#L896
[process]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/apps/desktop/electron/main/plugin-host-process.mjs#L334
[broker]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/apps/desktop/electron/main/plugin-runtime.ts#L1410
[panel]: https://github.com/vastsa/PI-Desktop/blob/4fb58d36f4b0f05e4527d8bdf2da874e31933134/apps/desktop/electron/main/plugin-panel-host.ts#L321
