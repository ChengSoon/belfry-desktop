# 旧协作 Skill 残留与原生迁移核查

日期：2026-11-15。T16 后续源码修正完成；本机文件仅只读核查，未手工迁移真实用户目录或重启用户会话。

## 已确认的原因与范围

用户截图的房间提示已指定 A2A 工具，但 Agent 随后读取了旧 `belfry` Skill。仓库删除资产、停止自动安装，与客户端已经不再发现旧副本是不同结论；首期没有验证后者。

| 本机来源 | 只读结果 |
| --- | --- |
| `~/.codex/skills/belfry/SKILL.md` | 原样旧副本仍存在，文件和该配置根均不是符号链接 |
| `~/.mirasim/skills/belfry/SKILL.md` | 同一原样旧副本仍存在，共享来源目录不是符号链接 |
| `~/.claude/skills`、`~/.agents/skills` | 符号链接，解析到 `~/.mirasim/skills`，可再次发现同一副本 |

两份文件的 SHA-256 均为 `163a3a20580f095be07a09ac35dacf24c2079613f86f017e4619d78178d4b469`，与首期迁移的已知原内置中文版本一致。读取未输出任何凭据。

[普通桌面启动](../../src-tauri/src/lib.rs) 调用 `setup::migrate_collaboration_on_startup`；CLI hook 和 daemon 路径先返回。当前 installed/debug 进程并存只证明多个进程存在，不能据此锁定截图宿主版本、断言旧版重装了 Skill，或解释 `.codex` 文件为何仍存在。

首期只检查 CLI 配置根和 `.agents`，并保护符号链接；没有直接检查实际 `.mirasim` 来源。这是已确认的源码覆盖缺口。

## 本轮修正

[迁移](../../src-tauri/src/setup/migration.rs) 增加对 `.mirasim` 已知共享根的直接检查，继续只删除两种已知原内置哈希的原样文件。不从符号链接发现删除目标，不删除链接、自定义内容、相邻文件或其他 Skill。链接路径仍可能被保守标记为无法确认，不能把该状态本身当成实际内容仍存在。

[房间投递提示](../../src-tauri/src/collab/inbox/scheduler.rs) 提供 A2A 工具入口，模型工具列表缺少所需工具时，报告工具名称。用户进一步反馈后，已删除每条消息中重复的旧 Skill / CLI 退役说明，将缺失处理合并到原 A2A 工具指引。该提示帮助选择正确入口，不能使一个未更新的客户端自动获得新工具，也不证明真实模型已经遵循提示；模板更新只影响新生成的消息，已投递历史不会重写。

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked a2a_skill_migration -- --nocapture` | 5 通过，0 失败 / 忽略；新增临时共享来源与链接、自定义副本、其他 Skill 和重复执行回归 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked collab::inbox:: -- --nocapture` | 32 通过，0 失败 / 忽略；覆盖实际投递载荷、权限、生命周期和消息状态 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked local_a2a_two_embedded_mcp_sessions_use_real_http_and_bound_reports -- --nocapture` | 1 通过；实际 embedded MCP / HTTP / 权威任务 / 显式报告往返，调用身份与投递回调仍为受控夹具 |

每项命令、退出码、时间和完整输出在 `/tmp/belfry-a2a-skill-residual/{migration,inbox,embedded-http}.{json,log}`。新增迁移测试只使用临时目录和合成已知哈希，不重新捆绑退役 Skill 正文。Rust 格式检查与文档检查另记录于最终交付。

本次没有重跑首期全部前端、workspace、插件 / 浏览器和网站构建；原始总数见 [首期验收](a2a-validation.md)。未启动真实模型，未调用真实远端 Agent，未执行真实用户目录迁移、应用部署或平台打包。

生效需要启动含这些源码的新桌面宿主；CLI 实际获得 A2A 工具后才能完成切换。当前文件仍保留、已运行会话仍可携带旧说明，不能宣称本机已全部清理。入口与排查步骤见 [指南](a2a-guide.md) 和 [工具目录核查](a2a-skill-residual-tools.md)。
