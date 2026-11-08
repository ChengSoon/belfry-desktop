import { describe, expect, it, vi } from "vitest";
import type { PromptSubmitOptions, PromptSubmitResult } from "../prompt/contracts";
import type { DeliveryUpdate, PendingTask } from "./api";
import { DeliveryCoordinator, type DeliveryPorts } from "./delivery";
import { shouldMarkDispatched } from "./useTaskDelivery";

function task(id = "task-1"): PendingTask {
  return { id, to: "tab-b", text: "belfry done task-1", from: "tab-a", fromLabel: "planner", instruction: "work" };
}
function ports(result: PromptSubmitResult = "queued") {
  let options: PromptSubmitOptions | undefined;
  const all = {
    fetch: vi.fn(async () => [task()]),
    claim: vi.fn(async () => true), release: vi.fn(async () => {}),
    receipt: vi.fn(async (_update: DeliveryUpdate) => true),
    submit: vi.fn((_tab: string, _text: string, incoming: PromptSubmitOptions) => {
      options = incoming;
      if (result !== "unavailable") incoming.onUpdate?.({ state: "queued" });
      return result;
    }),
  } satisfies DeliveryPorts;
  return { all, options: () => options! };
}

describe("shouldMarkDispatched", () => {
  it("regression: a queue acknowledgement is never a PTY submission receipt", () => {
    expect(shouldMarkDispatched("queued")).toBe(false);
    expect(shouldMarkDispatched("sent")).toBe(false);
    expect(shouldMarkDispatched("submitted")).toBe(true);
    expect(shouldMarkDispatched("unavailable")).toBe(false);
  });
});

describe("durable delivery", () => {
  it.each(["queued", "sent"] as const)("%s records queue ownership without claiming PTY submission", async (result) => {
    const { all, options } = ports(result);
    await new DeliveryCoordinator().tick(all);
    expect(all.claim).toHaveBeenCalledWith("task-1", expect.any(String));
    expect(options().id).toBe("task-1");
    expect(all.receipt.mock.calls.map(([update]) => update.phase)).toEqual(["queued"]);
  });

  it("records submitted only after the durable gate and actual observer receipt", async () => {
    const { all, options } = ports();
    const delivery = new DeliveryCoordinator();
    await delivery.tick(all);
    expect(await options().beforeSend!()).toBe(true);
    options().onUpdate!({ state: "submitted" });
    all.fetch.mockResolvedValue([]);
    await delivery.tick(all);
    expect(all.receipt.mock.calls.map(([update]) => update.phase)).toEqual(["queued", "submitting", "submitted"]);
    expect(all.receipt.mock.calls.map(([update]) => update.sequence)).toEqual([1, 2, 3]);
    expect(all.submit).toHaveBeenCalledTimes(1);
  });

  it("failed queue and submitted receipts retry the same sequence without re-enqueuing", async () => {
    const { all, options } = ports();
    const delivery = new DeliveryCoordinator();
    all.receipt.mockRejectedValueOnce(new Error("IPC failed"));
    await expect(delivery.tick(all)).rejects.toThrow("IPC failed");
    await delivery.tick(all);
    await options().beforeSend!();
    options().onUpdate!({ state: "submitted" });
    all.receipt.mockRejectedValueOnce(new Error("receipt lost"));
    all.fetch.mockResolvedValue([]);
    await expect(delivery.tick(all)).rejects.toThrow("receipt lost");
    await delivery.tick(all);
    expect(all.submit).toHaveBeenCalledTimes(1);
    const submitted = all.receipt.mock.calls.map(([update]) => update).filter((update) => update.phase === "submitted");
    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toEqual(submitted[1]);
  });

  it("a lost claim receipt retries the same attempt before enqueueing", async () => {
    const { all } = ports();
    const delivery = new DeliveryCoordinator();
    all.claim.mockRejectedValueOnce(new Error("claim lost"));
    await expect(delivery.tick(all)).rejects.toThrow("claim lost");
    expect(all.submit).not.toHaveBeenCalled();
    await delivery.tick(all);
    expect(all.claim.mock.calls[0]).toEqual(all.claim.mock.calls[1]);
    expect(all.submit).toHaveBeenCalledTimes(1);
  });

  it("unavailable targets release a claim and can be retried without a submitted receipt", async () => {
    const { all } = ports("unavailable");
    const delivery = new DeliveryCoordinator();
    await delivery.tick(all);
    await delivery.tick(all);
    expect(all.release).toHaveBeenCalledTimes(2);
    expect(all.receipt).not.toHaveBeenCalled();
  });

  it("an attempt owned by another renderer is not submitted", async () => {
    const { all } = ports();
    all.claim.mockResolvedValue(false);
    await new DeliveryCoordinator().tick(all);
    expect(all.submit).not.toHaveBeenCalled();
  });

  it("uncertainty stays observable and later manual confirmation uses the same attempt", async () => {
    const { all, options } = ports();
    const delivery = new DeliveryCoordinator();
    await delivery.tick(all);
    await options().beforeSend!();
    options().onUpdate!({ state: "attention", message: "disconnected" });
    all.fetch.mockResolvedValue([]);
    await delivery.tick(all);
    options().onUpdate!({ state: "submitted" });
    await delivery.tick(all);
    expect(all.receipt.mock.calls.map(([update]) => update.phase)).toEqual(["queued", "submitting", "uncertain", "submitted"]);
  });

  it("queue cancellation persists an explicit cancellation receipt", async () => {
    const { all, options } = ports();
    const delivery = new DeliveryCoordinator();
    await delivery.tick(all);
    options().onUpdate!({ state: "cancelled", message: "target closed" });
    all.fetch.mockResolvedValue([]);
    await delivery.tick(all);
    expect(all.receipt).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "cancelled", message: "target closed" }));
    expect(all.submit).toHaveBeenCalledTimes(1);
  });

  it("a failed release is retried before the same task can be enqueued again", async () => {
    const { all } = ports("unavailable");
    const delivery = new DeliveryCoordinator();
    all.release.mockRejectedValueOnce(new Error("release response lost"));
    await expect(delivery.tick(all)).rejects.toThrow("release response lost");
    all.fetch.mockResolvedValue([]);
    await delivery.tick(all);
    expect(all.release.mock.calls[0]).toEqual(all.release.mock.calls[1]);
    expect(all.claim).toHaveBeenCalledTimes(1);
    expect(all.submit).toHaveBeenCalledTimes(1);
  });

  it("a synchronous submit failure invalidates its gate and releases ownership", async () => {
    const { all } = ports();
    let captured: PromptSubmitOptions | undefined;
    all.submit.mockImplementationOnce((_tab, _text, options) => {
      captured = options;
      throw new Error("submit threw");
    });
    const delivery = new DeliveryCoordinator();
    await expect(delivery.tick(all)).rejects.toThrow("submit threw");
    expect(all.release).toHaveBeenCalledTimes(1);
    expect(await captured?.beforeSend?.()).toBe(false);
    expect(all.receipt).not.toHaveBeenCalled();
    await delivery.tick(all);
    expect(all.submit).toHaveBeenCalledTimes(2);
  });

  it("a pending-list error does not delay an actual submission receipt", async () => {
    const { all, options } = ports();
    const delivery = new DeliveryCoordinator();
    await delivery.tick(all);
    await options().beforeSend!();
    options().onUpdate!({ state: "submitted" });
    all.fetch.mockRejectedValueOnce(new Error("pending unavailable"));
    await expect(delivery.tick(all)).rejects.toThrow("pending unavailable");
    expect(all.receipt).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "submitted" }));
  });
});
