# P0 任务 4wej4rg0 核查证据

日期：2026-09-08。执行目录：`/Users/cheng/work/Project/tool/otty-win`。

## 当前实现与边界

- 已有 Prompt/Recipe TS 校验、目录投影、mutation 纯逻辑与只读 PluginPanel。
- Rust 仅注册 plugins_list；store.rs 引用不存在的 super::manifest，使用 manifest 字段，前端仍使用 currentManifest。
- 目录预览/安装、启停/重载/卸载、事务化静态贡献和 Harness 适配尚未实现。
- belfry inbox 仅列本任务；无法据此证明其他会话没有写入。工作区有大量既有未提交改动，本轮未改源码或回滚文件。
- 新对齐计划要求目录插件；旧 technical-design/phase-two-design 描述内联 JSON 插件和不同的持久化语义，未找到新冻结契约记录。

## 实际验证

运行时间：本地 13:59:57 开始；均读取了最终退出码。

| 命令 | 结果 |
| --- | --- |
| pnpm exec vitest run src/plugins | 退出 0；5 文件、47 测试通过 |
| pnpm test | 退出 0；72 文件、542 测试通过 |
| pnpm build | 退出 0；Vite 提示存在超过 500 kB 的 chunk |
| cargo test（src-tauri） | 退出 101；E0432，src/plugins/store.rs:3 无法导入 super::manifest；未进入测试执行 |

未执行桌面冒烟；上述前端通过不代表 P0 闭环完成。

## 待确认的具体提案

1. 私有 manifest v1 使用身份、版本、兼容性、permissions、activationEvents，以及 commands/skills/settings/harnesses 贡献。
2. registry 延续十进制字符串 revision；entry 采用 manifest/enabled/source/sourcePath/installedAt/updatedAt/error，并明确旧格式拒绝或迁移策略。
3. inspect 只读，返回预览及内容摘要；install 按摘要复验，普通安装复制至 installed/id，开发加载引用原目录，默认禁用。
4. owner 锁内提交原子 registry；启用失败禁用；静态目录仅投影已启用且完整验证的贡献；明确多文件安装回滚与启动恢复策略后实现。
5. Harness 通过私有适配器接入，不修改共享协议、根配置或依赖。

需派发方提供已有批准记录，或批准上述具体契约/目录持久化边界，并核对插件目录写入归属。

## 协作回报

两次 belfry send 项目经理1 --parent 4wej4rg0 均退出 1：
“目标会话现在收不了指令（不是 Agent，或已退出）”。
因此未假定对方已收到回报；使用任务 fail 通道报告阻塞，不能标记 done。
