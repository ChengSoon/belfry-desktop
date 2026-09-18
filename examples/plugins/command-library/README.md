# 命令与 Prompt 收藏库

可选的 Belfry PI 插件，按全局或当前项目收藏 Prompt、Shell 命令和常用文本。
搜索标题、正文、分类；内容保存后可归档与恢复。预览填充项目变量，继续编辑后复制，由用户自行粘贴执行。

## 安装与开发

在插件中心加载本目录，或选择已打包的 `belfry.command-library-0.1.0.piplug`。
插件的打开命令可在启动器与 Quick Open 中搜索；停用插件会关闭面板，不影响核心终端。

```sh
node scripts/plugin-devkit.mjs check examples/plugins/command-library
node scripts/plugin-devkit.mjs pack examples/plugins/command-library
node --test scripts/test-command-library.mjs
```

## 变量

| 写法 | 结果 |
| --- | --- |
| `{{project.name}}` | 当前项目名 |
| `{{project.path}}` | 路径原文，适合 Prompt |
| `{{project.path.posix}}` | 单引号引用的 POSIX Shell 路径 |
| `{{project.path.powershell}}` | 单引号引用的 PowerShell 路径 |

命令示例：`cd {{project.path.posix}}`。Shell 引用规则应与实际终端一致；PowerShell 的形式不适用于 cmd.exe。
没有当前项目时仍可保存和复制无项目变量的全局模板。

## 数据与权限

只申请 `ui.panel` 与 `clipboard.write`，不读取剪贴板、不执行命令、不发网络请求。
版本化存档保存在宿主提供的插件数据目录中；普通文本存储不适合凭据、Token 或私钥。
多个窗口保存时核对版本摘要，项目切换后要求重新读取与预览，避免把旧项目路径复制到新上下文。
归档是可撤回的；损坏或新版本存档报错并保留原文件。
