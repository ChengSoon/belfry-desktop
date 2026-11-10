#!/usr/bin/env python3
"""Run the manual room-routing characterization against the configured Codex model.

Called by rooms::duty_test::live. The Rust host supplies a private room endpoint and
ephemeral identity; this script never discovers or connects to a user's room.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--artifacts", required=True)
    parser.add_argument("--settings", required=True, help="safe model label and MCP names exported by the Rust host")
    args = parser.parse_args()
    root = Path(args.artifacts)
    root.mkdir(parents=True, exist_ok=True)
    prompt = sys.stdin.read()
    (root / "prompt.txt").write_text(prompt)
    settings = json.loads(Path(args.settings).read_text())
    command = [args.codex, "exec", "--ephemeral", "--skip-git-repo-check", "--json",
               "--color", "never", "-C", args.project, "-s", "workspace-write",
               "-c", 'approval_policy="never"',
               "-c", 'shell_environment_policy.inherit="all"',
               "-c", "shell_environment_policy.ignore_default_excludes=true",
               "-c", "sandbox_workspace_write.network_access=true",
               "-o", str(root / "final.txt")]
    # Keep the user's provider/model configuration, but isolate this CLI-only sample
    # from hooks, connectors, other agents, and inherited terminal snapshots.
    for feature in ["multi_agent", "apps", "plugins", "hooks", "shell_snapshot"]:
        command += ["--disable", feature]
    for server in settings["mcpServers"]:
        command += ["-c", f"mcp_servers.{json.dumps(server)}.enabled=false"]
    command.append("-")
    secrets = [value for key, value in os.environ.items()
               if ("TOKEN" in key or "KEY" in key) and len(value) > 8]

    def redact(text):
        for secret in secrets:
            text = text.replace(secret, "<redacted>")
        return text

    started = time.time()
    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, start_new_session=True)
    timed_out = False
    try:
        stdout, stderr = child.communicate(prompt, timeout=240)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(child.pid, signal.SIGTERM)
        try:
            stdout, stderr = child.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            stdout, stderr = child.communicate()
    (root / "events.jsonl").write_text(redact(stdout))
    (root / "stderr.log").write_text(redact(stderr))
    final = root / "final.txt"
    if final.exists():
        final.write_text(redact(final.read_text()))
    version = subprocess.run([args.codex, "--version"], capture_output=True, text=True, check=True).stdout.strip()
    (root / "run.json").write_text(json.dumps({
        "version": version, "configuredModel": settings["model"],
        "configuredProvider": settings["provider"],
        "modelOverride": None, "pid": child.pid, "reaped": child.poll() is not None,
        "exitCode": child.returncode, "timedOut": timed_out,
        "elapsedSeconds": time.time() - started, "argv": command,
        "transport": "configured provider; no mock Responses server",
    }, ensure_ascii=False, indent=2) + "\n")
    return 124 if timed_out else child.returncode


if __name__ == "__main__":
    sys.exit(main())
