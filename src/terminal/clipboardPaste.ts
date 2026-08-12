const IMAGE_MIME_PREFIX = "image/";
const IMAGE_PASTE_SEQUENCE = "\x16";

export function usesWebClipboardFallback(userAgent = navigator.userAgent) {
  return userAgent.includes("Windows");
}

export function consumeWebClipboardPaste(
  event: KeyboardEvent,
  paste: () => void,
) {
  // Returning false from xterm's custom key handler only skips xterm's key
  // processing. The WebView default must also be cancelled or its native paste
  // event will insert the same clipboard text a second time.
  event.preventDefault();
  event.stopPropagation();
  paste();
  return false;
}

export function clipboardContainsImage(
  types: readonly string[],
  itemTypes: readonly string[],
  fileTypes: readonly string[],
) {
  return [...types, ...itemTypes, ...fileTypes].some((type) =>
    type.toLowerCase().startsWith(IMAGE_MIME_PREFIX),
  );
}

export function clipboardImagePasteSequence(
  types: readonly string[],
  itemTypes: readonly string[],
  fileTypes: readonly string[],
) {
  return clipboardContainsImage(types, itemTypes, fileTypes) ? IMAGE_PASTE_SEQUENCE : null;
}

export function listenForClipboardImagePaste(
  host: HTMLElement,
  onImagePaste: (sequence: string) => void,
) {
  const onPaste = (event: ClipboardEvent) => {
    const data = event.clipboardData;
    const sequence = data && clipboardImagePasteSequence(
      Array.from(data.types),
      Array.from(data.items, (item) => item.type),
      Array.from(data.files, (file) => file.type),
    );
    if (!sequence) return;

    // xterm 只会读取 text/plain；图片必须把这次 Cmd+V 交给 TUI 自己读取系统剪贴板。
    event.preventDefault();
    event.stopImmediatePropagation();
    onImagePaste(sequence);
  };
  host.addEventListener("paste", onPaste, true);
  return () => host.removeEventListener("paste", onPaste, true);
}
