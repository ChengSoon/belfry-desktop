import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { configPreview, fetchProviderModels, saveProvider } from "./api";
import { EMPTY_DRAFT, toDraft } from "./contracts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
beforeEach(() => vi.clearAllMocks());

it("sends a draft with explicit secret intent to save and model discovery, never a stored key", async () => {
  const saved = { id: "saved", name: "Relay", baseUrl: "https://relay.invalid", hasApiKey: true, model: "", createdAt: 0 };
  for (const apiKeyAction of ["keep", "replace", "clear"] as const) {
    const draft = { ...toDraft(saved), apiKeyAction, apiKey: apiKeyAction === "replace" ? "new-key" : "" };
    await saveProvider("claude", draft);
    expect(invoke).toHaveBeenLastCalledWith("provider_save", { kind: "claude", draft });
    await fetchProviderModels("claude", draft);
    expect(invoke).toHaveBeenLastCalledWith("provider_models", { kind: "claude", draft });
  }
});

it("defaults both preview endpoints to no disclosure, forwarding explicit opt-in only when requested", async () => {
  await configPreview("codex");
  expect(invoke).toHaveBeenLastCalledWith("provider_config_preview", { kind: "codex", revealSecrets: false });
  await configPreview("codex", EMPTY_DRAFT);
  expect(invoke).toHaveBeenLastCalledWith("provider_config_preview_for_draft", { kind: "codex", draft: EMPTY_DRAFT, revealSecrets: false });
  await configPreview("pi", undefined, true);
  expect(invoke).toHaveBeenLastCalledWith("provider_config_preview", { kind: "pi", revealSecrets: true });
  await configPreview("claude", EMPTY_DRAFT, true);
  expect(invoke).toHaveBeenLastCalledWith("provider_config_preview_for_draft", { kind: "claude", draft: EMPTY_DRAFT, revealSecrets: true });
});
