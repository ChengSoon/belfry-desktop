import { spawn } from "node:child_process";

export const detachedGroup = process.platform !== "win32";
export function terminate(child, signal = "SIGTERM") {
  if (!child.pid) return;
  if (detachedGroup) {
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") child.kill(signal); }
  } else {
    const cleanup = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    cleanup.on("error", () => child.kill());
  }
}
