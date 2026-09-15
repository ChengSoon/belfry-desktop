"""真实 CLI 经本任务临时 daemon 启动，验证 Hook 回放与未审阅回退。"""
import contextlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


hooks = module("daemon_hook_fixture", "test-agent-hooks.py")
wire = module("daemon_wire_fixture", "test-terminal-daemon.py")


@contextlib.contextmanager
def daemon(binary, root, env):
    daemon_root = root / "daemon"
    clean = {key: value for key, value in env.items() if not key.startswith("BELFRY_HOOK_")}
    process = subprocess.Popen([str(binary), wire.FLAG, str(daemon_root)], cwd=root, env=clean,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    endpoint = None
    try:
        endpoint = wire.wait_for(lambda: json.loads((daemon_root / "endpoint.json").read_text()))
        assert endpoint["pid"] == process.pid
        yield endpoint
    finally:
        if process.poll() is None:
            if endpoint:
                wire.success(endpoint, {"kind": "shutdown"})
            else:
                process.terminate()
            process.wait(timeout=10)


def launch(endpoint, root, kind, attachment=None):
    request = wire.launch_request(root, "qa-daemon-" + kind)
    request["profileId"] = "agent:" + kind
    arguments = {
        "claude": ["--print", "--no-session-persistence", "--output-format", "json", "--tools", "",
                   "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands",
                   "--model", "claude-sonnet-4-5", "Reply with OK."],
        "codex": ["exec", "--skip-git-repo-check", "--ephemeral", "--json", "Reply with OK."],
    }
    return wire.success(endpoint, {"kind": "create", "launch": request, "attachment": attachment,
                                  "overlay": {"arguments": arguments[kind], "environment": {},
                                              "unset": [], "files": []}})


def collect(endpoint, session):
    cursor, events = 0, []
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        page = wire.success(endpoint, {"kind": "poll", "id": session["id"], "cursor": cursor})
        assert not page["gap"]
        cursor = page["cursor"]
        events.extend(frame["event"] for frame in page["frames"])
        if any(event["kind"] == "exit" for event in events):
            return events
    raise AssertionError("真实 CLI 未在期限内结束")


def inspect(endpoint, root, kind, session):
    events = collect(endpoint, session)
    output = b"".join(bytes(event["bytes"]) for event in events if event["kind"] == "output")
    exited = [event for event in events if event["kind"] == "exit"]
    assert exited[0]["exitCode"] == 0, output.decode(errors="replace")[-2000:]
    assert b'"result":"OK"' in output if kind == "claude" else b'"text":"OK"' in output
    states = [event["snapshot"] for event in events if event["kind"] == "agent_state"]
    assert states and all(state["agent"] == kind for state in states)
    assert all(event["sessionId"] == session["id"] for event in events)
    attached = launch(endpoint, root, kind, session["id"])
    assert attached["id"] == session["id"] and attached["reconnected"]
    assert attached["status"] == "exited"
    replayed = collect(endpoint, attached)
    assert events == replayed
    return states


def verify(binary, root, endpoint, collector):
    sessions = {kind: launch(endpoint, root, kind) for kind in ["claude", "codex"]}
    snapshots = {kind: inspect(endpoint, root, kind, session) for kind, session in sessions.items()}
    claude_hooks = [state for state in snapshots["claude"] if state["source"] == "hook"]
    assert claude_hooks, snapshots["claude"]
    identities = {state["session"]["id"] for state in claude_hooks if state["session"]}
    assert len(identities) == 1
    info = wire.success(endpoint, {"kind": "info", "id": sessions["claude"]["id"]})
    assert info["nativeSession"]["id"] in identities
    assert all(state["source"] != "hook" for state in snapshots["codex"])
    assert not collector.records, "Hook 不应落回启动前的临时收集端，必须由 daemon 自己接收"
    assert len(wire.success(endpoint, {"kind": "list"})) == 2
    print(json.dumps({"claude": {"source": "hook", "nativeSession": info["nativeSession"],
                                "states": [state["state"] for state in claude_hooks]},
                      "codex": {"source": "screen fallback", "unreviewedHooks": "not executed"},
                      "replay": "exact events and exited PTY identities retained", "ok": True},
                     ensure_ascii=False, indent=2))


def main(binary):
    binary = Path(binary).resolve()
    with tempfile.TemporaryDirectory(prefix="belfry-cm06-agents-") as temporary:
        root = Path(temporary).resolve()
        with hooks.services() as (model, collector):
            env = hooks.environment(root, (model.server_address[1], collector.server_address[1]))
            for kind in hooks.AGENT_EVENTS:
                hooks.install_fixture(root, binary, kind)
            with daemon(binary, root, env) as endpoint:
                verify(binary, root, endpoint, collector)


if __name__ == "__main__":
    main(sys.argv[1])
