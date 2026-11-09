import { fork } from "node:child_process";

/** Reuse T35's executable input consumer without sending keys to a user session. */
export async function roomChoiceProcess(t) {
  const child = fork(new URL("./terminal-choice-process.mjs", import.meta.url), [], { silent: true });
  t.after(() => child.kill());
  let latest, stderr = "", nextGate;
  const waiting = new Set(), writes = [], externalWrites = [];
  child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.resume();
  child.on("message", frame => { latest = frame; for (const waiter of waiting) waiter.resolve(frame); });
  child.on("exit", code => { for (const waiter of waiting) waiter.reject(new Error(`Room consumer exited ${code}: ${stderr}`)); });
  const next = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(waiter); reject(new Error(`Room consumer timeout: ${stderr}`)); }, 5000);
    const waiter = { resolve: frame => { clearTimeout(timer); waiting.delete(waiter); resolve(frame); },
      reject: error => { clearTimeout(timer); waiting.delete(waiter); reject(error); } };
    waiting.add(waiter);
  });
  const input = async data => {
    const output = next();
    child.stdin.write(data);
    return output;
  };
  await next();
  return {
    writes, externalWrites, read: () => latest,
    async externalInput(data) { externalWrites.push(data); return input(data); },
    holdNextWrite() {
      if (nextGate) throw new Error("A room terminal write is already held");
      let release, arrive, timer;
      const held = new Promise(resolve => { release = resolve; });
      const arrived = new Promise((resolve, reject) => {
        arrive = write => { clearTimeout(timer); resolve(write); };
        timer = setTimeout(() => reject(new Error("No room terminal write reached the gate")), 5000);
      });
      nextGate = { held, arrive };
      t.after(() => { clearTimeout(timer); release(); });
      return { arrived, release };
    },
    handle(request, response) {
      if (request.url === "/qa-choice-state") {
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(latest)); return true;
      }
      if (request.url !== "/qa-choice-write") return false;
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", async () => {
        try {
          const write = JSON.parse(body); writes.push(write);
          const gate = nextGate; nextGate = null;
          if (gate) { gate.arrive(write); await gate.held; }
          const frame = await input(write.data);
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(frame));
        } catch (error) { response.writeHead(500); response.end(String(error)); }
      });
      return true;
    },
  };
}
