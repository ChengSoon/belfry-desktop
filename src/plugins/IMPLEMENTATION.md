# PI 风格静态插件：实现与验收记录

> 历史阶段记录。本文件描述动态运行改造之前的静态基线。
> 当前功能见 [PI 插件使用与开发](../../docs/plugins/pi-runtime-guide.md)，
> 当前实现和验证见 [运行时实施计划](../../docs/plugins/pi-runtime-implementation.md)。

日期：2026-09-09。执行者：当前主会话，按用户要求直接实现并验收。
执行来源：[PI 插件单一方向：P0 收尾任务](../../docs/plugins/pi-only-p0-delivery.md)。
后续接续：[插件包导入](../../docs/plugins/package-import-delivery.md)。
本记录替代此前仍包含 Harness 功能和旧测试数量的交付说明。

## 本轮结果

目录与插件包管理、静态贡献已形成完整闭环，Harness 已退出生产功能。
当前支持 `.piplug` / ZIP32 Store 包安装、目录安装、开发目录加载，以及
commands、skills、settings 三类静态贡献。第三方代码执行和 PI-Desktop 现有插件 API 兼容尚未实现。

## 实现与变更

- 保留私有 directory manifest v1：身份、版本、兼容性、权限和激活声明。
  Rust 负责清单、文件、权限及兼容性的权威校验。
- 保留目录边界：拒绝绝对路径、父目录跳转、反斜杠、符号链接和路径逃逸；
  限制 256 文件、512 总条目、12 层、单文件 2 MiB、总量 8 MiB、manifest 1 MiB。
- 包预览在内存读取，不解压落盘；提交前重新读取包或目录并比对完整文件快照。普通安装保存到受管目录，
  开发加载引用源目录，两者均默认禁用。取消预览可安全退出。
- 保留 owner 锁、字符串 revision、原子 registry 提交、冲突检测、失败回滚和坏插件隔离。
  启用、禁用、重载、卸载均经后端处理，失败保留可读诊断。
- 插件中心以“安装插件包”为主要安装入口，保留目录与开发加载；提供搜索、预览、权限核对和生命周期操作。
  命令与 Skill 可复制，
  设置贡献展示默认值。禁用或卸载后撤销贡献。
- `src/App.tsx`、设置、会话菜单、工作台、弹窗撤下 Harness 入口及 hooks/props。
  `src-tauri/src/lib.rs` 不再编译 Harness 模块、创建其 runtime、注册 IPC 或执行其退出清理。
- `manifest.rs` 与 `host.rs` 保留旧插件的私有解码兼容：缺省或空 `harnesses` 字段可用；
  新包声明 Harness 权限或实际贡献会被拒绝。既有 Harness 插件单项禁用、显示移除诊断，
  enable/reload 不能恢复，仍可卸载，其他静态插件继续工作。
- 前端过滤旧 Harness 贡献，旧别名适配器只返回明确错误，不读取 Harness 宿主或创建会话。
  未删除历史 Harness 源文件，未迁移或清理用户原有 Harness 数据。
- `examples/plugins/review-directory` 已改为独立静态示例，并提供可直接安装的 `review-directory.piplug`。

## 包格式与边界

`package.rs` 负责来源、路径和配额，`zip.rs` 校验 ZIP32 Store 容器；不新增依赖或修改 IPC/registry 格式。
支持上游 PI-Desktop 打包工具采用的不压缩容器，也支持同格式的 `.zip` 扩展名。
中央目录与本地成员记录必须按顺序对应，名称、标志、大小与 CRC 一致。
拒绝加密、Deflate、分卷、ZIP64、分段数据描述符、截断、尾随数据、链接和特殊文件。

归档最大 10 MiB、文件总量最大 8 MiB，沿用目录文件数和深度配额；隐含目录也计入 512 条目上限。
拒绝重复/大小写冲突路径、文件与目录冲突、Windows 保留名称及路径逃逸。
预览失败不写 registry 或受管副本；安装仍复用已有原子提交、revision 和回滚机制。
包安装后源记录指向受管目录，启停、重载和卸载沿用目录生命周期，原始插件包保持不变。

## 回归覆盖与自审

Rust 原有 18 项插件测试继续覆盖受管/开发生命周期、启动恢复、快照复验、revision、
owner 竞争、无效 registry 保留、路径/配额、回滚与坏插件隔离。
新增 `compatibility_tests.rs` 的 4 项测试：

1. 新包的 Harness 权限或实际贡献在安装前被拒绝。
2. 旧空字段或字段缺省不影响纯静态插件安装、恢复及卸载。
3. 旧条目只禁用并诊断一次，不反复增加 revision，不影响其他插件。
4. 旧条目 enable/reload 均不能恢复，disable 保留诊断，卸载保留开发源目录。

包导入新增 16 项测试，插件测试合计 38 项。覆盖标准工具生成的真实包、Unicode 路径、预览取消、
安装复验、重启恢复、卸载保留原包、链接/保留路径/重复冲突、CRC、成员索引、压缩标志、
截断、目录偏移、注释、隐含目录与文件总量边界。CRC 用合法文本的单字节变化验证，
总量用未超过归档外层上限的有效成员验证，避免错误路径之间相互掩盖。

前端覆盖设置分类退出和旧路由回退、registry 缺省字段兼容、旧贡献过滤及旧别名拒绝调用。
新增行为测试先观察失败后实现修复；原 Harness 别名启动测试被撤销/兼容场景替代，
所以前端总数从旧记录的 551 变为 550。Rust 总数较 Harness 阶段下降主要因该模块退出编译，
本次累计新增 4 项兼容和 16 项包导入测试；不把历史模块测试数量当作当前功能覆盖。

主会话按审查清单对照任务前的 51 个文件快照及包导入前的局部快照检查差异，并审阅新增模块和测试。
重点核查生产接线、普通会话关闭、旧条目隔离、撤销时机、revision 幂等及样例独立性。
自审补强了旧条目 reload、有效正文 CRC 和独立总量上限的断言；未发现阻塞本轮静态插件验收的问题。
这是主会话自审，未宣称经过独立审查者评审。

## 命令验证

| 命令 | 实际结果 |
| --- | --- |
| `pnpm exec vitest run src/plugins src/settings/SettingsPanel.test.ts` | 退出 0；7 个文件、57 项通过 |
| `pnpm test` | 退出 0；73 个文件、550 项通过 |
| `pnpm build` | 退出 0；TypeScript 与 Vite 构建完成 |
| `cargo test plugins:: --lib`（`src-tauri`） | 退出 0；38 项通过 |
| `cargo test --quiet`（`src-tauri`） | 退出 0；317 通过、4 忽略；另有 1 项集成测试通过 |
| `cargo fmt --all --check`（`src-tauri`） | 退出 0 |
| `git diff --check` 与本轮文件空白检查 | 退出 0；无缺失源文件或空白错误 |
| 独立配置的 `pnpm exec tauri build --debug --bundles app --config … --ci` | 退出 0；生成本地验收应用 |

最终 Rust 全量命令在补齐包输入边界测试后运行，读取完整日志及退出码。
格式检查曾指出 `mod zip` 的排序，已修正并重新检查通过。
非阻塞提示：Vite 的现有大 chunk 提示；Harness 退出后保留的
`project/resource_path.rs::revalidate` 暂无生产调用，Rust 报 dead-code warning。

## 实际桌面验收

通过 Computer Use 操作独立构建的 `Belfry PI Check.app`，使用独立应用标识
`io.appmakes.belfry.pi-only-check.w743jeax` 与独立数据目录。

| 操作 | 观察结果 |
| --- | --- |
| 设置与新建会话 | 插件分类可达；无 Harness 分类/入口；Shell、SSH、Codex、Claude 选项可见 |
| 示例预览与取消 | 显示 Review Kit 1.0.0、三类贡献及 3 个文件；取消后无 registry 和受管安装目录 |
| 安装与启用 | 安装默认禁用；启用后命令、Skill、设置贡献可见 |
| 命令与 Skill 复制 | 分别复制并粘贴到临时搜索框核对正文，然后清空搜索 |
| 重载、禁用、重新启用 | 重载保留有效贡献；禁用后贡献区消失；重新启用恢复 |
| 退出并重开应用 | 再次进入插件中心，安装记录、启用状态与三类贡献保持一致 |
| 卸载 | 确认后列表为空；registry 插件数为 0，受管目录为空，示例的三个源文件保留 |
| 普通 Shell | 实际创建 Shell 02，确认关闭后回到 Shell 01 |
| Harness 存储 | 隔离应用数据目录未生成 Harness 目录 |

新增包入口使用重新构建的同一隔离应用再次验收：

- 实际选择 Deflate 测试包，得到“不支持该压缩方式”诊断；registry 字节及受管目录保持不变。
- 实际选择 `review-directory.piplug`，预览显示包路径、3 个文件和三类权限；取消不改变持久化。
- 重新选择并安装，默认禁用；启用后三类贡献可见。安装出的三个文件逐字节等于原包内容。
- 确认应用完全退出后重开，启用状态与贡献恢复，registry 字节保持一致。
- 卸载后 registry 与受管目录为空，原包通过标准 ZIP CRC 检查，三个文件完整保留。

验收产物根目录：
`/var/folders/kp/vs8hqjps3jvd_9zbqtwc9hdh0000gn/T/belfry-pi-only-qa-w743jeax`。
其中 `cargo-test-final.log` / `current-round.diff` 是目录 P0 阶段记录；
包阶段最终结果见 `package-cargo-final.log`、`package-plugins-test.log`、`package-pnpm-test.log`、
`package-pnpm-build.log`、`package-tauri-build.log` 与 `package-round.diff`。
`screenshots/` 保存安装预览、默认禁用、启用贡献、撤销贡献、重启恢复、卸载空态及普通会话截图，
`new-session-menu.txt` 保存菜单可访问性文本。
包阶段截图以 `package-` 开头，包含错误提示、预览、默认禁用、启用、重启恢复及卸载空态。
验收完成后已退出独立应用，确认其 `isRunning` 为 false。

验证平台为 macOS；未执行 Windows 原生构建。Agent/SSH 入口与既有回归测试已检查，
未为此次验收启动真实模型请求或连接远程 SSH。

## manifest 与 PI-Desktop 的实际差距

核对参考项目 `vastsa/PI-Desktop` 提交 `c5efbe65be9c3553ad817ec55754c933891b0c4d`：
[打包规范](https://github.com/vastsa/PI-Desktop/blob/c5efbe65be9c3553ad817ec55754c933891b0c4d/docs/spec/07-plugins/06-plugin-packaging.md)
明确要求目录或 `.piplug` 包根包含 `manifest.json`。普通用户选择包或从市场安装，
清单封装在包内，无需手写或单独导入。

此前 Belfry 仅有目录导入，本轮已补齐包安装入口。两者清单和运行时仍不兼容：
PI-Desktop 包含 `main`、`engines`、动态 commands handler 等约定；Belfry P0 的命令是静态文本。
包安装已独立验收；后续仍须实现并验证清单适配、宿主 API 和运行时，不能以容器支持声称完整兼容。
P0 不执行第三方 JS、不加载第三方 HTML，不提供市场、沙箱、签名或自动更新。
