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
  label: "常用斜杠指令", items: items.map(([command, label]) => ({ command, label })),
});

const NATIVE_SECTIONS: Record<Exclude<AgentKind, "codex" | "claude">, GuideSection[]> = {
  pi: [commands([["/model", "切换模型"], ["/settings", "查看设置"], ["/resume", "恢复历史会话"], ["/compact", "压缩上下文"]])],
  antigravity: [commands([
    ["/model", "切换模型"], ["/config", "打开配置"], ["/permissions", "调整权限规则"],
    ["/mcp", "管理 MCP 工具"], ["/new", "开始新对话"], ["/resume", "恢复历史会话"],
    ["/help", "查看完整指令与帮助"], ["/keybindings", "编辑原生快捷键"],
  ])],
  opencode: [commands([
    ["/models", "切换模型"], ["/agents", "切换原生 Agent"], ["/new", "开始新对话"],
    ["/sessions", "恢复历史会话"], ["/undo", "撤回上一轮及其修改"], ["/redo", "恢复已撤回的一轮"], ["/editor", "在外部编辑器编辑提示"],
  ]), { label: "交互快捷键", items: [
    { keys: ["Ctrl", "P"], label: "打开命令面板" },
    { keys: ["Shift", "Tab"], label: "切换原生 Agent" },
    { keys: ["Esc"], label: "中断运行" },
    { keys: ["@"], label: "引用工作区文件" },
  ] }],
  kimi: [commands([
    ["/model", "切换模型"], ["/provider", "管理服务商"], ["/permission", "切换权限模式"], ["/plan", "切换计划模式"],
    ["/new", "开始新对话"], ["/sessions", "恢复历史会话"], ["/compact", "压缩上下文"], ["/undo", "撤回提示与上下文"],
    ["/tasks", "查看后台任务"], ["/reload", "重新加载配置与会话"],
  ]), { label: "交互快捷键", items: [
    { keys: ["Esc"], label: "中断运行" }, { keys: ["Ctrl", "S"], label: "向运行中的任务补充指令" },
    { keys: ["Ctrl", "O"], label: "展开或折叠工具输出" }, { keys: ["↑", "↓"], label: "在审批选项间移动" },
  ] }],
};

export function guideFootnote(tab: GuideTab, platform: ShortcutPlatform) {
  if (tab === "belfry" && platform === "control") {
    return "Windows / Linux 使用 Ctrl+Shift，给 Agent TUI 保留原生 Ctrl 快捷键。";
  }
  if (tab === "belfry") return "在设置 → 快捷键中修改；这些组合键在终端聚焦时也能使用。";
  return "指令会随 CLI 版本变化；在输入框键入 / 可查看当前完整列表。";
}

function belfrySections(platform: ShortcutPlatform): GuideSection[] {
  const entries = effectiveBindings(platform, loadShortcutSettings().settings[platform]).map(({ action, bindings }) => ({
    id: action.id, label: action.label, keys: bindingChord(bindings[0], platform),
  }));
  return [
    {
      label: "工作区",
      items: entries.filter((entry) => !entry.id.startsWith("activate-session-")),
    },
    {
      label: "会话",
      items: entries.filter((entry) => entry.id.startsWith("activate-session-")),
    },
    {
      label: "终端",
      items: [
        { label: "复制选中内容", keys: systemShortcutChord(platform, "C") },
        { label: "粘贴剪贴板", keys: systemShortcutChord(platform, "V") },
        { label: "关闭当前浮层", keys: ["Esc"] },
      ],
    },
  ];
}

const CODEX_SECTIONS: GuideSection[] = [
  {
    label: "常用斜杠指令",
    items: [
      { command: "/model", label: "切换模型" },
      { command: "/permissions", label: "调整审批与沙箱权限" },
      { command: "/plan", label: "进入 Plan 模式" },
      { command: "/status", label: "查看模型、权限与上下文" },
      { command: "/usage", label: "查看账户用量" },
      { command: "/compact", label: "压缩长会话上下文" },
      { command: "/diff", label: "查看工作区 Git diff" },
      { command: "/review", label: "请求工作区代码审查" },
      { command: "/new", label: "开始新对话" },
      { command: "/resume", label: "恢复已保存对话" },
    ],
  },
  {
    label: "交互快捷键",
    items: [
      { keys: ["@"], label: "搜索并引用工作区文件" },
      { keys: ["!"], label: "直接运行本地 Shell" },
      { keys: ["Ctrl", "R"], label: "搜索提示历史" },
      { keys: ["Ctrl", "O"], label: "复制最近完整回复" },
      { keys: ["Tab"], label: "运行中排队下一条指令" },
      { keys: ["Enter"], label: "运行中补充当前指令" },
      { keys: ["Esc", "Esc"], label: "编辑上一条并分叉" },
      { keys: ["Ctrl", "C"], label: "退出当前会话" },
    ],
  },
];

function claudeSections(platform: ShortcutPlatform): GuideSection[] {
  return [
    {
      label: "常用斜杠指令",
      items: [
        { command: "/model", label: "切换模型" },
        { command: "/permissions", label: "调整权限规则" },
        { command: "/plan", label: "切换 Plan 模式" },
        { command: "/context", label: "查看上下文占用" },
        { command: "/compact", label: "压缩会话上下文" },
        { command: "/diff", label: "查看代码改动" },
        { command: "/review", label: "审查当前代码改动" },
        { command: "/tasks", label: "查看后台任务" },
        { command: "/clear", label: "开始全新会话" },
        { command: "/resume", label: "恢复历史会话" },
      ],
    },
    {
      label: "交互快捷键",
      items: [
        { keys: ["@"], label: "引用文件或目录" },
        { keys: ["!"], label: "进入 Shell 模式" },
        { keys: ["?"], label: "空输入时打开帮助" },
        { keys: ["Ctrl", "C"], label: "中断运行 / 清空输入" },
        { keys: ["Ctrl", "O"], label: "打开详细记录视图" },
        { keys: ["Ctrl", "R"], label: "反向搜索提示历史" },
        { keys: ["Ctrl", "B"], label: "将任务转到后台" },
        { keys: ["Shift", "Tab"], label: "循环切换权限模式" },
        { keys: [platform === "macos" ? "⌥" : "Alt", "P"], label: "快速切换模型" },
        { keys: ["Esc", "Esc"], label: "清空草稿 / 打开回退" },
      ],
    },
  ];
}
