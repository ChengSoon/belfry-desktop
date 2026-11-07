import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { roomSay } from "./api";
import { importRoomAttachment } from "./attachmentApi";
import { attachmentExtension, attachmentSize, isPreviewImage, messageSummary, transferFiles } from "./attachments";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe("room attachments", () => {
  it("reads file payloads once even when both clipboard collections contain them", () => {
    const image = new File(["image"], "截图.png", { type: "image/png" });
    const document = new File(["pdf"], "说明.pdf", { type: "application/pdf" });
    const items = [image, document].map((file) => ({ kind: "file", getAsFile: () => file }));
    expect(transferFiles({ files: [image, document], items } as unknown as DataTransfer)).toEqual([image, document]);
    expect(transferFiles({ files: [], items } as unknown as DataTransfer)).toEqual([image, document]);
    expect(transferFiles({ files: [], items: [{ kind: "string", getAsFile: () => null }] } as unknown as DataTransfer)).toEqual([]);
  });

  it("sends pasted bytes as raw binary with an ASCII header that keeps Unicode names", async () => {
    const file = new File([new Uint8Array([0, 128, 255])], "需求 📄.pdf", { type: "application/pdf" });
    await importRoomAttachment("room-1", file);
    const [command, buffer, options] = vi.mocked(invoke).mock.calls[0];
    expect(command).toBe("room_paste_attachment");
    expect(Array.from(new Uint8Array(buffer as ArrayBuffer))).toEqual([0, 128, 255]);
    const header = (options?.headers as Record<string, string>)["x-room-attachment"];
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(header)).toEqual({ roomId: "room-1", name: "需求 📄.pdf" });
  });

  it("names a pasted screenshot that has no file name", async () => {
    await importRoomAttachment("room-1", new File(["x"], "", { type: "image/jpeg" }));
    const header = (vi.mocked(invoke).mock.calls[0][2]?.headers as Record<string, string>)["x-room-attachment"];
    expect(JSON.parse(header).name).toBe("粘贴附件.jpg");
  });

  it("imports a dragged path through the path command", async () => {
    await importRoomAttachment("room-1", "/Users/me/设计稿.png");
    expect(invoke).toHaveBeenLastCalledWith("room_import_attachment", { id: "room-1", source: "/Users/me/设计稿.png" });
  });

  it("sends attachment ids with the message and keeps file names out of the routed text", async () => {
    await roomSay("room-1", "@后端 看一下", [], null, true, ["file-1"]);
    expect(invoke).toHaveBeenLastCalledWith("room_say", {
      id: "room-1", text: "@后端 看一下", to: [], replyTo: null, ask: true, attachmentIds: ["file-1"],
    });
    await roomSay("room-1", "只是文字", [], null, false);
    expect(invoke).toHaveBeenLastCalledWith("room_say", expect.objectContaining({ attachmentIds: [] }));
  });

  it("formats sizes, picks safe previews and summarizes attachment-only messages", () => {
    expect(attachmentSize(512)).toBe("512 B");
    expect(attachmentSize(2048)).toBe("2 KB");
    expect(attachmentSize(20 * 1024 * 1024)).toBe("20 MB");
    expect(isPreviewImage("image/png")).toBe(true);
    expect(isPreviewImage("image/svg+xml")).toBe(false);
    expect(isPreviewImage("application/pdf")).toBe(false);
    expect(attachmentExtension("需求.pdf")).toBe("PDF");
    expect(attachmentExtension("Makefile")).toBe("");
    expect(attachmentExtension(".env")).toBe("");
    const file = { id: "f", name: "需求.pdf", path: "/x/需求.pdf", size: 3, mimeType: "application/pdf" };
    expect(messageSummary({ text: "", attachments: [file] })).toBe("[附件] 需求.pdf");
    expect(messageSummary({ text: "看下", attachments: [file] })).toBe("看下");
    expect(messageSummary({ text: "看下" })).toBe("看下");
  });
});
