"""以本机模拟端点验证项目 Provider；只使用临时目录和测试凭据。"""
import concurrent.futures
import http.server
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import threading

REQUESTS = []
REQUEST_LOCK = threading.Lock()


def codex_events(model):
    message = {"id": "msg_test", "type": "message", "role": "assistant", "status": "completed",
               "content": [{"type": "output_text", "text": "OK", "annotations": []}]}
    response = {"id": "resp_test", "object": "response", "model": model, "status": "completed",
                "output": [message], "usage": {"input_tokens": 10, "output_tokens": 1,
                "total_tokens": 11, "input_tokens_details": {"cached_tokens": 0}}}
    return [
        {"type": "response.created", "response": {**response, "status": "in_progress", "output": []}},
        {"type": "response.output_item.added", "output_index": 0, "item": {**message, "status": "in_progress", "content": []}},
        {"type": "response.content_part.added", "item_id": "msg_test", "output_index": 0, "content_index": 0,
         "part": {"type": "output_text", "text": "", "annotations": []}},
        {"type": "response.output_text.delta", "item_id": "msg_test", "output_index": 0, "content_index": 0, "delta": "OK"},
        {"type": "response.output_item.done", "output_index": 0, "item": message},
        {"type": "response.completed", "response": response},
    ]


def claude_events(model):
    return [
        {"type": "message_start", "message": {"id": "msg_test", "type": "message", "role": "assistant",
         "model": model, "content": [], "stop_reason": None, "stop_sequence": None,
         "usage": {"input_tokens": 10, "output_tokens": 0}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "OK"}},
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
         "usage": {"output_tokens": 1}},
        {"type": "message_stop"},
    ]


class Endpoint(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.respond_json({"data": []})

    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(size) or b"{}")
        path = self.path.split("?", 1)[0]
        if path.endswith("/count_tokens"):
            self.respond_json({"input_tokens": 10})
            return
        agent = "codex" if path.endswith("/responses") else "claude"
        with REQUEST_LOCK:
            REQUESTS.append({"path": path, "agent": agent, "model": body.get("model"),
                             "auth": self.headers.get("Authorization") or self.headers.get("x-api-key")})
        events = codex_events(body.get("model")) if agent == "codex" else claude_events(body.get("model"))
        payload = "".join("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n" for event in events).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def respond_json(self, value):
        payload = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def environment(fixture, directory):
    result = {key: value for key, value in os.environ.items()
              if not key.startswith(("BELFRY_", "CODEX_", "OPENAI_", "ANTHROPIC_", "CLAUDE"))}
    config = directory / "config"
    config.mkdir()
    result.update({"CODEX_HOME": str(config), "CLAUDE_CONFIG_DIR": str(config),
                   "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "CLAUDE_CODE_NO_BACKGROUND_TASKS": "1"})
    result.update({"OPENAI_API_KEY": "wrong-inherited", "OPENAI_BASE_URL": "http://127.0.0.1:1",
                   "ANTHROPIC_AUTH_TOKEN": "wrong-inherited", "ANTHROPIC_BASE_URL": "http://127.0.0.1:1"})
    for key in fixture["unset"]:
        result.pop(key, None)
    result.update(fixture["environment"])
    return result, config


def seed_conflicting_config(directory, config):
    (config / "config.toml").write_text('model_provider = "wrong"\n[model_providers.wrong]\nname = "wrong"\nbase_url = "http://127.0.0.1:1"\nwire_api = "responses"\n')
    settings = {"env": {"ANTHROPIC_BASE_URL": "http://127.0.0.1:1", "ANTHROPIC_AUTH_TOKEN": "wrong-global"}}
    (config / "settings.json").write_text(json.dumps(settings))
    local = directory / ".claude"
    local.mkdir()
    (local / "settings.local.json").write_text(json.dumps(settings))
    return {path: path.read_bytes() for path in [config / "config.toml", config / "settings.json", local / "settings.local.json"]}


def run_cli(fixture):
    with tempfile.TemporaryDirectory(prefix="belfry-cli-route-") as temporary:
        directory = pathlib.Path(temporary)
        env, config = environment(fixture, directory)
        before = seed_conflicting_config(directory, config)
        if fixture["kind"] == "codex":
            command = ["codex", "exec", "--skip-git-repo-check", "--ephemeral", "--json"]
        else:
            command = ["claude", "--print", "--no-session-persistence", "--output-format", "json", "--tools", "",
                       "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands"]
        command += fixture["arguments"] + ["Reply with OK."]
        process = subprocess.Popen(command, cwd=directory, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True)
        try:
            output, error = process.communicate(timeout=35)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise RuntimeError(fixture["kind"] + " timed out")
        if process.returncode or b"OK" not in output:
            raise RuntimeError(fixture["kind"] + " failed: " + (error + output)[-1800:].decode(errors="replace"))
        assert all(path.read_bytes() == data for path, data in before.items()), "CLI provider config changed"
        return fixture


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Endpoint)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(server.server_address[1], flush=True)
    fixtures = json.loads(sys.stdin.readline())
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(fixtures)) as pool:
        completed = list(pool.map(run_cli, fixtures))
    server.shutdown()
    for fixture in completed:
        expected = fixture["expected"]
        matches = [entry for entry in REQUESTS if entry["path"].startswith(expected["path"]) and entry["agent"] == fixture["kind"]]
        assert matches, "no request at isolated route: " + expected["path"]
        assert all(entry["auth"] == "Bearer " + expected["key"] or entry["auth"] == expected["key"] for entry in matches), "wrong credentials"
        assert any(entry["model"] == expected["model"] for entry in matches), "wrong model"
        print(fixture["kind"] + " " + expected["path"] + ": isolated route/key/model, configuration unchanged", flush=True)


if __name__ == "__main__":
    main()
