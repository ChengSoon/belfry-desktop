# PI 插件单一方向：P0 收尾任务

日期：2026-09-09。执行来源：用户要求「Harness 的那个功能可以不要了，只需要这个 PI 的插件」，
并授权项目经理确定任务后通过 Belfry 叫「开发」继续编码。

## 目标与当前状态

交付独立的 PI-Desktop 风格目录插件中心；Harness 从产品入口、启动链和插件贡献中退出。
此决定取代旧计划中「保留 Harness」「Harness 适配是 P0 验收项」的要求。

当前 P0 收尾已完成：Harness 生产接线退出，目录预览、安装、启停、重载、卸载、
持久化及三类静态贡献完成回归与独立桌面验收。最终证据见
[实现与验收记录](../../src/plugins/IMPLEMENTATION.md)。

- 前端定向 57 项、全量 550 项通过，`pnpm build` 退出 0。
- Rust 全量 301 项通过、4 项忽略，另有 1 项集成测试通过；含 22 项插件测试。
- 隔离 macOS 应用完成预览取消、安装、启用、复制、重载、禁用、重启恢复、卸载与普通 Shell 验收。
- `cargo fmt --all --check` 退出 0；改动与任务前快照对照自审，保留无关工作区修改。

本轮完成的是去除 Harness 后的 P0。独立插件运行时、动态面板、agentTools、MCP、
主题与市场仍按 P1–P3 分期，不能将静态命令/Skill 复制描述为已执行第三方插件代码。

## 改动范围与分工

最新分工：用户明确要求代码由当前主会话直接实现。「开发」的代码委派已撤回，
停止写入通知为 `xqr38avv`；下列代码、测试、文档与桌面验收均由主会话独占处理。

主会话可修改：

- `src/plugins/**`、`src-tauri/src/plugins/**`、`examples/plugins/**`，含必要测试和实现证据。
- `src/App.tsx`、`src/components/AppOverlays.tsx`、`src/components/Workbench.tsx`、
  `src/components/workbench.css`。
- `src/settings/SettingsPanel.tsx`、`src/settings/SettingsPanel.test.ts`。
- `src/workspace/components/NewSessionMenu.tsx`、`src/workspace/components/Sidebar.tsx`，
  以及这些入口的必要局部回归测试。
- `src-tauri/src/lib.rs`，仅移除 Harness 模块、runtime 管理、IPC 注册及退出清理接线。

用户已授权本次功能取舍涉及的上述接线和插件私有兼容处理，不重复要求同范围批准。
保留原有 Shell、Agent、协作、Provider、PTY 行为；不修改根配置、依赖、CI、其他共享协议。
本轮不批量删除旧 Harness 源码/样例/脚本，不读写或删除用户既有 Harness 持久化数据。
旧源码可以留作未接入的历史文件，但生产入口不得再导入、实例化或注册其能力。
若需要超出清单的实质性修改，先向用户说明具体文件、原因和最小提案。

## 实现顺序

1. 移除设置中的 Harness 分类，新建会话中的 Harness/别名入口，工作台状态与授权弹窗。
   旧 `initialSection="harness"` 安全回退，不渲染空白页；普通会话创建与关闭照常。
2. 移除 App 的 Harness hooks、launch/close/retain 和 props；后端停止注册 Harness commands，
   不在应用启动时创建 Harness runtime、worker、registry 或 audit 文件。
3. 插件产品贡献仅保留 commands、skills、settings；移除 Harness 列表、数量、说明和别名启动。
   新示例应能独立完成安装与启用，无需另装或信任任何 Harness 包。
4. 明确兼容边界并补行为测试，然后回归完整 P0 生命周期。
5. 更新 `src/plugins/IMPLEMENTATION.md`，运行全量验证、桌面冒烟并交差。

## 插件私有兼容边界

- 新插件只声明 commands、skills、settings。`harnesses` 权限或非空 Harness 贡献须由 Rust
  权威校验明确拒绝，预览失败时不安装任何内容。
- 旧的纯静态插件可能携带 `contributes.harnesses: []`；允许缺省或空值兼容，不能使这类
  插件失去安装、启动恢复或管理能力。可保留专用于旧数据解码的私有字段，但不投影贡献。
- 既有 registry 中含实际 Harness 贡献/权限的插件，应单项禁用并提供「该能力已移除」诊断；
  仍可显示与卸载，不能使整个插件列表失败，也不能因此禁用其他有效的纯静态插件。
- 不静默开启权限、不转成其他执行能力、不重写或删除独立 Harness registry/audit。
- 已损坏或旧 Prompt/Recipe 格式 registry 继续明确报错并保留原文件。

## 验收与验证

- [x] 设置保留 Pi 插件中心；会话菜单、工作台和弹窗无 Harness 产品入口。
- [x] 生产入口不引用 Harness；应用启动不创建其 runtime，不暴露 Harness IPC。
- [x] 示例能预览、取消、安装、启用、复制命令/Skill、重载、禁用、卸载，重启状态一致。
- [x] 原 P0 的路径、配额、快照复验、revision 冲突、回滚和坏插件隔离测试持续有效。
- [x] 旧空 Harness 字段兼容；实际旧 Harness 插件可诊断、禁用和卸载，其他插件不受影响。
- [x] 定向前后端测试、`pnpm test`、`pnpm build`、`cargo test` 均读取最终退出码。
- [x] 实际桌面验证设置、新建普通会话、插件完整生命周期；验证平台限于 macOS。
- [x] 自审报告包含改动清单、检查命令、测试数量变化原因和真实限制；不宣称 Windows 已验证。

变更行为涉及私有 manifest 与启动链，新增兼容/撤销回归测试有实际价值；优先先写失败测试。
不为简单文案或删除展示项机械增加实现镜像测试。质量门禁以行为与执行证据落实。

## manifest 与包导入的核实

用户问到 PI 导入为何看不到 `manifest.json`。本计划的参考项目是 `vastsa/PI-Desktop`，
已核对提交 `c5efbe65be9c3553ad817ec55754c933891b0c4d` 的
[打包规范](https://github.com/vastsa/PI-Desktop/blob/c5efbe65be9c3553ad817ec55754c933891b0c4d/docs/spec/07-plugins/06-plugin-packaging.md)：
开发目录和分发包都要求根目录有 `manifest.json`；普通用户选择 `.piplug` 包，清单封装在包内。

目录 P0 收尾时只有目录导入，随后已按接续请求完成 [插件包导入](./package-import-delivery.md)。
两者的 manifest/API 仍不兼容，不能把容器支持等同于运行 PI-Desktop 的现有插件。
清单校验保持有效，普通用户直接选择包即可；动态运行时仍属后续范围。

## 协作记录

- 已完成：主会话直接实现 Harness 退出、兼容回归、差异自审、前后端验证及桌面验收。
- 代码委派保持撤回；不恢复开发会话写入，不创建其他开发子代理。
- 后续接续：包安装已单独完成；动态运行时及既有 PI 插件 API 兼容仍未实现。

跟进：本轮接线源码尚未改变时，已发送进度核实任务 `svnhmfds`；不将投递或会话忙闲当作完成。

阻塞核实：通过 Computer Use 只读查看「开发」终端，实际连续显示
`We're currently experiencing high demand, which may cause temporary errors.`，
并处于 `Reconnecting...`。进度核实消息已在对方终端可见，当前未收到 done/fail，
当时本轮 Harness 退出改动尚未落地。这是开发会话的服务可用性阻塞，非待用户授权；
随后用户明确撤回委派，要求主会话直接实现；服务阻塞已不再影响本轮推进。
原任务 `2kgka4qg` 不应恢复写入，不将旧 P0 验证当成本轮完成证据。

使用技能：`belfry`（撤回委派）、`computer-use`（桌面验收）、`executing-plans`、
`test-driven-development`、`verification-before-completion`；已读取 `requesting-code-review`。
后续搜索在本机 Superpowers 插件目录找到上述技能。按用户要求由主会话实现，保持当前功能分支，
不升级为子代理开发或新 worktree；现有计划与用户授权作为执行来源。`ui-ux-pro-max` 未找到。
