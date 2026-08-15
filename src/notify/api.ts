import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { NotifyContent } from "./rules";

/**
 * 权限只谈一次，且拖到真要发第一条通知时才谈。
 *
 * 启动即索要通知权限是最容易被拒的问法——用户还没见过这功能有什么用。等到 Agent
 * 第一次真的跑完了才弹，那一刻的语境自己会替功能说话。
 *
 * 缓存的是 Promise 而不是结果：几条会话可能在同一帧里同时完成，缓存布尔值挡不住
 * 它们各自发起一次权限协商，用户会连吃几个系统弹框。
 *
 * 代价是用户改主意得重启应用才生效——被拒之后这里就一直是 false。可以接受：
 * 反复弹权限框比这难受得多。
 */
let permission: Promise<boolean> | null = null;

function ensurePermission(): Promise<boolean> {
  permission ??= negotiate();
  return permission;
}

async function negotiate(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    // 非 Tauri 环境（探针页）里这些 invoke 会直接抛，当作没有通知能力。
    return false;
  }
}

/** 通知是增强不是主线：任何一步失败都只是没通知，不该让终端跟着出事。 */
export async function notify(content: NotifyContent): Promise<void> {
  if (!(await ensurePermission())) return;
  try {
    sendNotification({ title: content.title, body: content.body });
  } catch {
    // 忽略：发不出去就发不出去。
  }
}

/**
 * Dock 角标。传 0 清掉。
 *
 * 只有 macOS 认这个 API，Windows 上要改画 overlay icon（得给一张图），
 * 所以这里失败即静默——Windows 用户照样收得到通知，只是任务栏上没有数字。
 */
export async function setBadge(count: number): Promise<void> {
  try {
    await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined);
  } catch {
    // 忽略：没有角标不影响通知本身。
  }
}
