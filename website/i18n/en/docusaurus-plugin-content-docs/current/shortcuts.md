---
sidebar_position: 11
title: Keyboard shortcuts
description: The full Belfry shortcut reference
---

# Keyboard shortcuts

macOS uses `⌘`; Windows uses `Ctrl+Shift`.

:::note Why Ctrl+Shift on Windows
**The single-key `Ctrl` combinations are deliberately avoided** to stay out of the way of Codex and Claude's native CLI shortcuts — they capture `Ctrl` keys inside the terminal, so the host can't also claim them.
:::

| Action | macOS | Windows |
| --- | --- | --- |
| New Shell | `⌘T` | `Ctrl+Shift+T` |
| Collapse / expand sidebar | `⌘B` | `Ctrl+Shift+B` |
| Quick Open | `⌘K` | `Ctrl+Shift+K` |
| Toggle usage panel | `⌘U` | `Ctrl+Shift+U` |
| Toggle history | `⌘⇧H` | `Ctrl+Shift+H` |
| Open settings | `⌘,` | `Ctrl+Shift+,` |
| Switch session | `⌘1` – `⌘9` | `Ctrl+Shift+1` – `Ctrl+Shift+9` |
| Open command palette | `⌘/` | `Ctrl+Shift+/` |
| Search terminal content | `⌘F` | `Ctrl+Shift+F` |

## In-terminal shortcuts

These operate on terminal content rather than session management:

- **`⌘F`** searches the current terminal content, including across line breaks
- Click any **HTTP(S) URL** in the terminal to open it
- Click any **file path** in the terminal to jump to the file preview pane
