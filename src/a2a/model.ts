import type { AuthKind, ConnectionDraft, ConnectionInfo, CredentialEdit, Discovery } from "./contracts";

export interface ConnectionForm {
  name: string;
  cardUrl: string;
  interfaceUrl: string;
  interfaceTenant: string;
  authKind: AuthKind;
  headerName: string;
  credentialAction: CredentialEdit["action"];
  secret: string;
}

export const newConnectionForm = (): ConnectionForm => ({
  name: "", cardUrl: "", interfaceUrl: "", interfaceTenant: "", authKind: "none", headerName: "X-API-Key", credentialAction: "clear", secret: "",
});

export function editConnectionForm(connection: ConnectionInfo): ConnectionForm {
  return {
    name: connection.name, cardUrl: connection.cardUrl, interfaceUrl: connection.interfaceUrl ?? "",
    interfaceTenant: connection.interfaceTenant ?? "",
    authKind: connection.auth.kind, headerName: connection.auth.headerName ?? "X-API-Key",
    credentialAction: connection.auth.kind === "none" ? "clear" : connection.auth.hasCredential ? "keep" : "replace",
    secret: "",
  };
}

function origin(value: string) {
  try { return new URL(value.trim()).origin; } catch { return null; }
}

export function canKeepCredential(form: ConnectionForm, original: ConnectionInfo | null) {
  return !!original && original.auth.hasCredential && form.authKind === original.auth.kind && form.authKind !== "none"
    && (form.authKind !== "apiKey" || form.headerName.trim().toLowerCase() === original.auth.headerName?.toLowerCase())
    && origin(form.cardUrl) !== null && origin(form.cardUrl) === origin(original.cardUrl)
    && origin(form.interfaceUrl || form.cardUrl) === origin(original.interfaceUrl || original.cardUrl);
}

/** Changing an authentication target never silently carries an old credential. */
export function changeConnectionForm(form: ConnectionForm, patch: Partial<ConnectionForm>, original: ConnectionInfo | null): ConnectionForm {
  const next = { ...form, ...patch };
  // A tenant is meaningful only together with an explicit interface URL.
  if (!next.interfaceUrl.trim()) next.interfaceTenant = "";
  if (next.authKind === "none") return { ...next, credentialAction: "clear", secret: "" };
  if (next.authKind !== form.authKind) return { ...next, credentialAction: "replace", secret: "" };
  if (next.credentialAction === "keep" && !canKeepCredential(next, original)) {
    return { ...next, credentialAction: "replace", secret: "" };
  }
  return next;
}

export interface FormIssue { field: keyof ConnectionForm; key: string }

function targetIssue(value: string) {
  try {
    const url = new URL(value.trim());
    const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
    if (url.username || url.password || value.includes("#") || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) return true;
    return new TextEncoder().encode(value.trim()).length > 4096;
  } catch { return true; }
}

export function validateConnectionForm(form: ConnectionForm, original: ConnectionInfo | null): FormIssue | null {
  if (!form.name.trim() || Array.from(form.name.trim()).length > 120 || new TextEncoder().encode(form.name.trim()).length > 512) return { field: "name", key: "a2a.validation.name" };
  if (targetIssue(form.cardUrl)) return { field: "cardUrl", key: "a2a.validation.url" };
  if (form.interfaceUrl.trim() && targetIssue(form.interfaceUrl)) return { field: "interfaceUrl", key: "a2a.validation.url" };
  if (form.interfaceTenant.trim() && !form.interfaceUrl.trim()) return { field: "interfaceTenant", key: "a2a.validation.tenant" };
  if (new TextEncoder().encode(form.interfaceTenant.trim()).length > 512) return { field: "interfaceTenant", key: "a2a.validation.tenant" };
  if (form.authKind === "none") return null;
  if (form.authKind === "apiKey" && (form.headerName.trim().length > 128 || !/^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$/.test(form.headerName.trim())
    || /^(authorization|proxy-authorization|host|content-type|accept|a2a-version|a2a-extensions|content-length|cookie|set-cookie|connection|transfer-encoding|upgrade|te|trailer)$/i.test(form.headerName.trim()))) {
    return { field: "headerName", key: "a2a.validation.header" };
  }
  if (form.credentialAction === "keep" && !canKeepCredential(form, original)) return { field: "secret", key: "a2a.validation.keep" };
  if (form.credentialAction === "replace" && (!/^[\x21-\x7e]+$/.test(form.secret.trim()) || form.secret.trim().length > 8192)) return { field: "secret", key: "a2a.validation.secret" };
  if (!original && form.credentialAction !== "replace") return { field: "secret", key: "a2a.validation.secret" };
  return null;
}

export function connectionDraft(form: ConnectionForm, original: ConnectionInfo | null): ConnectionDraft {
  const credential: CredentialEdit = form.authKind === "none" || form.credentialAction === "clear"
    ? { action: "clear" } : form.credentialAction === "keep" ? { action: "keep" } : { action: "replace", value: form.secret.trim() };
  return {
    ...(original ? { id: original.id } : {}), name: form.name.trim(), cardUrl: form.cardUrl.trim(), interfaceUrl: form.interfaceUrl.trim() || null,
    interfaceTenant: form.interfaceUrl.trim() ? form.interfaceTenant.trim() || null : null,
    auth: { kind: form.authKind, headerName: form.authKind === "apiKey" ? form.headerName.trim() : null, credential },
  };
}

export function cardText(card: Discovery["card"], field: string) {
  return typeof card[field] === "string" ? card[field] as string : "";
}
export function cardSkills(card: Discovery["card"]) {
  return Array.isArray(card.skills) ? card.skills.filter((skill): skill is Record<string, unknown> =>
    !!skill && typeof skill === "object" && !Array.isArray(skill)) : [];
}
