"""macOS 进程回归：新后台启动六类 Agent，核对 CLI 路径和房间协议。

Agent 用临时目录里的本地程序代替，不启动真实模型、不操作用户房间。
房间业务/账本由 Rust collab::e2e_test 覆盖；这里验证真实后台的启动和转发链路。
"""
import collections
import importlib.util
import json
import os
from pathlib import Path
import socketserver
import subprocess
import sys
import tempfile
import threading


sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("daemon_probe", Path(__file__).with_name("test-terminal-daemon.py"))
daemon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daemon)

AGENTS = ("codex", "claude", "pi", "antigravity", "opencode", "kimi")
APP_TOKEN = "room-protocol-probe-app-token"

AGENT_SCRIPT = r'''
import json, os, pathlib, shutil, socket, subprocess, sys
if "--version" in sys.argv:
    print("1.0.0")
    raise SystemExit(0)
root = pathlib.Path(os.environ["BELFRY_ROOM_PROTOCOL_PROBE_ROOT"])
agent = os.environ["BELFRY_TAB_ID"]
report = {"agent": agent, "cli": shutil.which("belfry"), "commands": []}
try:
    assert pathlib.Path(report["cli"]).resolve() == pathlib.Path(os.environ["BELFRY_ROOM_PROTOCOL_PROBE_CLI"]).resolve()
    address = os.environ["BELFRY_ENDPOINT"].removeprefix("tcp:")
    host, port = address.rsplit(":", 1)
    def exchange(command):
        request = {"version": 1, "tabId": os.environ["BELFRY_TAB_ID"], "token": os.environ["BELFRY_TOKEN"], "command": command}
        with socket.create_connection((host, int(port)), timeout=5) as stream:
            stream.sendall((json.dumps(request) + "\n").encode())
            return json.loads(stream.makefile().readline())
    peers = exchange({"kind": "peers"})
    assert "rooms_v1" in peers["data"].get("capabilities", []), "new Agent still has a legacy typed relay"
    future = exchange({"kind": "futureRoomProbe", "body": {"preserved": "新字段"}})
    assert future == {"status": "ok", "data": {"kind": "futureRoomReceipt", "body": {"preserved": "新字段"}}}
    for args in [
        ["rooms"], ["room", "status"],
        ["room", "task", "add", "协议连通性验证", "--to", "同伴", "--outcome", "完整回执"],
        ["room", "say", "--reply", "11223344", "--ask", "--to", "同伴", "回复验证"],
        ["room", "log"], ["room", "brief", "--focus", "协议验证"],
    ]:
        result = subprocess.run([report["cli"], *args], capture_output=True, text=True, timeout=5)
        assert result.returncode == 0, f"{args}: {result.stderr}"
        report["commands"].append(args[:3])
    report["ok"] = True
except Exception as error:
    report["error"] = str(error)
(root / f"{agent}.json").write_text(json.dumps(report, ensure_ascii=False))
'''


class App(socketserver.ThreadingTCPServer):
    daemon_threads = True

    def __init__(self):
        self.commands = []
        self.lock = threading.Lock()
        super().__init__(("127.0.0.1", 0), Handler)


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(5)
        request = json.loads(self.rfile.readline(1024 * 1024))
        tab = request["tabId"]
        if request["version"] != 1 or request["token"] != APP_TOKEN or tab not in AGENTS:
            response = {"status": "error", "message": "invalid probe identity"}
        else:
            command = request["command"]
            with self.server.lock:
                self.server.commands.append((tab, command))
            response = {"status": "ok", "data": reply(command)}
        self.wfile.write((json.dumps(response, ensure_ascii=False) + "\n").encode())


def reply(command):
    kind = command["kind"]
    brief = {"objective": "新房间协议验证", "focus": "协议验证", "constraints": []}
    if kind == "peers":
        return {"kind": "peers", "peers": [], "capabilities": ["rooms_v1"]}
    if kind == "futureRoomProbe":
        return {"kind": "futureRoomReceipt", "body": command["body"]}
    if kind == "rooms":
        return {"kind": "rooms", "rooms": [{"name": "新房间", "myTitle": "统筹", "myDuty": "验证",
                "iAmForeman": True, "foreman": "统筹", "objective": brief["objective"], "openTasks": 0, "awaitingMe": 0}]}
    if kind == "roomStatus":
        return {"kind": "roomStatus", "status": {"room": "新房间", "myTitle": "统筹", "iAmForeman": True,
                "brief": brief, "members": [], "tasks": [], "awaitingMe": []}}
    if kind == "roomTask":
        return {"kind": "roomTaskChanged", "room": "新房间", "task": {"id": "T1", "title": command["op"]["title"],
                "status": "待开工", "assignee": "同伴", "outcome": "完整回执", "waitingFor": [], "notes": "", "result": None},
                "note": "任务已创建"}
    if kind == "roomSay":
        return {"kind": "roomSaid", "room": "新房间", "message": "a1b2c3d4", "recipients": command["to"],
                "skipped": [], "ask": command["ask"]}
    if kind == "roomLog":
        return {"kind": "roomLog", "room": "新房间", "entries": []}
    if kind == "roomBrief":
        return {"kind": "roomBriefUpdated", "room": "新房间", "brief": brief}
    raise AssertionError(f"unexpected request: {kind}")


def main(binary):
    binary = Path(binary).resolve()
    cli = binary.with_name("belfry")
    assert cli.is_file(), f"missing CLI next to {binary}"
    with tempfile.TemporaryDirectory(prefix="belfry-new-agent-protocol-") as temporary:
        root = Path(temporary)
        fake_bin = root / "agents"
        fake_bin.mkdir()
        for agent in AGENTS:
            program = fake_bin / ("agy" if agent == "antigravity" else agent)
            program.write_text(f"#!{sys.executable}\n" + AGENT_SCRIPT)
            program.chmod(0o700)
        environment = {key: value for key, value in os.environ.items() if not key.startswith("BELFRY_")}
        environment["PATH"] = str(fake_bin) + os.pathsep + environment.get("PATH", "")
        environment["BELFRY_CODEX_NATIVE"] = "0"
        daemon_root = root / "daemon"
        with App() as app, (root / "daemon.log").open("wb") as log:
            server = threading.Thread(target=app.serve_forever, daemon=True)
            server.start()
            process = subprocess.Popen([str(binary), daemon.FLAG, str(daemon_root)], env=environment,
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
            endpoint = None
            try:
                endpoint = daemon.wait_for(lambda: json.loads((daemon_root / "endpoint.json").read_text()))
                ping = daemon.success(endpoint, {"kind": "ping"})
                assert "collab_passthrough_v1" in ping["capabilities"]
                for agent in AGENTS:
                    request = daemon.launch_request(root, agent)
                    request["profileId"] = "agent:" + agent
                    request["env"].update({
                        "BELFRY_TAB_ID": agent, "BELFRY_TOKEN": APP_TOKEN,
                        "BELFRY_ENDPOINT": f"tcp:127.0.0.1:{app.server_address[1]}",
                        "BELFRY_CODEX_NATIVE": "0", "BELFRY_ROOM_PROTOCOL_PROBE_ROOT": str(root),
                        "BELFRY_ROOM_PROTOCOL_PROBE_CLI": str(cli), "PATH": environment["PATH"],
                    })
                    session = daemon.success(endpoint, {"kind": "create", "launch": request, "attachment": None,
                                             "overlay": {"arguments": [], "environment": {}, "unset": [], "files": []}})
                    assert not session["reconnected"], "expected a newly created Agent"
                reports = []
                for agent in AGENTS:
                    report = daemon.wait_for(lambda: json.loads((root / f"{agent}.json").read_text()))
                    assert report.get("ok"), report
                    commands = [command for tab, command in app.commands if tab == agent]
                    counts = collections.Counter(command["kind"] for command in commands)
                    assert counts["roomTask"] == counts["roomSay"] == 1, counts
                    assert counts["taskState"] == 0, "new Agent unexpectedly required legacy transport"
                    said = next(command for command in commands if command["kind"] == "roomSay")
                    assert said["replyTo"] == "11223344" and said["to"] == ["同伴"] and said["ask"]
                    reports.append(report)
                print(json.dumps({"binary": str(binary), "daemonCapabilities": ping["capabilities"],
                                  "newAgents": reports, "ok": True}, ensure_ascii=False, indent=2))
            finally:
                if endpoint and process.poll() is None:
                    daemon.success(endpoint, {"kind": "shutdown"})
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                app.shutdown()
                server.join(timeout=5)


if __name__ == "__main__":
    main(sys.argv[1])
