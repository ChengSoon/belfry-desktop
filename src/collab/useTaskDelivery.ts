import { useEffect, useRef } from "react";
import type { PromptSubmitResult } from "../prompt/contracts";
import { markDispatched, pendingTasks, type PendingTask } from "./api";

/** 两次拉取之间隔多久。派活的可感延迟上限就是它。 */
const POLL_INTERVAL_MS = 750;

/**
 * 这次投递结果要不要给 Rust 回执。
 *
 * - `sent`：已经打进目标终端了。
 * - `queued`：目标在忙、或卡在权限框，Prompt 队列会等它回到 idle 再发。**也要回执**——
 *   队列已经接管这条指令，不回执的话下一轮又会拉到同一条，同一句话被贴好几遍。
 * - `unavailable`：目标不是 Agent、或者进程已经没了。不回执，留给下一轮再看；
 *   目标真的关掉后 Rust 那侧会在同步名册时把任务收成 Abandoned。
 */
export function shouldMarkDispatched(result: PromptSubmitResult) {
  return result !== "unavailable";
}

export interface DeliveryPorts {
  fetch: () => Promise<PendingTask[]>;
  submit: (tabId: string, text: string) => PromptSubmitResult;
  ack: (id: string) => Promise<void>;
}

/**
 * 把当前待投递的任务过一遍。返回实际回执了几条，方便调用方和测试判断。
 *
 * 抽成不依赖 React 的函数：定时器和重入保护的坑在 hook 里，投递语义在这里，
 * 两者分开才测得动。
 */
export async function deliverPending(ports: DeliveryPorts): Promise<number> {
  const tasks = await ports.fetch();
  let acked = 0;
  for (const task of tasks) {
    if (shouldMarkDispatched(ports.submit(task.to, task.text))) {
      await ports.ack(task.id);
      acked += 1;
    }
  }
  return acked;
}

/**
 * 把 `belfry send` 落下的任务投进目标终端。
 *
 * 复用 Prompt 队列而不是自己写投递循环：等 `running + idle`、串行、终端重挂回滚这些
 * 语义它已经有了。尤其是「目标卡在权限框（`awaiting-choice`）时不投」——`canDispatchPrompt`
 * 本来就要求 idle，所以指令会安静地排在队里，等用户把框处理完再进去，而不是被 paste 进
 * 那个框里替用户点掉一个选项。
 *
 * 定时器不挂在 effect 依赖上：`submit` 跟着 `tabs` 变，而终端一刷屏 `tabs` 就是个新数组，
 * 挂上去会让 interval 被反复清掉重建，最后一次都不触发。
 */
export function useTaskDelivery(submit: (tabId: string, text: string) => PromptSubmitResult) {
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    let stopped = false;
    let running = false;

    const tick = async () => {
      // 上一轮还没走完就跳过这一拍：同一条任务被两轮同时捡起会重复注入。
      if (running || stopped) return;
      running = true;
      try {
        await deliverPending({
          fetch: pendingTasks,
          submit: (tabId, text) => submitRef.current(tabId, text),
          ack: markDispatched,
        });
      } catch {
        // 协作是增强功能：IPC 抖一下不该把整个应用带下去，下一拍继续。
      } finally {
        running = false;
      }
    };

    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);
}
