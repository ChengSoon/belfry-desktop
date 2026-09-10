# PI 插件使用与开发

本轮按 PI-Desktop 的插件模型实现：`manifest.json` 描述插件，`main.js` 执行代码，
宿主提供 `pi.*` API、HTML 面板桥接与 Agent MCP 工具。
参考版本为上游提交 `4fb58d36f4b0f05e4527d8bdf2da874e31933134`，接口由 Belfry 自行实现。
旧静态插件仍可使用；Harness 已停止接入。

## 安装别人分享的插件

1. 打开 **设置 → 插件 → 更多操作 → 安装插件包**，选择 `.piplug`；也可从插件市场安装。
2. 核对名称、版本、来源和权限，确认安装。
3. 页面完成安装后启用插件，列表显示版本、来源、能力和作用范围。
4. 使用插件行的启动入口、工作区视图或启动器打开页面；Quick Open 也可搜索命令。
5. 插件行的菜单提供设置、重新加载、校验、导出包、发布和卸载等操作。

安装者不需要自己生成或编辑 `manifest.json`；它已经包含在插件包内。
包安装会复制到应用数据目录，开发加载则引用源目录。新增权限或扩大文件、网络范围需要重新确认。
停用、卸载会停止进程、关闭面板并撤销贡献；卸载保留原始包和开发目录，也保留插件设置数据。

可执行插件和作者工具需要本机 **Node.js 20 或更新版本**。
应用从 PATH、登录 shell 和常见安装位置寻找 Node；缺失时插件中心显示诊断，旧静态管理仍可用。
插件包含本地代码，启用前应信任作者。每个插件在独立进程中运行，不继承主应用凭证环境；
`pi.*` 调用按声明检查权限，但这不是限制原生 Node API 的操作系统沙箱。

## 创建插件：清单自动生成

在插件中心的更多操作中点击 **从模板新建插件**，选择模板，填写名称、ID 和作者，选择空目录。
工具会在该目录自动写入 `manifest.json`、`main.js` 及配套资源，开发加载并打开为项目；不会覆盖非空目录。

| 模板 | 生成能力 |
| --- | --- |
| 界面面板 `panel-basic` | HTML 面板、打开命令 |
| Agent 工具 `agent-tool-basic` | 可真实调用的 Echo 工具 |
| Skill 技能包 `skill-pack` | Skill Markdown 与插件生命周期入口 |
| 完整示例 `full-demo` | 面板、命令、工具、Skill、可编辑设置 |

创建后即可修改代码并试用。开发目录的代码、HTML 和其他资源变化会自动重载；
清单变化会停止插件，需点击 **重载** 核对。增加权限或修改文件/网络授权范围需重新安装确认。
重载会关闭旧面板，完成后可再次打开。

也可以在仓库根目录使用 CLI：

```bash
node scripts/plugin-devkit.mjs init full-demo ./my-plugin --id local.my-plugin --name 我的插件
node scripts/plugin-devkit.mjs check ./my-plugin
node scripts/plugin-devkit.mjs pack ./my-plugin
```

`check` 只验证清单、权限和资源，不运行代码；`pack` 验证后输出
`my-plugin/dist/local.my-plugin-0.1.0.piplug`，可以直接分享给其他人。
插件卡片中的 **校验** 与 **打包** 使用同一套作者工具；打包会让用户选择输出目录。
依赖应由作者预先打包进 JavaScript，宿主不会执行 `npm install`。

完整可运行示例见 [`examples/plugins/pi-full-demo`](../../examples/plugins/pi-full-demo)。

## 代码入口与面板

入口支持 CommonJS，也支持 ESM；为跨 Node 版本稳定使用 ESM，建议使用 `.mjs` 或
在插件 `package.json` 中声明 `"type": "module"`。`main` 指向对应入口文件。
宿主注入全局 `pi`，加载时执行 `onLoad`，卸载时执行 `onUnload`。
声明的命令和工具仍需在 `onLoad` 中注册实际回调。例如模板中的工具：

```javascript
async function onLoad() {
  await pi.agent.registerTool({
    name: "echo_text",
    description: "返回输入文本",
    schema: { type: "object", properties: { text: { type: "string" } } },
    execute: async (args) => ({ content: [{ type: "text", text: String(args.text) }] }),
  });
}
async function onUnload() {
  await pi.agent.unregisterTool("echo_text");
}
module.exports = { onLoad, onUnload };
```

同时在 `contributes.agentTools` 声明该工具，并申请 `agent.tool.register` 权限。
设置支持 string、number、boolean、select、json、shortcut；与固定上游一致，机密设置 `secret: true` 暂不支持，
不要把凭证作为普通设置、模板默认值或源码内容分发。

HTML 面板通过注入的 `window.pluginBridge` 访问宿主：

```javascript
const settings = await window.pluginBridge.invoke("plugin.getSettings");
await window.pluginBridge.invoke("plugin.setSettings", { partial: { greeting: "你好" } });
const off = window.pluginBridge.on("settings:changed", (values) => render(values));
// 面板销毁前可以调用 off() 撤销订阅。
```

自定义 channel 会交给入口导出的 `onPanelInvoke(channel, payload)`；宿主管理 API 不会转发给插件。
面板在独立 Tauri 窗口中显示，各插件使用独立本地 origin 和访问令牌。资源仅来自通过校验的快照，
网络请求应经权限控制的 `net.fetch`；页面不能直接访问外部网络或任意本机文件。

## Agent 如何使用

在 Belfry 的项目中**新建** Codex 或 Claude Agent 会话，应用会加入私有 MCP 连接。
已启动的旧会话需要重新创建才有连接。无需修改用户全局 Agent 配置。
工具随插件启停变化；Skill 通过 MCP prompts、resources 和 `PluginSkill` 提供，Agent 可按需读取。
Skill 不会自动追加到每次模型请求。

会话还可使用 `PluginScaffold`、`PluginCheck`、`PluginPack`、`PluginPublish`，在自身工作区创建、
校验、打包插件并发布到本地“我的插件市场”。发布需提供校验返回的摘要。
插件文件 API 绑定调用工具的 Agent 工作区，不会因前台切换项目而改变；会话关闭后令牌与后续宿主访问失效。
插件宿主异常重启后，既有 MCP 会话令牌不会恢复，需要重新创建 Agent 会话。

## 当前兼容范围

| 能力 | 当前行为 |
| --- | --- |
| 命令、工具、Skill | 真实 JavaScript 回调；Skill 支持 Markdown frontmatter |
| 生命周期 | 启用后立即加载；应用启动恢复所有已启用插件；声明暂不作懒加载调度 |
| 设置与数据目录 | typed 设置、默认值、partial 合并、原子保存；按插件隔离 |
| 文件 API | readText / writeText / stat / readRange / readPreview / list / glob / remove / requestDirectory / openDefault / reveal；readRange 公开上限 8 MiB，传输自动分块 |
| 文件范围 | workspace 或 userSelected，scope 通配、受保护路径与符号链接限制 |
| 网络 | net.fetch 按 net.domains 校验，有界响应、超时、禁止重定向 |
| 桌面 API | 应用版本/语言/外观、工作区、toast、通知、剪贴板文本、打开外部链接 |
| 面板与 view | 独立窗口、工作区嵌入视图、pluginBridge.invoke/send、文件选择与拖放；大文件支持 FileReader、slice 和 stream |
| 主题 | 校验并应用 CSS 全文、主题选择器、PI 变量适配；深浅模式和语言同步到插件页面 |
| 服务与消息总线 | start/stop、崩溃最多三次退避重启、声明式 topic 发布/订阅 |
| 声明式 MCP | stdio / HTTP 的 tools、prompts、resources、resourceTemplates；分页、目录变更通知、取消、卸载清理与 URI 隔离 |
| 模型与会话 | models.list、agent.complete（Responses / Anthropic）、session.getLlmContext；按已核验的 CLI 会话标识绑定上下文 |
| 浏览器 | 独立 Chromium profile/context、导航、snapshot、截图、元素操作、受限 CDP 和工作区网页预览；画面流与输入嵌入插件页面 |
| 剪贴板历史 | 记录插件写入、显式读取和主窗口粘贴；图片分块返回 Uint8Array。与固定上游一样不做系统剪贴板后台轮询 |
| 自有市场 | 默认本地市场、作者模板、校验、打包、不可变版本发布、导出静态网站、配置自有在线目录、安装与更新 |

以上为当前可用范围，不代表所有现有 PI 插件均无需适配。
`engines.piDesktop` 对应兼容版本 `0.14.6`，支持常用比较、`^`、`~`、通配和 `||`，
不支持所有复杂 semver range。原版 Browser、Git Lens、Log Viewer 已在真实 Chromium 页面和
Node 宿主中运行验证；最新 Tauri 桌面验收另见执行记录。

浏览器能力需要本机 Chrome、Chromium 或 Edge，使用独立临时配置，不复用用户浏览器资料。
页面的文本复制、剪切与粘贴保留原生事件和撤销，自定义复制内容和 iframe 选区已做真实
Chromium 验证；复制文本上限 512 KiB。跨桌面粘贴、富文本和图片仍需对应场景验收。
浏览器页面支持原生 Enter 表单提交、Enter / Shift+Enter 换行、按键长按与数字键盘位置，
并保留网页取消按键、Tab 焦点切换和空格按钮操作；macOS Option 组合产生的字符可正常输入。
原生文件上传等浏览器边缘交互、跨应用全局快捷键和 Windows 桌面仍需对应环境验收。
模型请求目前使用本地测试服务验证，未调用用户的付费模型接口。

切换在线市场前会验证目录；请求失败保留原来源，已经验证的同源离线缓存仍可使用。
自有在线市场的目录地址通过「保存并连接」或 Enter 提交，编辑后切换来源不会被自动保存打断。
「Belfry 插件中心 · GitHub」需要先公开发布对应仓库中的 `catalog.json`。若提示目录 404，
可先使用「我的插件市场」，或填写一个已发布的自有在线市场地址。

## 分发格式与配额

`.piplug` 为 ZIP32 Store（不压缩），根目录包含清单及资源；也接受同格式 `.zip`。
不支持 Deflate、加密、分卷、ZIP64 或数据描述符。可使用本项目或上游的 Store 打包方式。
当前配额为最多 2000 个文件、4000 个条目、12 层目录、单文件及总文件 50 MiB，
本地归档 52 MiB，市场分发包 50 MiB，清单 1 MiB、单个 Skill 64 KiB、单个主题 256 KiB。
主题目录按文件分别传输，避免多个合法主题合并后超过宿主的 1 MiB 单消息限制。

PI 开发目录校验、安装和打包均跳过 `.git`、`node_modules`、`dist`、`.DS_Store`、`Thumbs.db`。
入口、面板、view、Skill、主题必须存在；缺少可选 icon 不阻止安装。
拒绝符号链接、越界路径、大小写冲突及 Windows 保留文件名。

制作、发布与部署流程见 [自有市场指南](./own-market-guide.md)。
实现与实际验证记录见 [移植执行记录](./pi-desktop-port.md)。
