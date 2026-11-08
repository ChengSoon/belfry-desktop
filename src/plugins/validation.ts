import { TranslationError } from "../i18n";
import { checkVersionRange, parsePluginVersion } from "./version";
import type { PluginManifest } from "./contracts";
import { PLUGIN_LIMITS } from "./contracts";
const ID = /^[a-z][a-z0-9-]{0,59}$/u;
const META = /[\u0000-\u001f\u007f-\u009f]/u;
export function validateManifest(value: unknown, appVersion: string): PluginManifest {
  if (!isRecord(value) || Object.keys(value).some((key) => !ALLOWED.has(key))) throw new TranslationError("plugins.validation.text_bcc48b2d0b");
  const manifest = value as Record<string, unknown>;
  return { ...manifestIdentity(manifest), ...manifestMetadata(manifest),
    compatibility: validateCompatibility(manifest.compatibility, appVersion),
    contributes: validateContributions(manifest.contributes) };
}
function manifestIdentity(manifest: Record<string, unknown>) {
  if (manifest.schemaVersion !== 1 || !isString(manifest.id) || !isPluginId(manifest.id)) throw new TranslationError("plugins.validation.text_e253bd8c43");
  if (!isString(manifest.version) || !parsePluginVersion(manifest.version)) throw new TranslationError("plugins.validation.text_75183f713d");
  return { schemaVersion: 1 as const, id: manifest.id, version: manifest.version };
}
function manifestMetadata(manifest: Record<string, unknown>) {
  if (!isString(manifest.name) || !meta(manifest.name, 60) || !isString(manifest.author) || !meta(manifest.author, 80)) throw new TranslationError("plugins.validation.text_7140642c77");
  return { name: manifest.name.trim(), author: manifest.author.trim(),
    description: optionalDescription(manifest.description) };
}
function validateCompatibility(compatibility: unknown, appVersion: string) {
  if (!isRecord(compatibility) || compatibility.pluginApi !== 1 || !isString(compatibility.minAppVersion)) throw new TranslationError("plugins.validation.text_ae0b75a81b");
  const maxExclusive = typeof compatibility.maxAppVersionExclusive === "string" ? compatibility.maxAppVersionExclusive : undefined;
  const range = checkVersionRange({ host: appVersion, min: compatibility.minAppVersion, maxExclusive });
  if (range !== "compatible") throw new TranslationError("plugins.validation.text_db503914cc", { range: range });
  return { pluginApi: 1 as const, minAppVersion: compatibility.minAppVersion,
    ...(maxExclusive !== undefined ? { maxAppVersionExclusive: maxExclusive } : {}) };
}
function validateContributions(contributes: unknown) {
  if (!isRecord(contributes) || !Array.isArray(contributes.templates) || contributes.templates.length === 0 || contributes.templates.length > PLUGIN_LIMITS.templates) throw new TranslationError("plugins.validation.text_a63a18cc1f");
  const templates = contributes.templates.map((item) => validateTemplate(item));
  const actions = Array.isArray(contributes.actions) ? contributes.actions.map((item) => validateAction(item, templates)) : [];
  if (actions.length > PLUGIN_LIMITS.actions) throw new TranslationError("plugins.validation.text_ffeb30ced8");
  return { templates, actions };
}
function validateTemplate(value: unknown) {
  if (!isRecord(value) || Object.keys(value).some((key) => !["id", "kind", "name", "description", "steps"].includes(key)) || !isString(value.id) || !ID.test(value.id) || (value.kind !== "prompt" && value.kind !== "recipe") || !isString(value.name) || !meta(value.name, 60) || !Array.isArray(value.steps)) throw new TranslationError("plugins.validation.text_1538939f1f");
  const steps = validateSteps(value.steps, value.kind);
  return { id: value.id, kind: value.kind, name: value.name.trim(), description: optionalDescription(value.description), steps } as const;
}
function optionalDescription(value: unknown) { return typeof value === "string" ? value.trim() : undefined; }
function validateSteps(values: unknown[], kind: "prompt" | "recipe") {
  if (values.length < 1 || values.length > PLUGIN_LIMITS.steps || (kind === "prompt" && values.length !== 1)) throw new TranslationError("plugins.validation.text_68ad0631d2");
  const ids = new Set<string>();
  return values.map((step) => { if (!isRecord(step) || !isString(step.id) || !ID.test(step.id) || ids.has(step.id) || !isString(step.text) || !step.text.trim() || new TextEncoder().encode(step.text).length > PLUGIN_LIMITS.textBytes || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(step.text)) throw new TranslationError("plugins.validation.text_08736b44e8"); ids.add(step.id); return { id: step.id, text: step.text }; });
}
function validateAction(value: unknown, templates: readonly { id: string }[]) { if (!isRecord(value) || Object.keys(value).some((key) => !["id", "title", "templateId", "keywords"].includes(key)) || !isString(value.id) || !ID.test(value.id) || !isString(value.title) || !meta(value.title, 60) || !isString(value.templateId) || !templates.some((template) => template.id === value.templateId)) throw new TranslationError("plugins.validation.text_8b3020290b"); return { id: value.id, title: value.title.trim(), templateId: value.templateId, keywords: Array.isArray(value.keywords) ? value.keywords.filter(isString).map((item) => item.trim()) : [] }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isString(value: unknown): value is string { return typeof value === "string"; }
function meta(value: string, max: number) { return value.trim().length > 0 && [...value].length <= max && !META.test(value); }
function isPluginId(value: string) { const parts = value.split("."); return parts.length === 2 && parts.every((part) => ID.test(part)) && value.length <= 80; }
const ALLOWED = new Set(["schemaVersion", "id", "name", "version", "description", "author", "compatibility", "contributes"]);
