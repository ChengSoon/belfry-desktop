import {
  appShortcutChord,
  systemShortcutChord,
  type ShortcutPlatform,
} from "./resolveShortcut";

export type GuideTab = "belfry" | "codex" | "claude";

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
  return claudeSections(platform);
}

export function guideFootnote(tab: GuideTab, platform: ShortcutPlatform) {
  if (tab === "belfry" && platform === "control") {
    return "Windows / Linux 使用 Ctrl+Shift，给 Agent TUI 保留原生 Ctrl 快捷键。";
  }
  if (tab === "belfry") return "这些 Belfry 组合键在终端聚焦时也能使用。";
  return "指令会随 CLI 版本变化；在输入框键入 / 可查看当前完整列表。";
}

function belfrySections(platform: ShortcutPlatform): GuideSection[] {
  return [
    {
      label: "工作区",
      items: [
        { label: "新建 Shell 会话", keys: appShortcutChord(platform, "T") },
        { label: "显示 / 隐藏侧栏", keys: appShortcutChord(platform, "B") },
        { label: "打开 / 关闭用量", keys: appShortcutChord(platform, "U") },
        { label: "打开 / 关闭历史", keys: appShortcutChord(platform, "H", true) },
        { label: "打开设置", keys: appShortcutChord(platform, ",") },
        { label: "打开快捷指令", keys: appShortcutChord(platform, "/") },
      ],
    },
    {
      label: "会话与终端",
      items: [
        { label: "切换第 1–9 个会话", keys: appShortcutChord(platform, "1…9") },
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
