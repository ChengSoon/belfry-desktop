"""用本任务临时目录验证后台 PID、重连与输出缓存，不访问应用私有存档。"""
import json
import os
from pathlib import Path
import shlex
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time

FLAG = "--belfry-terminal-daemon"
MAX_FRAME = 8 * 1024 * 1024


def wait_for(check, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (OSError, ValueError, json.JSONDecodeError):
            pass
        time.sleep(0.04)
    raise AssertionError("test fixture did not become ready")


def exact(stream, length):
    result = bytearray()
    while len(result) < length:
        part = stream.recv(length - len(result))
        if not part:
            raise RuntimeError(f"daemon disconnected before reply: {len(result)}/{length} bytes")
        result.extend(part)
    return result


def call(endpoint, command, token=None, version=1):
    payload = json.dumps({"version": version, "token": token or endpoint["token"], "command": command}).encode()
    with socket.create_connection(("127.0.0.1", endpoint["port"]), timeout=15) as stream:
        stream.sendall(struct.pack(">I", len(payload)) + payload)
        length = struct.unpack(">I", exact(stream, 4))[0]
        assert 0 < length <= MAX_FRAME
        reply = json.loads(exact(stream, length))
        return reply


def success(endpoint, command):
    reply = call(endpoint, command)
    assert not reply["error"], reply["error"]
    return reply["result"]


def launch_request(root, tab="qa-main"):
    return {"platform": "macos", "profileId": "shell:bash", "tabId": tab,
            "cwd": root.as_uri(), "cols": 100, "rows": 30, "elevation": "normal",
            "env": {"HISTFILE": str(root / "shell-history")}}


def create(endpoint, root, tab="qa-main", attachment=None):
    return success(endpoint, {"kind": "create", "launch": launch_request(root, tab),
                            "overlay": {"arguments": [], "environment": {}, "unset": [], "files": []},
                            "attachment": attachment})


def write(endpoint, session, command):
    return success(endpoint, {"kind": "write", "id": session["id"], "bytes": list(command.encode())})


def running(pid):
    status = subprocess.run(["ps", "-p", str(pid), "-o", "stat="], capture_output=True, text=True).stdout.strip()
    return bool(status) and not status.startswith("Z")


def worker_file(root):
    path = root / "worker.py"
    path.write_text('''import os, pathlib, time
root = pathlib.Path(__file__).parent
(root / "worker.pid").write_text(str(os.getpid()))
count = 0
while True:
    count += 1
    (root / "ticks-next").write_text(str(count))
    (root / "ticks-next").replace(root / "ticks")
    print(f"qa-frame:{count}:pid:{os.getpid()}", flush=True)
    time.sleep(0.12)
''')
    return path


def verify_reconnect(endpoint, root):
    session = create(endpoint, root)
    command = f"stty -echo; exec {shlex.quote(sys.executable)} {shlex.quote(str(worker_file(root)))}\r"
    write(endpoint, session, command)
    worker = int(wait_for(lambda: (root / "worker.pid").read_text()))
    first = wait_for(lambda: int((root / "ticks").read_text()) >= 3)
    assert first and running(worker)
    count_before = int((root / "ticks").read_text())
    # 创建一个独立客户端，读取原 PTY 后真正退出，再重新连接。
    client = subprocess.run([sys.executable, __file__, "--client", str(root), session["id"]],
                            capture_output=True, text=True, timeout=10, check=True)
    assert json.loads(client.stdout)["id"] == session["id"]
    wait_for(lambda: int((root / "ticks").read_text()) >= count_before + 5)
    attached = create(endpoint, root, attachment=session["id"])
    assert attached["reconnected"] and attached["id"] == session["id"]
    assert worker == int((root / "worker.pid").read_text()) and running(worker)
    assert len(success(endpoint, {"kind": "list"})) == 1
    page = success(endpoint, {"kind": "poll", "id": session["id"], "cursor": 0})
    assert not page["gap"]
    outputs = [frame["event"] for frame in page["frames"] if frame["event"]["kind"] == "output"]
    assert [event["sequence"] for event in outputs] == list(range(len(outputs)))
    assert b"qa-frame:" in b"".join(bytes(event["bytes"]) for event in outputs)
    return worker, {"pty": session["id"], "workerPid": worker,
                    "ticksBeforeClientExit": count_before, "ticksAfterReconnect": int((root / "ticks").read_text())}


def verify_bounds(endpoint, root):
    assert call(endpoint, {"kind": "ping"}, token="incorrect")["error"]
    assert call(endpoint, {"kind": "ping"}, version=99)["error"]
    invalid = {"kind": "create", "launch": launch_request(root), "attachment": "missing",
               "overlay": {"arguments": [], "environment": {}, "unset": [], "files": []}}
    assert call(endpoint, invalid)["error"]
    token = success(endpoint, {"kind": "acquire_workspace"})
    request = dict(invalid, launch=launch_request(root, "blocked"), attachment=None)
    assert call(endpoint, request)["error"]
    success(endpoint, {"kind": "release_workspace", "token": token})
    cache = create(endpoint, root, "qa-cache")
    script = "import sys;sys.stdout.write('x'*4000000);sys.stdout.flush()"
    write(endpoint, cache, f"stty -echo; {shlex.quote(sys.executable)} -c {shlex.quote(script)}; exit\r")
    wait_for(lambda: success(endpoint, {"kind": "info", "id": cache["id"]})["session"]["status"] == "exited")
    page = success(endpoint, {"kind": "poll", "id": cache["id"], "cursor": 0})
    assert page["gap"] and page["gap"]["droppedEvents"] > 0
    first = next(frame["event"] for frame in page["frames"] if frame["event"]["kind"] == "output")
    assert page["gap"]["nextSequence"] == first["sequence"]
    return {"authentication": "rejected invalid token/version", "cacheGap": page["gap"]["droppedEvents"], "workspaceLease": "blocked concurrent create"}


def main(binary):
    with tempfile.TemporaryDirectory(prefix="belfry-cm06-process-") as temporary:
        root = Path(temporary).resolve()
        daemon_root = root / "daemon"
        parent = '''import json, os, subprocess, sys
child = subprocess.Popen([sys.argv[1], sys.argv[2], sys.argv[3]], stdin=subprocess.DEVNULL,
                         stdout=open(sys.argv[4], "ab"), stderr=subprocess.STDOUT, start_new_session=True)
print(json.dumps({"launcher": os.getpid(), "daemon": child.pid}))
'''
        diagnostics = root / "daemon.log"
        launched = subprocess.run([sys.executable, "-c", parent, str(Path(binary).resolve()), FLAG, str(daemon_root), str(diagnostics)],
                                  capture_output=True, text=True, check=True, timeout=10)
        identities = json.loads(launched.stdout)
        endpoint = None
        try:
            endpoint = wait_for(lambda: json.loads((daemon_root / "endpoint.json").read_text()))
            assert endpoint["pid"] == identities["daemon"]
            assert not running(identities["launcher"]) and running(identities["daemon"])
            assert daemon_root.stat().st_mode & 0o777 == 0o700
            assert (daemon_root / "endpoint.json").stat().st_mode & 0o777 == 0o600
            worker, result = verify_reconnect(endpoint, root)
            result.update(verify_bounds(endpoint, root))
            success(endpoint, {"kind": "shutdown"})
            wait_for(lambda: not running(worker) and not running(identities["daemon"]))
            result.update({"launcherExited": True, "explicitShutdown": "daemon and worker exited", "ok": True})
            print(json.dumps(result, ensure_ascii=False, indent=2))
        except Exception:
            print(f"daemonAlive={running(identities['daemon'])}; " + diagnostics.read_text(errors="replace"), file=sys.stderr)
            raise
        finally:
            if endpoint and running(identities["daemon"]):
                try:
                    success(endpoint, {"kind": "shutdown"})
                except (AssertionError, OSError, RuntimeError):
                    os.kill(identities["daemon"], signal.SIGTERM)


if __name__ == "__main__":
    if sys.argv[1] == "--client":
        root = Path(sys.argv[2])
        endpoint = json.loads((root / "daemon" / "endpoint.json").read_text())
        session = create(endpoint, root, attachment=sys.argv[3])
        success(endpoint, {"kind": "poll", "id": session["id"], "cursor": 0})
        print(json.dumps({"id": session["id"]}))
    else:
        main(sys.argv[1])
