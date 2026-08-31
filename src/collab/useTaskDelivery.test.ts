import { describe, expect, it, vi } from "vitest";
import type { PromptSubmitResult } from "../prompt/contracts";
import type { PendingTask } from "./api";
import { deliverPending, shouldMarkDispatched } from "./useTaskDelivery";

function task(id: string, to = "tab-b"): PendingTask {
  return {
    id,
    to,
    text: `[belfry] 来自「planner」的任务 ${id}\n审一下 auth.ts\n完成后执行：belfry done ${id}`,
    from: "tab-a",
    fromLabel: "planner",
    instruction: "审一下 auth.ts",
  };
}

function ports(tasks: PendingTask[], result: PromptSubmitResult = "sent") {
  const submit = vi.fn<(tabId: string, text: string) => PromptSubmitResult>(() => result);
  const ack = vi.fn(async () => {});
  return { submit, ack, all: { fetch: async () => tasks, submit, ack } };
}

describe("shouldMarkDispatched", () => {
  it("送出去了要回执", () => {
    expect(shouldMarkDispatched("sent")).toBe(true);
  });

  it("排进队列也要回执", () => {
    // 目标在忙或卡在权限框时会进队列。不回执的话下一轮又拉到同一条，
    // 同一句指令会被贴好几遍——比晚一点送到糟得多。
    expect(shouldMarkDispatched("queued")).toBe(true);
  });

  it("目标投不出去时不回执，留给下一轮", () => {
    expect(shouldMarkDispatched("unavailable")).toBe(false);
  });
});

describe("deliverPending", () => {
  it("把注入文本原样交给目标会话，并回执", async () => {
    const { submit, ack, all } = ports([task("01aa")]);

    const acked = await deliverPending(all);

    expect(submit).toHaveBeenCalledWith("tab-b", expect.stringContaining("belfry done 01aa"));
    expect(ack).toHaveBeenCalledWith("01aa");
    expect(acked).toBe(1);
  });

  it("一轮里把多条都投出去", async () => {
    const { submit, ack, all } = ports([task("01aa"), task("01bb", "tab-c")]);

    expect(await deliverPending(all)).toBe(2);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(ack).toHaveBeenCalledTimes(2);
  });

  it("目标不可用时不回执，好让下一轮重试", async () => {
    const { ack, all } = ports([task("01aa")], "unavailable");

    expect(await deliverPending(all)).toBe(0);
    expect(ack).not.toHaveBeenCalled();
  });

  it("没有待投递任务时什么都不做", async () => {
    const { submit, all } = ports([]);

    expect(await deliverPending(all)).toBe(0);
    expect(submit).not.toHaveBeenCalled();
  });

  it("回执失败会往上抛，由外层那一拍兜住", async () => {
    // 不在这里咽掉：吞了的话这条已经投进终端、Rust 却还当它待投递，
    // 下一轮会再投一次，用户看到同一句话贴了两遍。
    const failing = {
      fetch: async () => [task("01aa")],
      submit: () => "sent" as PromptSubmitResult,
      ack: async () => {
        throw new Error("IPC 断了");
      },
    };

    await expect(deliverPending(failing)).rejects.toThrow("IPC 断了");
  });
});
