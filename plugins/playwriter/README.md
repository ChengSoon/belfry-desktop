# Playwriter 浏览器助手

让 Belfry 中的 Agent 操作你已经登录的 Chrome：读取页面、点击、填表、截图和调试。插件内置 Playwriter 0.11.0 运行组件，无需手动运行 npm 或配置 MCP。

## 安装与使用

1. 在 Belfry 的 **设置 → 插件 → 插件市场**，选择 **Belfry 插件中心 · GitHub**，刷新后找到 **Playwriter 浏览器助手**，安装并启用。
2. 打开插件面板，点击“打开 Chrome 扩展商店”，安装 [Playwriter 官方扩展](https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe)。
3. 在平时使用的 Chrome 打开一个普通网页，点击 Playwriter 图标，使其变绿。
4. 在插件面板点击“测试连接”，再在 Belfry 的项目 Agent 中下任务，例如：“用浏览器助手读取我刚打开的网页，整理主要内容。”

本机“我的插件市场”也提供同一版本。安装 `.piplug` 包也可以：在插件中心选择安装插件包。运行要求为 **Node.js 22 或更新版本**；浏览器端仍需安装官方扩展。首次启用会解压内置组件，之后复用本地缓存。首次版本面向 Chrome；其他 Chromium 浏览器需自行安装相同扩展后验证。

点击浏览器扩展图标可断开对应网页。停用 Belfry 插件会释放它持有的浏览器连接；插件自己启动的本地服务随之关闭。浏览器和已有标签页保留。若本机原本已有 Playwriter 服务，插件会复用它，停用时保留该服务。

## 提供给 Agent 的工具

| 工具 | 用途 |
| --- | --- |
| `playwriter_status` | 检查内置组件、连接和扩展状态 |
| `playwriter_help` | 读取对应版本的 Playwriter 使用指南 |
| `playwriter_execute` | 执行 Playwright JavaScript，读取网页、点击、填表、截图 |
| `playwriter_reset` | 清空当前 Agent 会话的执行状态并释放连接 |

首次执行先读取 `playwriter_help`。没有 `page` 全局，使用 `state.page` 保存页面对象：

```js
state.page = context.pages().find(p => p.url().includes('example.com'));
console.log(await snapshot({ page: state.page }));
```

`state` 和执行器按“项目目录 + Belfry Agent 会话”隔离，同一会话内跨调用保留。浏览器标签页仍是同一浏览器中的共享资源，不能据此视为不同账号或权限的隔离环境。每个插件进程最多保留 16 个执行会话；任务结束时调用 `playwriter_reset` 释放资源。

## Playwriter 研究与适配

上游：[remorses/playwriter](https://github.com/remorses/playwriter)，本插件固定使用 npm `playwriter@0.11.0`。

- 官方扩展通过 `chrome.debugger` 接收本地 WebSocket 转发的 Chrome DevTools Protocol 命令。
- 复用上游 `startPlayWriterCDPRelayServer` 和 `PlaywrightExecutor`，保留页面快照、定位、输入、截图和执行取消等能力。
- Belfry 适配层负责 Agent 工具注册、会话状态、连接引导、测试面板和插件生命周期。
- 服务只监听 `127.0.0.1:19988`，兼容官方扩展的默认连接地址。端口被其他程序占用时报告错误，不结束其他程序；多个浏览器同时连接时提示先保留目标浏览器。
- 不调用上游自动安装、云浏览器或远程共享流程。内置运行组件关闭 Playwriter 遥测，保留依赖内的许可证。
- `runtime.zip` 内置纯 JavaScript 依赖，不附带 Chrome、平台原生模块或用户配置。首次解压校验 SHA-256，校验完成后原子提交缓存；后续启动无需下载依赖。

扩展可以操作连接页面中的登录态。请将实际读取、提交等操作限定在你给 Agent 的任务范围内。

## 开发、验证和打包

在 Belfry 仓库根目录运行：

```sh
node scripts/build-playwriter-plugin.mjs
node --test scripts/playwriter-tests/plugin.test.mjs
node --test scripts/playwriter-tests/browser.e2e.mjs
node scripts/plugin-devkit.mjs check plugins/playwriter
node scripts/plugin-devkit.mjs pack plugins/playwriter
```

构建根据 `build/package-lock.json` 安装固定依赖，忽略安装脚本和可选原生组件，将运行组件生成在 `vendor/` 中；生成文件不提交到 Git，但会包含在 `.piplug` 安装包里。已有同版本依赖目录可通过 `--from <目录>` 构建。真实浏览器测试使用独立的临时浏览器配置，不读取日常浏览器的账号或页面；通过 `BELFRY_PLAYWRITER_TEST_CHROME` 指定支持加载扩展的 Chrome for Testing / Chromium 可执行文件。

源码开发可在插件中心加载 `plugins/playwriter`。更改 manifest 权限后需重新加载并确认。在独立插件中心源码中，也可直接运行 `node plugins/belfry.playwriter/build/build-runtime.mjs` 重建组件。发布到“我的插件市场”使用 Belfry 的 `PluginCheck` → `PluginPublish`，以校验结果中的 digest 锁定发布内容；GitHub 插件中心按该仓库的 CONTRIBUTING.md 打包和重建目录。

## 许可证

Belfry 适配代码沿用本仓库许可证，见 `LICENSE.Belfry` 和 `LICENSE.GPL-3.0`。Playwriter 使用 MIT，原文保存在 `LICENSE.Playwriter`。其他依赖的许可证保留在内置运行组件中。本插件为 Belfry 的适配插件，不代表 Playwriter 官方发布。
