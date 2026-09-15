import { describe, expect, it, vi } from "vitest";
import type { TerminalOutputBatch } from "../contracts";
import { OutputQueue, OUTPUT_WINDOW_BYTES } from "./outputQueue";

function batch(deliveryId: number, size = 3): TerminalOutputBatch {
  return { kind: "output_batch", sessionId: "pty", connectionId: "connection", deliveryId,
    events: [{ kind: "output", sessionId: "pty", sequence: deliveryId - 1, bytes: Array(size).fill(120), eof: false }] };
}

function fixture() {
  const parsed: (() => void)[] = [];
  const render = vi.fn(() => new Promise<void>((resolve) => parsed.push(resolve)));
  const acknowledge = vi.fn(async () => true);
  const fail = vi.fn();
  const queue = new OutputQueue({ render, acknowledge, fail });
  const finish = async () => { parsed.shift()!(); await vi.waitFor(() => expect(acknowledge).toHaveBeenCalled()); };
  return { queue, parsed, render, acknowledge, fail, finish };
}

describe("terminal output consumption", () => {
  it("does not acknowledge a queued write until parsing completes", async () => {
    const test = fixture();
    test.queue.push(batch(1));
    test.queue.push(batch(2));
    expect(test.render).toHaveBeenCalledTimes(1);
    expect(test.acknowledge).not.toHaveBeenCalled();
    await test.finish();
    expect(test.acknowledge).toHaveBeenCalledWith({ sessionId: "pty", connectionId: "connection", deliveryId: 1 });
    expect(test.render).toHaveBeenCalledTimes(2);
    test.queue.dispose();
  });

  it("rejects an oversized queue without acknowledging or accepting more output", () => {
    const test = fixture();
    test.queue.push(batch(1, OUTPUT_WINDOW_BYTES / 2));
    test.queue.push(batch(2, OUTPUT_WINDOW_BYTES / 2));
    expect(test.fail).toHaveBeenCalledOnce();
    expect(test.acknowledge).not.toHaveBeenCalled();
    test.queue.push(batch(3));
    expect(test.render).toHaveBeenCalledTimes(1);
  });

  it.each([
    (value: TerminalOutputBatch) => ({ ...value, connectionId: "old-connection" }),
    (value: TerminalOutputBatch) => ({ ...value, sessionId: "other-pty" }),
    (value: TerminalOutputBatch) => ({ ...value, deliveryId: 1 }),
    (value: TerminalOutputBatch) => ({ ...value, deliveryId: 3 }),
  ])("rejects changed identities, duplicate delivery IDs and skipped deliveries", (change) => {
    const test = fixture();
    test.queue.push(batch(1));
    test.queue.push(change(batch(2)));
    expect(test.fail).toHaveBeenCalledOnce();
    expect(test.acknowledge).not.toHaveBeenCalled();
  });

  it("validates the early batch identity when create eventually resolves", () => {
    const test = fixture();
    test.queue.push(batch(1));
    test.queue.bind({ id: "pty", connectionId: "replacement" });
    expect(test.fail).toHaveBeenCalledOnce();
  });

  it("disposal prevents late parse callbacks from acknowledging a replaced connection", async () => {
    const test = fixture();
    test.queue.push(batch(1));
    test.queue.push(batch(2));
    test.queue.dispose();
    test.parsed.shift()!();
    await Promise.resolve();
    expect(test.acknowledge).not.toHaveBeenCalled();
    expect(test.render).toHaveBeenCalledTimes(1);
    expect(test.fail).not.toHaveBeenCalled();
  });

  it("reports acknowledgement failure once and stops before rendering another batch", async () => {
    const test = fixture();
    test.acknowledge.mockResolvedValue(false);
    test.queue.push(batch(1));
    test.queue.push(batch(2));
    await test.finish();
    expect(test.fail).toHaveBeenCalledOnce();
    expect(test.render).toHaveBeenCalledTimes(1);
  });

  it("releases local credit before an ACK response so an arriving replacement batch fits", async () => {
    const test = fixture();
    test.acknowledge.mockImplementation(async () => { test.queue.push(batch(5)); return true; });
    for (let id = 1; id <= 4; id++) test.queue.push(batch(id));
    await test.finish();
    expect(test.fail).not.toHaveBeenCalled();
    expect(test.render).toHaveBeenCalledTimes(2);
    test.queue.dispose();
  });
});
