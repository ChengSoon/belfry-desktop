# Harness H1.6：本地受管安装事务

日期：2026-09-07。状态：第一包执行基线。

## 边界

- 仅导入用户通过系统文件选择器明确选择的本地 manifest 与 Worker 文件；不接网络、市场、凭证或任意目标路径。
- manifest ≤64 KiB、Worker ≤1 MiB，均须为 UTF-8 普通文件且不可为 symlink；导入前后复核文件身份、大小与内容 digest。
- manifest 使用严格私有 schema，未知字段和重复字段拒绝；不得包含 trusted、enabled、source、目标路径、executable 或 argv。
- 宿主生成 `local-user-approved + integrity-checked` 定义，绝不声明 publisher-signed。
- 文件先写入安装根随机临时目录并 fsync，再原子 rename；Registry 在同一 owner/revision 检查下提交。失败清理临时/最终目录，不覆盖既有版本。
- 同 plugin/version 拒绝；升级允许，降级拒绝；revision 冲突不落 Registry 或 artifact。

## 后续真实签名提案（待依赖授权）

- 算法：Ed25519；建议依赖 `ed25519-dalek`（关闭默认特性，仅启用 `std`）和 `sha2`，artifact digest 使用 SHA-256。
- 签名 envelope：`algorithm`, `keyId`, `manifestSha256`, `workerSha256`, `signature`, `signedAt`；规范 JSON 使用固定 UTF-8 字节编码，不对解析后对象二次序列化签名。
- 信任库记录 `keyId/publicKey/publisher/status/notBefore/notAfter`；revocation 记录 `keyId/revokedAt/reason`；rotation 由旧 key 对新 key + 生效时间签名，root 撤销需应用内置 trust update。
- 在依赖获批前，UI 和 Registry 只能显示“本地用户批准 / 完整性已检查 / 未经发布者签名”。
