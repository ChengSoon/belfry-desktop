import { describe, expect, it } from "vitest";
import type { ConnectionInfo } from "./contracts";
import { canKeepCredential, changeConnectionForm, connectionDraft, editConnectionForm, newConnectionForm, validateConnectionForm } from "./model";

const stored: ConnectionInfo = {
  id: "connection-1", name: "Reviewer", rootPath: "/project", cardUrl: "https://agent.example/card", interfaceUrl: "https://agent.example/rpc",
  auth: { kind: "bearer", headerName: null, hasCredential: true }, revision: "revision-1",
};

describe("A2A connection credential editing", () => {
  it("edits public metadata without returning or inventing the stored credential", () => {
    const form = editConnectionForm(stored);
    expect(form.secret).toBe("");
    expect(connectionDraft(form, stored)).toEqual({ id: stored.id, name: stored.name, cardUrl: stored.cardUrl, interfaceUrl: stored.interfaceUrl,
      interfaceTenant: null,
      auth: { kind: "bearer", headerName: null, credential: { action: "keep" } } });
    expect(validateConnectionForm(form, stored)).toBeNull();
  });

  it("keeps credentials for the same origin but requires new input after changing either target origin", () => {
    const form = editConnectionForm(stored);
    expect(changeConnectionForm(form, { cardUrl: "https://agent.example/other-card" }, stored).credentialAction).toBe("keep");
    for (const patch of [{ cardUrl: "https://other.example/card" }, { interfaceUrl: "https://other.example/rpc" }]) {
      const next = changeConnectionForm(form, patch, stored);
      expect(next.credentialAction).toBe("replace"); expect(next.secret).toBe("");
      expect(validateConnectionForm(next, stored)?.field).toBe("secret");
      expect(canKeepCredential(next, stored)).toBe(false);
    }
  });

  it("clears entered values on auth changes, and never includes secret values in keep or clear drafts", () => {
    const form = { ...editConnectionForm(stored), secret: "entered-value" };
    expect(connectionDraft(form, stored).auth.credential).toEqual({ action: "keep" });
    const apiKey = changeConnectionForm(form, { authKind: "apiKey" }, stored);
    expect(apiKey.secret).toBe(""); expect(apiKey.credentialAction).toBe("replace");
    const anonymous = changeConnectionForm(form, { authKind: "none" }, stored);
    expect(connectionDraft(anonymous, stored).auth).toEqual({ kind: "none", headerName: null, credential: { action: "clear" } });
    const cleared = { ...form, credentialAction: "clear" as const };
    expect(validateConnectionForm(cleared, stored)).toBeNull();
    expect(connectionDraft(cleared, stored).auth.credential).toEqual({ action: "clear" });
  });

  it("requires an explicit interface URL for a tenant and sends both", () => {
    const form = { ...editConnectionForm(stored), interfaceUrl: "https://agent.example/rpc", interfaceTenant: "production" };
    expect(validateConnectionForm(form, stored)).toBeNull();
    expect(connectionDraft(form, stored).interfaceTenant).toBe("production");
    expect(validateConnectionForm({ ...form, interfaceUrl: "" }, stored)?.field).toBe("interfaceTenant");
    expect(validateConnectionForm({ ...form, interfaceTenant: "t".repeat(513) }, stored)?.field).toBe("interfaceTenant");
    expect(changeConnectionForm(form, { interfaceUrl: "" }, stored).interfaceTenant).toBe("");
  });

  it("does not retain a Header API-key when its Header changes", () => {
    const connection = { ...stored, auth: { kind: "apiKey" as const, headerName: "X-API-Key", hasCredential: true } };
    const form = changeConnectionForm(editConnectionForm(connection), { headerName: "X-Other-Key" }, connection);
    expect(form.credentialAction).toBe("replace");
  });
});

describe("A2A connection targets and static authentication", () => {
  const valid = { ...newConnectionForm(), name: "Local fixture", cardUrl: "http://127.0.0.1:12345/.well-known/agent-card.json" };
  it("supports HTTPS and loopback HTTP and rejects embedded credentials, fragments and arbitrary HTTP", () => {
    for (const url of [valid.cardUrl, "http://localhost:1234/card", "http://[::1]:1234/card", "https://agent.example/card"]) {
      expect(validateConnectionForm({ ...valid, cardUrl: url }, null)).toBeNull();
    }
    for (const url of ["http://agent.example/card", "https://user:password@agent.example/card", "https://agent.example/card#token", "file:///tmp/card.json", "not a url"]) {
      expect(validateConnectionForm({ ...valid, cardUrl: url }, null)?.field).toBe("cardUrl");
    }
  });

  it("requires credentials for new authenticated connections and rejects Header injection", () => {
    const authenticated = { ...valid, authKind: "apiKey" as const, credentialAction: "replace" as const, secret: "fixture-key" };
    expect(validateConnectionForm(authenticated, null)).toBeNull();
    expect(connectionDraft(authenticated, null).auth.credential).toEqual({ action: "replace", value: "fixture-key" });
    expect(validateConnectionForm({ ...authenticated, credentialAction: "clear" }, null)?.field).toBe("secret");
    expect(validateConnectionForm({ ...authenticated, secret: "key\r\nX-Injected: value" }, null)?.field).toBe("secret");
    for (const headerName of ["Authorization", "A2A-Version", "Content-Length", "X-Key\nInjected"]) {
      expect(validateConnectionForm({ ...authenticated, headerName }, null)?.field).toBe("headerName");
    }
  });

  it("uses the host's name, URL and credential limits", () => {
    expect(validateConnectionForm({ ...valid, name: "n".repeat(120) }, null)).toBeNull();
    expect(validateConnectionForm({ ...valid, name: "n".repeat(121) }, null)?.field).toBe("name");
    expect(validateConnectionForm({ ...valid, cardUrl: "https://agent.example/" + "p".repeat(4096) }, null)?.field).toBe("cardUrl");
    const authenticated = { ...valid, authKind: "bearer" as const, credentialAction: "replace" as const };
    expect(validateConnectionForm({ ...authenticated, secret: "s".repeat(8192) }, null)).toBeNull();
    for (const secret of ["s".repeat(8193), "contains space", String.fromCodePoint(0x4e00)]) {
      expect(validateConnectionForm({ ...authenticated, secret }, null)?.field).toBe("secret");
    }
  });
});
