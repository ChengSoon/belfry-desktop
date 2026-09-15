import type { SshTarget } from "../../terminal/contracts";
import type { RemoteReport } from "./contracts";
import { cancelProbe, probeSsh } from "./api";

interface Api { probe: typeof probeSsh; cancel: typeof cancelProbe; id: () => string }
export function createProbeController(api: Api = { probe: probeSsh, cancel: cancelProbe, id: () => crypto.randomUUID() }) {
  let active: string | null = null;
  const cancel = () => {
    const id = active; active = null;
    if (id) void api.cancel(id).catch(() => undefined);
  };
  const run = async (target: SshTarget, browse: boolean): Promise<RemoteReport | null> => {
    cancel(); const id = api.id(); active = id;
    try {
      const result = await api.probe({ id, target, browse });
      return active === id ? result : null;
    } catch (error) { if (active === id) throw error; return null; }
    finally { if (active === id) active = null; }
  };
  return { run, cancel };
}
