"""生成真实 CLI 的临时会话日志，供 Rust 统计集成测试读取。"""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile


def support():
    spec = importlib.util.spec_from_file_location("hook_fixture", Path(__file__).with_name("test-agent-hooks.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def codex_fixture(helper, root, env):
    output, _ = helper.run(["codex", "exec", "--skip-git-repo-check", "--json", "Reply with OK."], root, env)
    records = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
    started = next(record for record in records if record.get("type") == "thread.started")
    return {"agent": "codex", "id": started["thread_id"], "root": str(root / "codex" / "sessions")}


def claude_fixture(helper, root, env):
    command = ["claude", "--print", "--output-format", "json", "--tools", "",
               "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands",
               "--model", "claude-sonnet-4-5", "Reply with OK."]
    output, _ = helper.run(command, root, env)
    return {"agent": "claude", "id": json.loads(output)["session_id"], "root": str(root / "claude" / "projects")}


def main():
    helper = support()
    with helper.services() as (endpoint, collector), tempfile.TemporaryDirectory(prefix="belfry-stats-cli-") as directory:
        root = Path(directory)
        env = helper.environment(root, (endpoint.server_address[1], collector.server_address[1]))
        fixtures = [codex_fixture(helper, root, env), claude_fixture(helper, root, env)]
        print(json.dumps(fixtures), flush=True)
        sys.stdin.readline()


if __name__ == "__main__":
    main()
