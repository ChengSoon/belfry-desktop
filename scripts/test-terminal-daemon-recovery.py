"""真实 Codex 历史恢复冒烟：独立配置、临时 daemon，模型请求只发往本机模拟端点。"""
import importlib.util
import contextlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("recovery_agents", Path(__file__).with_name("test-terminal-daemon-agents.py"))
agents = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agents)
wire, hooks = agents.wire, agents.hooks
MARKER = "BELFRY_HISTORY_RECOVERY_FIXTURE"


def stop_fixture_daemons(root):
    # 新版 Codex 会把 app-server 留在配置目录内运行；只清理本测试目录中的可执行文件。
    prefix = str(root / "codex") + "/"
    processes = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True, check=True)
    children = []
    for line in processes.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[1].startswith(prefix):
            children.append(int(parts[0]))
    for pid in children:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    if children:
        wire.wait_for(lambda: all(not wire.running(pid) for pid in children))


def create(endpoint, root, resume=None, attachment=None, recover=False):
    request = wire.launch_request(root, "qa-native-recovery")
    request.update({"profileId": "agent:codex", "resume": resume})
    return wire.success(endpoint, {"kind": "create", "launch": request, "attachment": attachment,
                                  "recover_exited": recover,
                                  "overlay": {"arguments": [], "environment": {}, "unset": [], "files": []}})


def wait_for_history(endpoint, session):
    cursor, output = 0, bytearray()
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        page = wire.success(endpoint, {"kind": "poll", "id": session["id"], "cursor": cursor})
        assert not page["gap"]
        cursor = page["cursor"]
        for frame in page["frames"]:
            event = frame["event"]
            if event["kind"] == "exit":
                raise AssertionError("Codex exited before restoring history: " + output.decode(errors="replace")[-2000:])
            if event["kind"] != "output":
                continue
            chunk = bytes(event["bytes"])
            output.extend(chunk)
            # 此测试没有 xterm，只响应 CLI 的终端能力查询，不提交任何用户指令。
            if b"\x1b[6n" in chunk:
                wire.write(endpoint, session, "\x1b[1;1R")
            if b"\x1b[c" in chunk:
                wire.write(endpoint, session, "\x1b[?1;2c")
        text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output.decode(errors="replace"))
        if MARKER in text and "OK" in text:
            return
    raise AssertionError("original conversation did not render: " + output.decode(errors="replace")[-2000:])


def main(binary):
    binary = Path(binary).resolve()
    with tempfile.TemporaryDirectory(prefix="belfry-native-recovery-") as temporary, contextlib.ExitStack() as cleanup:
        root = Path(temporary).resolve()
        cleanup.callback(stop_fixture_daemons, root)
        with hooks.services() as (model, collector):
            env = hooks.environment(root, (model.server_address[1], collector.server_address[1]))
            config = root / "codex" / "config.toml"
            config.write_text('check_for_update_on_startup = false\n' + config.read_text()
                              + "\n[projects." + json.dumps(str(root)) + ']\ntrust_level = "trusted"\n')
            output, _ = hooks.run(["codex", "exec", "--skip-git-repo-check", "--json",
                                   MARKER + ": Reply with OK."], root, env)
            events = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
            native = next(event["thread_id"] for event in events if event.get("type") == "thread.started")
            requests = model.RequestHandlerClass.do_POST.__globals__["REQUESTS"]
            count = len(requests)
            assert count >= 1 and any(event.get("item", {}).get("text") == "OK" for event in events)
            with agents.daemon(binary, root, env) as endpoint:
                original = create(endpoint, root, resume=native)
                wait_for_history(endpoint, original)
                # 只定位本测试 daemon 唯一的 CLI 子进程，绝不按全局进程名强杀。
                children = subprocess.run(["pgrep", "-P", str(endpoint["pid"])],
                                          capture_output=True, text=True, check=True).stdout.split()
                assert len(children) == 1, "expected exactly one disposable CLI child"
                os.kill(int(children[0]), signal.SIGKILL)
                wire.wait_for(lambda: wire.success(endpoint, {"kind": "info", "id": original["id"]})["session"]["status"] == "exited")
                restored = create(endpoint, root, attachment=original["id"], recover=True)
                assert restored["id"] != original["id"] and not restored["reconnected"]
                wait_for_history(endpoint, restored)
                identity = wire.success(endpoint, {"kind": "info", "id": restored["id"]})["nativeSession"]
                assert identity == {"agent": "codex", "id": native}
                assert len(requests) == count, "recovery replayed a model request instead of only resuming history"
                print(json.dumps({"ok": True, "nativeIdentityPreserved": True,
                                  "originalUserAndAssistantMessagesRendered": True,
                                  "killedCliRecovered": True, "oldPromptReplayed": False}, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])
