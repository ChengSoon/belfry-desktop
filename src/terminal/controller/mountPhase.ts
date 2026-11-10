type MountPhase = {
  host: HTMLElement;
  stage: string;
  phase: "start" | "return" | "throw";
  tabId?: string | null;
};

// The isolated production fixture can observe synchronous mount boundaries.
// No timer, layout read or logging runs when the optional observer is absent.
export function measureMountPhase<T>(host: HTMLElement, stage: string, run: () => T, tabId?: string | null): T {
  let observe: ((entry: MountPhase) => void) | undefined;
  try {
    observe = (globalThis as typeof globalThis & { __belfryTerminalMountTrace?: typeof observe }).__belfryTerminalMountTrace;
  } catch { /* Optional instrumentation must not prevent mounting. */ }
  if (typeof observe !== "function") return run();
  const emit = (phase: MountPhase["phase"]) => {
    try { observe({ host, stage, phase, tabId }); }
    catch { /* Preserve the operation's return value or original exception. */ }
  };
  emit("start");
  let returned = false;
  try {
    const result = run();
    returned = true;
    return result;
  } finally { emit(returned ? "return" : "throw"); }
}
