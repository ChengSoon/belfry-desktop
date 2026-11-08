# 发布校验和（T12）

发布仍先创建草稿，等待三个构建目标完成。`release.yml` 的 publish 阶段调用 `.github/workflows/publish-release.mjs`：

1. 从本次草稿下载资产的原始字节，逐个流式计算 SHA256。覆盖安装包、自动更新包、`.sig` 和 `latest.json`；`SHA256SUMS.txt` 不包含自身。
2. 按文件名排序生成标准 `SHA256SUMS.txt`，上传到同一草稿。重跑时替换该文件。
3. 重新列出资产并回读已上传的校验和，检查完整覆盖、唯一文件名、每个散列，以及计算前后的资产 ID/字节数一致。
4. 所有平台、更新清单、既有 updater 签名和 SHA256 校验均通过后，才将草稿公开。

GitHub 的资产内容按资产 ID 固定；删除重传会产生新 ID，因此校验后资产被替换不能沿用旧散列。下载失败、截断、空资产、缺失/损坏的校验和或资产变更均使工作流失败并保留草稿。安装包逐个以字节流读取，不把全体安装包留在内存或临时磁盘；小清单限制为 1 MiB。

下载页 [install.md](../website/docs/install.md) 提供 Windows `certutil -hashfile` 和 macOS `shasum -a 256` 核对方法。当前仓库树已删除 12,814,336 字节的 `rustup-init.exe`，并将该路径加入 `.gitignore`。

回归位于 `.github/workflows/release-assets.case.mjs`，由现有 checks 工作流的 Node 20 步骤执行。修复前 4 项稳定失败：缺少校验和也能发布、错误散列未被拒绝、不完整记录未被拒绝、误提交安装器仍在仓库；日志 `/tmp/belfry-t12-before.log`。后续还覆盖原始字节流、大小限制、重复记录、资产替换、上传后回读、故障保留草稿、重跑替换和系统 SHA256 工具互通。

最终 19 项在 Node 24.11.1 与 Node 20.19.0 均通过；本机真实 `shasum -a 256 -c` 验证了生成的清单和带空格文件名，Windows CI 走 `certutil.exe` 分支。工作流 YAML 解析、脚本语法和本次变更的 diff 检查通过。日志为 `/tmp/belfry-t12-after.log`、`/tmp/belfry-t12-node20.log`。

本地验证使用模拟 GitHub API，不创建或发布远端版本；真实上传由下一次 release 工作流执行。
