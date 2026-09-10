# Harness H1.11 签名 Trust Store 提案

本提案不新增依赖、不改变当前未签名安装状态。实现授权后使用 Ed25519 验签，artifact digest 使用 SHA-256。

- Trust key：`keyId`, `algorithm`, `publicKey`, `publisher`, `status`, `notBefore`, `notAfter`。
- Revocation：`keyId`, `revokedAt`, `reason`；撤销优先于有效期。
- Rotation：旧 key 对新 `keyId/publicKey/notBefore` 的 canonical envelope 签名；root 撤销由应用内置信任更新完成。
- 签名覆盖 canonical UTF-8 manifest bytes、worker SHA-256、plugin/version、harness API、capabilities 和 source-relative path；不覆盖可变运行态 grants。
- 安装流程：本地 preview 先校验结构与 digest，commit 前验证签名、key 状态和时间窗，再写入临时目录、fsync、原子替换并提交单 Registry revision。
- 稳定错误码：`SIGNATURE_MISSING`, `SIGNATURE_INVALID`, `SIGNING_KEY_UNKNOWN`, `SIGNING_KEY_REVOKED`, `SIGNATURE_EXPIRED`, `DIGEST_MISMATCH`。
- 迁移兼容：旧 Registry `signed=false` 保持 `local-user-approved/integrity-checked`；签名字段可选，未知字段拒绝写入但读取旧记录不失败。

最小根依赖变更提案（待门禁批准）：`ed25519-dalek`（关闭默认特性，仅 `std`）与 `sha2`，同时补 Cargo.lock、跨平台构建和密钥撤销测试。当前仅保留接口/纯逻辑设计，不标记 publisher-signed。
