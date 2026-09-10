# 只读项目示例 Harness

这是一个可直接导入的本地 Harness 示例。它只声明 `project.read`，不写文件、不执行命令、不联网，也不读取凭证。

## 导入与运行

1. 打开设置 → Harness。
2. 依次选择 `manifest.json` 和 `worker.mjs`，查看版本、能力、digest 与未签名警告。
3. 二次确认安装后，打开新建会话菜单，选择 Codex/Claude · `example.readonly-project`。
4. 授权后使用 `project.list` 列出项目文件；再使用 `project.read` 读取项目内明确指定的安全文本文件。

宿主会固定受管安装路径、Registry revision、session snapshot 和 Worker digest。示例不能提交任意 executable、argv、目标路径或额外能力。
