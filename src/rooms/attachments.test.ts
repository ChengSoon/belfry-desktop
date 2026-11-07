import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { importRoomAttachment } from "./attachmentApi";
import { attachmentSize, isPreviewImage, messageExcerpt, transferFiles } from "./attachments";
import { roomBroadcast, roomDispatch, roomSendMessage } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe("attachment clipboard and transport", () => {
  it("reads file payloads once even when both clipboard collections contain them", () => {
    const image = new File(["image"], "截图.png", { type: "image/png" });
    const document = new File(["pdf"], "说明.pdf", { type: "application/pdf" });
    const items = [image, document].map((file) => ({ kind: "file", getAsFile: () => file }));
    expect(transferFiles({ files: [image, document], items } as unknown as DataTransfer)).toEqual([image, document]);
    expect(transferFiles({ files: [], items } as unknown as DataTransfer)).toEqual([image, document]);
    expect(transferFiles({ files: [], items: [{ kind: "string", getAsFile: () => null }] } as unknown as DataTransfer)).toEqual([]);
  });

  it("sends binary bytes with an ASCII header while preserving Unicode filenames", async () => {
    const file = new File([new Uint8Array([0, 128, 255])], "需求 📄.pdf", { type: "application/pdf" });
    await importRoomAttachment("room-1", file);
    const [command, buffer, options] = vi.mocked(invoke).mock.calls[0];
    expect(command).toBe("room_paste_attachment");
    expect(Array.from(new Uint8Array(buffer as ArrayBuffer))).toEqual([0, 128, 255]);
    const header = (options?.headers as Record<string, string>)["x-room-attachment"];
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(header)).toEqual({ roomId: "room-1", name: "需求 📄.pdf" });
  });

  it("keeps filenames and paths outside the text used for @ routing on all send paths", async () => {
    await roomBroadcast("room-1", "@设计 看一下", "reply-1", ["file-1"]);
    expect(invoke).toHaveBeenLastCalledWith("room_broadcast", {
      id: "room-1", text: "@设计 看一下", replyTo: "reply-1", attachmentIds: ["file-1"],
    });
    await roomDispatch("room-1", "", ["member-1"], undefined, ["file-1"]);
    expect(invoke).toHaveBeenLastCalledWith("room_dispatch", {
      id: "room-1", text: "", memberIds: ["member-1"], acceptance: undefined, attachmentIds: ["file-1"],
    });
    await roomSendMessage("room-1", "", null, ["file-1"]);
    expect(invoke).toHaveBeenLastCalledWith("room_send_message", {
      id: "room-1", text: "", replyTo: null, attachmentIds: ["file-1"],
    });
  });
});

it("shows useful attachment summaries and reserves image previews for browser-safe raster formats", () => {
  expect(attachmentSize(2048)).toBe("2 KB");
  expect(attachmentSize(20 * 1024 * 1024)).toBe("20 MB");
  expect(isPreviewImage("image/png")).toBe(true);
  expect(isPreviewImage("image/svg+xml")).toBe(false);
  expect(isPreviewImage("application/pdf")).toBe(false);
  expect(messageExcerpt({ text: "", attachments: [{ id: "file-1", name: "需求.pdf", path: "/local/需求.pdf", size: 3, mimeType: "application/pdf" }] })).toBe("需求.pdf");
});
