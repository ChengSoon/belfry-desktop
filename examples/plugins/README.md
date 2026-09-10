# Belfry 插件示例

## 可执行 PI 插件

当前示例是 [`pi-full-demo/`](./pi-full-demo)，包含真实 JavaScript 命令、HTML 面板、
Echo Agent 工具、Skill 和可编辑设置。

1. 安装 Node.js 20 或更新版本，打开 Belfry **设置 → 插件 → 加载开发目录**。
2. 选择 `examples/plugins/pi-full-demo`，核对预览后安装并启用。
3. 点击 **打开面板** 或运行命令，编辑 **插件设置** 中的欢迎语。
4. 新建项目 Agent 会话，即可通过 MCP 发现工具和 Skill。
5. 修改入口或资源会自动重载；点击 **打包** 可导出给其他人安装。

也可在仓库根目录执行：

```bash
node scripts/plugin-devkit.mjs check examples/plugins/pi-full-demo
node scripts/plugin-devkit.mjs pack examples/plugins/pi-full-demo
```

包输出到示例的 `dist/`。安装者选择 `.piplug` 即可，清单已经在包内。
插件中心的 **从模板新建** 会为作者自动生成 `manifest.json`、`main.js` 和示例资源。
更多接口与兼容范围见 [PI 插件使用与开发](../../docs/plugins/pi-runtime-guide.md)。

`belfry.quick-notes-0.1.0.piplug` 是独立 Belfry 插件中心制作的真实包样本，提供可保存便笺
的 PI 面板。它包含 MIT 许可证与源码；Rust 安装器及 Node 宿主均已验证这个包。
制作与市场流程见 [独立 GitHub 插件中心](../../docs/plugins/github-plugin-center.md)。

## 历史静态示例

以下说明只适用于 `review-directory/` 与 `review-directory.piplug`，用于保留静态兼容验证。

普通安装选择 `review-directory.piplug`，清单和资源已封装在包内。
插件作者可修改 `review-directory/` 源目录，根目录中的 UTF-8 `manifest.json` 描述身份、权限与贡献。
旧 `.belfry-plugin.json` 文件保留为历史 Prompt/Recipe 校验夹具，不用于当前宿主。

## 使用

1. 打开设置 → 插件 → 安装插件包，选择 `review-directory.piplug`。
2. 预览来源、权限、兼容范围和贡献，点击“确认权限并安装”。预览不落盘。
3. 安装默认禁用；点击启用后，命令、Skill、静态设置默认值出现在贡献区。
4. 命令、Skill 可复制后粘贴到 Agent 输入区，由用户确认发送。
5. 禁用立即撤销目录贡献；重载重新验证资源。开发模式引用原目录，卸载不删除源目录。
6. 普通安装保存到应用 plugins/installed 的独立目录；卸载删除受管副本，保留原始包或源目录。

也可以使用“安装目录插件”复制源目录，或使用“加载开发目录”引用源目录并重载修改。
Harness 已退出产品；本示例不需要其他插件或执行环境。

## 包格式

`.piplug` 是 ZIP32 Store（不压缩）包，根目录包含 `manifest.json` 和引用的资源。
也接受同格式的 `.zip` 文件；不支持 Deflate、加密、分卷、ZIP64 或分段数据描述符。
目录记录须按顺序与本地文件记录一致，CRC 必须有效，拒绝重复、冲突路径和符号链接。
当前包文件读取上限 52 MiB，插件文件总量最多 50 MiB；市场下载上限为 50 MiB。
最多 2000 个文件、4000 个总条目，隐含目录也计数。

在仓库根目录使用 Python 标准库重新生成示例包：

```python
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile

source = Path("examples/plugins/review-directory")
with ZipFile(source.with_suffix(".piplug"), "w", compression=ZIP_STORED) as archive:
    for path in sorted(source.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(source).as_posix())
```

此历史示例使用 Belfry 静态清单；动态 PI 插件请参阅上方 `pi-full-demo`。
安装用户只需选择插件包，无需执行打包代码。

## 私有 manifest v1

字段见 `review-directory/manifest.json`。permissions 仅接受 commands、skills、settings；
每类非空贡献需要对应权限。activationEvents 仅支持 onEnable。贡献 ID 在插件内唯一。
commands 为静态正文；skills 引用目录内 UTF-8 文本；settings 是静态默认值说明。
当前不支持可执行 handler、动态设置或 HTML。

版本为无前导零的三段数字，每段不超过 65535。路径只用 `/` 分隔，拒绝绝对路径、`..`、符号链接。
此处清单语义仅描述历史静态示例；存储配额使用当前宿主标准：2000 文件、4000 总条目、
12 层目录、单文件及总量 50 MiB、manifest 1 MiB。
每类贡献最多 100 项，命令和 Skill 正文最多 16 KiB。未知字段、重复 JSON 键和控制字符均拒绝。

安装确认时复验完整文件快照；包或目录内容变化需重新预览。权限或身份变化必须重新安装。
开发目录重载失败会禁用并显示诊断；坏插件不影响其他插件与普通会话。
旧 registry 明确拒绝且原文件保留，不自动迁移或覆写。安装更新暂采用卸载后重新预览。

P0 不执行第三方代码，不加载 HTML，不接联网市场，不宣称提供运行时沙箱或签名认证。
