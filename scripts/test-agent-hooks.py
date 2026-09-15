"""用真实应用入口和 CLI 验证 Hook；模型请求仅发往本机模拟端点。"""
import argparse
import contextlib
import http.server
import importlib.util
import json
import os
from pathlib import Path
import shlex
import signal
import socketserver
import subprocess
import tempfile
import threading


COMMON_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest",
                 "PostToolUse", "Stop", "SessionEnd"]
AGENT_EVENTS = {"codex": COMMON_EVENTS + ["Interrupt", "PreCompact", "PostCompact"],
                "claude": COMMON_EVENTS + ["Notification", "StopFailure", "PostToolUseFailure"]}
TEST_TOKEN = "0" * 26


class Collector(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(2)
        message = json.loads(self.rfile.readline(65537))
        with self.server.lock:
            self.server.records.append(message)
        self.wfile.write(b'{"ok":true}\n')


@contextlib.contextmanager
def services():
    spec = importlib.util.spec_from_file_location("provider_fixture", Path(__file__).with_name("test-project-provider.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    endpoint = http.server.ThreadingHTTPServer(("127.0.0.1", 0), module.Endpoint)
    collector = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Collector)
    collector.records, collector.lock = [], threading.Lock()
    for server in [endpoint, collector]:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield endpoint, collector
    finally:
        for server in [endpoint, collector]:
            server.shutdown()
            server.server_close()


def environment(root, ports):
    result = {key: value for key, value in os.environ.items()
              if not key.startswith(("BELFRY_", "CODEX_", "OPENAI_", "ANTHROPIC_", "CLAUDE"))}
    codex, claude = root / "codex", root / "claude"
    codex.mkdir(exist_ok=True); claude.mkdir(exist_ok=True)
    api_port, hook_port = ports
    result.update({"CODEX_HOME": str(codex), "CLAUDE_CONFIG_DIR": str(claude),
                   "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "CLAUDE_CODE_NO_BACKGROUND_TASKS": "1",
                   "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{api_port}/claude",
                   "ANTHROPIC_AUTH_TOKEN": "hook-fixture", "HOOK_FIXTURE_KEY": "hook-fixture",
                   "BELFRY_HOOK_PORT": str(hook_port), "BELFRY_HOOK_TOKEN": TEST_TOKEN})
    config = ('model = "gpt-5.4"\nmodel_provider = "hook_fixture"\n'
              '[model_providers.hook_fixture]\nname = "Hook fixture"\n'
              f'base_url = "http://127.0.0.1:{api_port}/codex/v1"\n'
              'wire_api = "responses"\nenv_key = "HOOK_FIXTURE_KEY"\n')
    (codex / "config.toml").write_text(config)
    return result


def install_fixture(root, binary, kind):
    command = shlex.quote(str(binary)) + " --belfry-hook " + kind
    hooks = {event: [{"hooks": [{"type": "command", "command": command, "timeout": 1,
              "statusMessage": "Belfry 会话状态 · " + kind}]}] for event in AGENT_EVENTS[kind]}
    file = "hooks.json" if kind == "codex" else "settings.json"
    (root / kind / file).write_text(json.dumps({"hooks": hooks}, ensure_ascii=False))


def run(command, root, env, *, input_text=None):
    process = subprocess.Popen(command, cwd=root, env=env, text=True,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    try:
        output, error = process.communicate(input_text, timeout=45)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise RuntimeError("本次验收启动的进程超时：" + command[0])
    if process.returncode:
        raise RuntimeError((error + output)[-2400:])
    return output, error


def verify_helper(binary, fixture, collector):
    root, env = fixture
    raw = {"hook_event_name": "PermissionRequest", "session_id": "native-fixture",
           "tool_name": "Bash", "tool_input": {"command": "private-command"},
           "prompt": "private-prompt", "error": "private-error", "tool_response": "private-output"}
    output, _ = run([str(binary), "--belfry-hook", "codex"], root, env, input_text=json.dumps(raw))
    assert json.loads(output) == {}
    assert len(collector.records) == 1
    record = collector.records[0]
    assert record["input"]["sessionId"] == "native-fixture"
    assert "private-" not in json.dumps(record)
    for payload in ["not-json", "x" * (2 * 1024 * 1024 + 1)]:
        output, _ = run([str(binary), "--belfry-hook", "codex"], root, env, input_text=payload)
        assert json.loads(output) == {}
    assert len(collector.records) == 1
    collector.records.clear()
    print("helper: 真实二进制、stdin、脱敏、载荷上限与中性返回通过", flush=True)


def verify_claude(root, env, collector):
    command = ["claude", "--print", "--no-session-persistence", "--output-format", "json", "--tools", "",
               "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands",
               "--model", "claude-sonnet-4-5", "Reply with OK."]
    output, _ = run(command, root, env)
    result = json.loads(output)
    assert result["result"] == "OK", result
    records = [message for message in collector.records if message["agent"] == "claude"]
    events = {record["input"]["event"] for record in records}
    assert {"SessionStart", "UserPromptSubmit", "Stop"} <= events, events
    assert {result["session_id"]} == {record["input"]["sessionId"] for record in records}
    print("Claude 真实 CLI: " + ", ".join(sorted(events)) + "；原生身份一致", flush=True)


def verify_codex_untrusted(root, env, collector):
    command = ["codex", "exec", "--skip-git-repo-check", "--ephemeral", "--json", "Reply with OK."]
    output, error = run(command, root, env)
    assert '"text":"OK"' in output, (error + output)[-2400:]
    assert not any(record["agent"] == "codex" for record in collector.records)
    print("Codex 真实 CLI: 未审阅 Hook 不执行；模型响应来自本机模拟服务", flush=True)


def desktop_fixture(binary, root, env, restarts=0):
    sentinel = {"SessionEnd": [{"hooks": [{"type": "command", "command": "true"}]}]}
    for kind, file in [("codex", "hooks.json"), ("claude", "settings.json")]:
        path = root / kind / file
        if not path.exists():
            path.write_text(json.dumps({"hooks": sentinel}))
    project = root / "project"
    project.mkdir(exist_ok=True)
    print(json.dumps({"root": str(root), "project": str(project)}, ensure_ascii=False), flush=True)
    clean = {key: value for key, value in env.items() if not key.startswith("BELFRY_HOOK_")}
    # 多次 UI 启动共用模拟模型服务，后台保留的 Agent 不会因测试端口变化而断线。
    for index in range(restarts + 1):
        process = subprocess.Popen([str(binary)], cwd=project, env=clean)
        print(f"QA_PID={process.pid} QA_LAUNCH={index + 1}", flush=True)
        try:
            process.wait()
        except KeyboardInterrupt:
            process.terminate()
            process.wait(timeout=10)
            return


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--desktop-fixture", action="store_true")
    parser.add_argument("--desktop-root", type=Path, help="复用此前由本脚本创建的临时 QA 配置目录")
    parser.add_argument("--desktop-restarts", type=int, default=0,
                        help="UI 退出后自动重开指定次数，同时保留本机模拟模型服务")
    args = parser.parse_args()
    if not 0 <= args.desktop_restarts <= 10:
        parser.error("desktop-restarts 必须在 0 到 10 之间")
    binary = args.binary.resolve()
    with services() as (endpoint, collector):
        if args.desktop_fixture:
            root = desktop_root(args.desktop_root)
            env = environment(root, (endpoint.server_address[1], collector.server_address[1]))
            desktop_fixture(binary, root, env, args.desktop_restarts)
            return
        with tempfile.TemporaryDirectory(prefix="belfry-hook-smoke-") as temp:
            root = Path(temp)
            env = environment(root, (endpoint.server_address[1], collector.server_address[1]))
            for kind in AGENT_EVENTS:
                install_fixture(root, binary, kind)
            verify_helper(binary, (root, env), collector)
            verify_claude(root, env, collector)
            verify_codex_untrusted(root, env, collector)


def desktop_root(requested):
    if requested is None:
        return Path(tempfile.mkdtemp(prefix="belfry-cm01-desktop-"))
    root = requested.resolve()
    temporary = Path(tempfile.gettempdir()).resolve()
    if not root.is_dir() or not root.is_relative_to(temporary) or not root.name.startswith("belfry-cm01-desktop-"):
        raise ValueError("只能复用本脚本创建的临时 QA 目录")
    return root


if __name__ == "__main__":
    main()
