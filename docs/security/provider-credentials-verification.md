# M1 Provider 凭据保护：实施验证记录

## 状态

代码实现与本机自动回归已完成；**尚未达到全部平台与真实桌面验收完成的状态**。本轮未发布、未推进 M2、未启动真实用户 Provider 库迁移。工作区并行出现的 hooks/CLI 等无关修改予以保留，不属于 M1 交付。

实现边界及恢复方式见 [Provider credentials](provider-credentials.md)。列表不返回密钥；存储层为了失败关闭仍会认证解密整包，不能将其称为“列表路径完全不解密”。外部 CLI 文件仍可能包含明文凭据。

## 本轮执行结果

环境：macOS / Apple Silicon；最终 Rust 回归使用隔离 HOME 和 CLI 配置目录。

| 检查 | 结果 |
|---|---|
| `pnpm test src/provider` | 5 文件、35 项通过 |
| `pnpm test` | 148 文件、839 项通过 |
| `pnpm build` | 通过；保留现有 >500 kB 分块警告，主入口约 1,239.92 kB / gzip 421.26 kB |
| `TAURI_ENV_DEBUG=true node scripts/bundle-cli.mjs` | 通过；并行 CLI 源码更新后重新构建了一次 |
| `cargo test --workspace --locked`（隔离环境下最终运行） | 688 项通过、11 项 ignored、0 失败；其中 Provider 99 项通过 |
| `provider::store::tests` | 22 项通过，已包含在全量结果中 |
| `provider::store::path_tests` | 1 项通过，已包含在全量结果中 |
| macOS `native_synthetic_master_key_round_trip -- --ignored --exact` | 1 项通过；随机独立 Keychain 条目已删除，测试验证删除后不存在 |
| `node .github/workflows/verify-plugins.mjs` | 171 项通过、0 跳过；包括生产 JS/CSS/共享依赖故障恢复及工作区恢复浏览器测试 |
| M1 Rust 文件 `rustfmt --check`、限定 M1 路径 `git diff --check` | 通过 |

Rust 默认忽略项不是本轮通过项。macOS 原生密钥测试单独显式执行，不包含在全量的通过数内。插件回归未提供 `BELFRY_PI_SOURCE`，因此不包含脚本明确列出的 4 类原版 PI 上游互操作验收。浏览器面板回归使用模拟原生命令，不等于 Tauri IPC/真实 WebView 验收。

### 新增安全覆盖

- v1→v2 加密迁移、重新读取、重复迁移、未知但可识别 Agent 保留。
- 严格解析、重复 JSON 字段、未知版本/结构、损坏数据均拒绝。
- fake 系统存储拒绝、主密钥写后校验失败、密文/引用缺失、AEAD 认证失败。
- 密文写入/读回/元数据提交故障、提交后不确定状态、进程中断等价持久化状态、孤立密文清理重试。
- 保留/替换/清除/删除、旧客户端缺少动作拒绝、更换端点不能沿用旧密钥。
- 普通目录、Debug 和项目状态不泄露合成秘密；敏感配置须先显式确认，关闭与切换丢弃内容，忽略迟到响应。
- OAuth 备份先于外部覆盖持久化；备份失败不改 CLI 文件，配置提交失败恢复 auth；独立备份提交同步密文代次但不提前提交 currentId。
- 真实临时文件系统链路：迁移→解析凭据→Codex 全局切换→独立项目启动配置→官方 OAuth 恢复→替换/清除/删除；同时覆盖 Claude/Pi 适配。系统主密钥使用 fake，CLI 文件仅含合成数据。

## 重跑时的数据隔离

仓库历史用量测试 `usage::service::tests` 有三项默认扫描真实 HOME。**首轮未隔离的全量运行触发了其只读统计路径**；测试输出未包含记录正文，但不能因此声称首轮全程仅使用合成数据。发现后停止以该方式重跑；最终全量运行使用空 HOME 与 CLI 配置目录，不修改这些无关测试源码。

首轮全量另有协作 E2E 因 CLI 二进制早于并行源码修改而失败；重新准备 sidecar 后，隔离环境下全量通过。

macOS/POSIX 重跑示例（先保存原工具链目录；`TEST_ROOT` 应为专用临时目录）：

```sh
: "${TEST_ROOT:?请先设置专用临时目录 TEST_ROOT}"
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export HOME="$TEST_ROOT/home" USERPROFILE="$TEST_ROOT/home"
export CODEX_HOME="$TEST_ROOT/home/.codex"
export CLAUDE_CONFIG_DIR="$TEST_ROOT/home/.claude"
export PI_CODING_AGENT_DIR="$TEST_ROOT/home/.pi/agent"
export TMPDIR="$TEST_ROOT/tmp/"
mkdir -p "$HOME" "$TMPDIR"
cd src-tauri
cargo test --workspace --locked
```

本轮完整日志保存在会话 scratch 中：`m1-frontend-tests.log`、`m1-build.log`、`m1-rust-final.log`、`m1-storage-path.log`、`m1-native-keychain.log`、`m1-plugins.log`；浏览器产物位于 `m1-panel-qa/`。这些临时材料不是项目发布产物。

## 未验收项与后续门槛

1. **Windows 原生 Credential Manager 冒烟、Windows 构建/运行回归**：当前会话只有 macOS 执行环境；已安装 Windows Rust target 不等于有可运行的 Windows 环境。
2. **真实桌面 IPC/WebView Provider 全流程与新凭据控件视觉检查**：前端 hook/组件测试、真实临时文件适配链路和浏览器懒加载回归不能替代此项。需要独立合成应用数据目录，不能使用现有用户库。
3. **真实用户迁移、正式发布及后续 M2–M7**：不在本轮执行范围内，仍须另行确认。

在上述平台/桌面验收完成前，不将 M1 标记为“全平台验收通过”。
