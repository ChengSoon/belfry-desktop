import { describe, expect, it, vi } from "vitest";
import {
  clipboardContainsImage,
  clipboardImagePasteSequence,
  consumeWebClipboardPaste,
  listenForClipboardImagePaste,
  usesWebClipboardFallback,
} from "./clipboardPaste";

describe("usesWebClipboardFallback", () => {
  it("keeps the explicit Clipboard API workaround on Windows", () => {
    expect(usesWebClipboardFallback("Windows NT 10.0")).toBe(true);
  });

  it("lets macOS dispatch the native paste event", () => {
    expect(usesWebClipboardFallback("Macintosh; Intel Mac OS X 14_0")).toBe(false);
  });
});

describe("consumeWebClipboardPaste", () => {
  it("cancels the native paste before using the Clipboard API fallback", () => {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    const paste = vi.fn();

    expect(consumeWebClipboardPaste(event, paste)).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(paste).toHaveBeenCalledOnce();
  });
});

describe("clipboardContainsImage", () => {
  it("detects an image advertised by clipboard items", () => {
    expect(clipboardContainsImage(["text/plain"], ["image/png"], [])).toBe(true);
  });

  it("detects an image advertised by clipboard files", () => {
    expect(clipboardContainsImage(["Files"], [], ["image/jpeg"])).toBe(true);
  });

  it("ignores regular text and file clipboard payloads", () => {
    expect(clipboardContainsImage(["text/plain", "Files"], ["text/plain"], [""])).toBe(false);
  });

  it("maps image paste to the raw-mode Ctrl+V sequence", () => {
    expect(clipboardImagePasteSequence(["image/png"], [], [])).toBe("\x16");
    expect(clipboardImagePasteSequence(["text/plain"], [], [])).toBeNull();
  });

  it("prevents xterm text handling and forwards an image paste", () => {
    const pasteListeners: Array<(event: ClipboardEvent) => void> = [];
    const host = {
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        pasteListeners.push(listener as (event: ClipboardEvent) => void);
      },
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;
    const onImagePaste = vi.fn();
    const cleanup = listenForClipboardImagePaste(host, onImagePaste);
    const event = {
      clipboardData: {
        types: ["Files"],
        items: [{ type: "image/png" }],
        files: [],
      },
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as ClipboardEvent;

    const pasteListener = pasteListeners.at(0);
    expect(pasteListener).toBeDefined();
    pasteListener?.(event);
    expect(onImagePaste).toHaveBeenCalledWith("\x16");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();

    cleanup();
    expect(host.removeEventListener).toHaveBeenCalledOnce();
  });
});
