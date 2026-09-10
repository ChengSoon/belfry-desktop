import { expect, it, vi } from "vitest";
import { emptyRuntimeCatalog } from "./runtimeContracts";
import { usePluginRuntime } from "./usePluginRuntime";

const ports = vi.hoisted(() => ({ listen: vi.fn(), sync: vi.fn(), runtime: vi.fn() }));
vi.mock("react", () => ({ useSyncExternalStore: ports.sync }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ports.listen }));
vi.mock("./useDirectoryRegistry", () => ({ pluginHost: { runtime: ports.runtime } }));

it("cleans up late event subscriptions after a StrictMode unmount and remount", async () => {
  vi.useFakeTimers();
  const oldStop = vi.fn(), currentStop = vi.fn();
  let resolveOld!: (stop: () => void) => void, resolveCurrent!: (stop: () => void) => void;
  ports.runtime.mockResolvedValue(emptyRuntimeCatalog);
  ports.listen.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { resolveCurrent = resolve; }));
  usePluginRuntime();
  const subscribe = ports.sync.mock.calls[0][0] as (notify: () => void) => () => void;
  const first = subscribe(() => {});
  first();
  const second = subscribe(() => {});
  try {
    resolveCurrent(currentStop); await Promise.resolve();
    resolveOld(oldStop); await Promise.resolve();
    expect(oldStop).toHaveBeenCalledTimes(1);
    expect(currentStop).not.toHaveBeenCalled();
  } finally {
    second();
    vi.useRealTimers();
  }
  expect(currentStop).toHaveBeenCalledTimes(1);
});
