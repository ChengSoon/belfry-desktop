import { localized, t } from "../i18n";
import {
  systemShortcutChord,
  type ShortcutPlatform,
} from "./resolveShortcut";
import { effectiveBindings } from "./custom/bindings";
import { bindingChord } from "./custom/chord";
import { loadShortcutSettings } from "./custom/storage";
import type { AgentKind } from "../agent/contracts";

export type GuideTab = "belfry" | AgentKind;

export interface GuideItem {
  label: string;
  command?: string;
  keys?: string[];
}

export interface GuideSection {
  label: string;
  items: GuideItem[];
}

export function guideSections(tab: GuideTab, platform: ShortcutPlatform): GuideSection[] {
  if (tab === "belfry") return belfrySections(platform);
  if (tab === "codex") return CODEX_SECTIONS;
  if (tab === "claude") return claudeSections(platform);
  return NATIVE_SECTIONS[tab];
}

const commands = (items: [string, string][]): GuideSection => ({
  label: t("shortcuts.catalog.text_c6cff16bea"), items: items.map(([command, label]) => ({ command, label })),
});

const NATIVE_SECTIONS: Record<Exclude<AgentKind, "codex" | "claude">, GuideSection[]> = localized(() => ({
  pi: [commands([["/model", t("shortcuts.catalog.text_7122a29a75")], ["/settings", t("shortcuts.catalog.text_b72fbb9d77")], ["/resume", t("shortcuts.catalog.text_a088a104fb")], ["/compact", t("shortcuts.catalog.text_d36946e07f")]])],
  antigravity: [commands([
    ["/model", t("shortcuts.catalog.text_7122a29a75")], ["/config", t("shortcuts.catalog.text_514d8331f1")], ["/permissions", t("shortcuts.catalog.text_e97ac9e3f3")],
    ["/mcp", t("shortcuts.catalog.text_baed59cc37")], ["/new", t("shortcuts.catalog.text_81e3bb8bca")], ["/resume", t("shortcuts.catalog.text_a088a104fb")],
    ["/help", t("shortcuts.catalog.text_2ceed56d6b")], ["/keybindings", t("shortcuts.catalog.text_e1a74c0ceb")],
  ])],
  opencode: [commands([
    ["/models", t("shortcuts.catalog.text_7122a29a75")], ["/agents", t("shortcuts.catalog.text_1b5fe9eda0")], ["/new", t("shortcuts.catalog.text_81e3bb8bca")],
    ["/sessions", t("shortcuts.catalog.text_a088a104fb")], ["/undo", t("shortcuts.catalog.text_34ea799a1b")], ["/redo", t("shortcuts.catalog.text_4697777a07")], ["/editor", t("shortcuts.catalog.text_5e6c49526d")],
  ]), { label: t("shortcuts.catalog.text_83992288e9"), items: [
    { keys: ["Ctrl", "P"], label: t("shortcuts.catalog.text_36dd5fe70f") },
    { keys: ["Shift", "Tab"], label: t("shortcuts.catalog.text_1b5fe9eda0") },
    { keys: ["Esc"], label: t("shortcuts.catalog.text_40969b9f8c") },
    { keys: ["@"], label: t("shortcuts.catalog.text_0dec82f188") },
  ] }],
  kimi: [commands([
    ["/model", t("shortcuts.catalog.text_7122a29a75")], ["/provider", t("shortcuts.catalog.text_2238a3e6c6")], ["/permission", t("shortcuts.catalog.text_ce4aec0615")], ["/plan", t("shortcuts.catalog.text_290149f021")],
    ["/new", t("shortcuts.catalog.text_81e3bb8bca")], ["/sessions", t("shortcuts.catalog.text_a088a104fb")], ["/compact", t("shortcuts.catalog.text_d36946e07f")], ["/undo", t("shortcuts.catalog.text_4d5a72dc62")],
    ["/tasks", t("shortcuts.catalog.text_ee637cbee0")], ["/reload", t("shortcuts.catalog.text_e2e186b9a2")],
  ]), { label: t("shortcuts.catalog.text_83992288e9"), items: [
    { keys: ["Esc"], label: t("shortcuts.catalog.text_40969b9f8c") }, { keys: ["Ctrl", "S"], label: t("shortcuts.catalog.text_c5b1fc2ea4") },
    { keys: ["Ctrl", "O"], label: t("shortcuts.catalog.text_de9085e68e") }, { keys: ["↑", "↓"], label: t("shortcuts.catalog.text_11aa5d1efa") },
  ] }],
}));

export function guideFootnote(tab: GuideTab, platform: ShortcutPlatform) {
  if (tab === "belfry" && platform === "control") {
    return t("shortcuts.catalog.text_65d1218259");
  }
  if (tab === "belfry") return t("shortcuts.catalog.text_d6777e6d40");
  return t("shortcuts.catalog.text_541a52e9cc");
}

function belfrySections(platform: ShortcutPlatform): GuideSection[] {
  const entries = effectiveBindings(platform, loadShortcutSettings().settings[platform]).map(({ action, bindings }) => ({
    id: action.id, label: action.label, keys: bindingChord(bindings[0], platform),
  }));
  return [
    {
      label: t("shortcuts.catalog.text_3797982942"),
      items: entries.filter((entry) => !entry.id.startsWith("activate-session-")),
    },
    {
      label: t("shortcuts.catalog.text_a63280253f"),
      items: entries.filter((entry) => entry.id.startsWith("activate-session-")),
    },
    {
      label: t("shortcuts.catalog.text_e2a76ef1f1"),
      items: [
        { label: t("shortcuts.catalog.text_60e4320264"), keys: systemShortcutChord(platform, "C") },
        { label: t("shortcuts.catalog.text_cfe420a865"), keys: systemShortcutChord(platform, "V") },
        { label: t("shortcuts.catalog.text_214f1894dc"), keys: ["Esc"] },
      ],
    },
  ];
}

const CODEX_SECTIONS: GuideSection[] = localized(() => ([
  {
    label: t("shortcuts.catalog.text_c6cff16bea"),
    items: [
      { command: "/model", label: t("shortcuts.catalog.text_7122a29a75") },
      { command: "/permissions", label: t("shortcuts.catalog.text_b85ec69a78") },
      { command: "/plan", label: t("shortcuts.catalog.text_eb93045599") },
      { command: "/status", label: t("shortcuts.catalog.text_4b5a6b9608") },
      { command: "/usage", label: t("shortcuts.catalog.text_745199d87c") },
      { command: "/compact", label: t("shortcuts.catalog.text_c752021cc5") },
      { command: "/diff", label: t("shortcuts.catalog.text_dcd658c6d9") },
      { command: "/review", label: t("shortcuts.catalog.text_53dbd68fcf") },
      { command: "/new", label: t("shortcuts.catalog.text_81e3bb8bca") },
      { command: "/resume", label: t("shortcuts.catalog.text_8233daa279") },
    ],
  },
  {
    label: t("shortcuts.catalog.text_83992288e9"),
    items: [
      { keys: ["@"], label: t("shortcuts.catalog.text_e99f2a26c7") },
      { keys: ["!"], label: t("shortcuts.catalog.text_1083c6697c") },
      { keys: ["Ctrl", "R"], label: t("shortcuts.catalog.text_f2ac30f3b0") },
      { keys: ["Ctrl", "O"], label: t("shortcuts.catalog.text_97f510d09c") },
      { keys: ["Tab"], label: t("shortcuts.catalog.text_2be4a47c14") },
      { keys: ["Enter"], label: t("shortcuts.catalog.text_aa02fb3576") },
      { keys: ["Esc", "Esc"], label: t("shortcuts.catalog.text_1ced56c08c") },
      { keys: ["Ctrl", "C"], label: t("shortcuts.catalog.text_e08063dfbe") },
    ],
  },
]));

function claudeSections(platform: ShortcutPlatform): GuideSection[] {
  return [
    {
      label: t("shortcuts.catalog.text_c6cff16bea"),
      items: [
        { command: "/model", label: t("shortcuts.catalog.text_7122a29a75") },
        { command: "/permissions", label: t("shortcuts.catalog.text_e97ac9e3f3") },
        { command: "/plan", label: t("shortcuts.catalog.text_1829364406") },
        { command: "/context", label: t("shortcuts.catalog.text_77e39889a8") },
        { command: "/compact", label: t("shortcuts.catalog.text_b19c2da2f8") },
        { command: "/diff", label: t("shortcuts.catalog.text_875e8e58ba") },
        { command: "/review", label: t("shortcuts.catalog.text_ebc2d9fe20") },
        { command: "/tasks", label: t("shortcuts.catalog.text_ee637cbee0") },
        { command: "/clear", label: t("shortcuts.catalog.text_cd0afe9aad") },
        { command: "/resume", label: t("shortcuts.catalog.text_a088a104fb") },
      ],
    },
    {
      label: t("shortcuts.catalog.text_83992288e9"),
      items: [
        { keys: ["@"], label: t("shortcuts.catalog.text_6f12338e05") },
        { keys: ["!"], label: t("shortcuts.catalog.text_4e435e537d") },
        { keys: ["?"], label: t("shortcuts.catalog.text_5fb734409f") },
        { keys: ["Ctrl", "C"], label: t("shortcuts.catalog.text_5f1e026bea") },
        { keys: ["Ctrl", "O"], label: t("shortcuts.catalog.text_fba88e604c") },
        { keys: ["Ctrl", "R"], label: t("shortcuts.catalog.text_c015601988") },
        { keys: ["Ctrl", "B"], label: t("shortcuts.catalog.text_20d19f066d") },
        { keys: ["Shift", "Tab"], label: t("shortcuts.catalog.text_6c0edbf394") },
        { keys: [platform === "macos" ? "⌥" : "Alt", "P"], label: t("shortcuts.catalog.text_731bae8893") },
        { keys: ["Esc", "Esc"], label: t("shortcuts.catalog.text_21f8a0c272") },
      ],
    },
  ];
}
