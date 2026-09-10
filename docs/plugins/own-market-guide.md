# 制作插件与自有插件市场

本功能沿用 PI-Desktop 的插件清单、运行接口和包格式；Belfry 自己提供制作、调试、
发布和市场页面。`manifest.json` 由模板生成，安装者直接选择插件包或点击市场的安装按钮。

## 在应用内制作

1. 打开「设置 → 插件 → 更多操作 → 从模板新建插件」。
2. 填写名称、插件 ID、作者，选择模板和空目录。ID 用来识别插件及后续版本，例如
   `myteam.notes`，发布后应保持不变。
3. 应用生成清单、`main.js`、页面或 Skill 示例，并以开发模式加载、打开该目录。
4. 编辑源码，开发模式会重载改动。插件行的菜单提供重新加载、校验、导出包和发布。
5. 打开插件面板或通过命令入口实际验证。新增权限或扩大文件、网络范围需要重新确认。

四个模板：

| 模板 | 适用场景 |
| --- | --- |
| 基础面板 | 有自己页面的工具、小应用 |
| Agent 工具 | 让当前会话的 AI 调用自定义函数 |
| Skill 包 | 可被 AI 读取的说明与工作流程 |
| 完整示例 | 面板、设置、工具、Skill 的组合 |

后台入口使用宿主提供的 `pi` 对象。面板页面使用
`window.pluginBridge.invoke(channel, payload)`；自定义业务消息交给 `main.js` 的
`onPanelInvoke` 处理。声明的工具、权限和页面入口都要与实现一致。

## 发布到我的市场

1. 开发插件行菜单选择「发布到我的市场」，或在「插件市场 → 我的插件市场」选择
   「发布已有插件」。
2. 查看自动校验结果、插件版本和权限，填写更新说明，点击发布。
3. 发布器生成 `.piplug`、SHA-256 摘要和目录索引。这个过程不需要账号，也不上传到外部网站。
4. 自己的插件会出现在市场中，可以安装。修改代码后提高 `manifest.json` 的 `version`
   再发布，市场会保留旧版本并提示可用更新。同一版本不能覆盖为另一份内容。

「我的插件市场」默认保存在应用数据目录的 `plugins/market/personal`。它与已安装插件的
私有设置和运行数据分开。市场名称可以在页面中编辑。

## 让其他人使用你的市场

现在也有独立的 GitHub 插件中心项目，位于 Belfry 源码同级的
`../belfry-desktop-plugins`。它包含源码、发布包、PI 目录、完整网站、模板和 GitHub Actions，
结构参照 `vastsa/pi-desktop-plugins`，可以单独维护、接受贡献和发布。
客户端已加入「Belfry 插件中心 · GitHub」来源；配置目标为
`ChengSoon/belfry-desktop-plugins`，远程仓库尚未创建。
实现和验证见 [独立 GitHub 插件中心](./github-plugin-center.md)。

如果从应用内现有个人市场导出，使用下面的流程：

点击「导出市场网站」，选择空目录，得到：

```text
index.html          可搜索、可下载的独立市场网页
catalog.json        PI 兼容的市场目录
packages/*.piplug   各个发布版本的插件包
.nojekyll           GitHub Pages 静态文件标记
README.txt          部署说明
```

把这个目录整体放到自己的 HTTPS 网站、对象存储或 GitHub Pages。Belfry 页面中选择
「自有在线市场」，填写完整的 `https://你的网址/catalog.json`，点击「保存并连接」或按 Enter。
地址验证成功才会保存；失败保留原市场。其他用户填写同一个地址
即可搜索、安装和更新；也可以在网页直接下载插件包。

本地调试允许 `http://127.0.0.1:端口/catalog.json`。例如在导出目录启动：

```sh
python3 -m http.server 8080
```

市场不依赖 PI 官方目录。PI 公开市场和镜像仅作为可选来源。切换来源不会让自动更新
把已有插件悄悄迁移到另一个市场；需要新增权限或改变文件、网络范围的更新也需手动确认。

## 用命令行制作与发布

在 Belfry 源码目录运行：

```sh
node scripts/plugin-devkit.mjs init panel-basic /path/to/my-plugin \
  --id myteam.notes --name 我的笔记 --author 我的团队
node scripts/plugin-devkit.mjs check /path/to/my-plugin
node scripts/plugin-devkit.mjs pack /path/to/my-plugin --out /path/to/packages
node scripts/plugin-devkit.mjs publish /path/to/my-plugin \
  --market /path/to/my-market --changelog 首次发布
node scripts/plugin-devkit.mjs export-market /path/to/my-market \
  --out /path/to/empty-public-directory
```

Belfry 启动的 Agent 会话还会获得 `PluginScaffold`、`PluginCheck`、`PluginPack` 和
`PluginPublish` 工具。它们只处理该会话工作区内的源码。发布要求使用校验返回的内容
摘要，防止校验后变动的文件被直接发布；发布目标是本地“我的市场”。

## 当前验收

自动化已验证模板生成、作者元数据、发布与重复发布、不可变版本、校验后文件变化、
本地安装准备、静态网站导出、在线目录下载安装、SHA-256、路径越界和链接拒绝。
桌面实际操作与完整 PI 接口的进度以 [移植执行记录](./pi-desktop-port.md) 为准。
