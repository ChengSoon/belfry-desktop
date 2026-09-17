---
sidebar_position: 30
title: Terminal
description: xterm.js, PTY, SSH, and terminal content handling
---

# Terminal

When no Agent is present, Belfry is a full-featured terminal — and this layer has seen a fair amount of polish.

## Rendering

Built on **xterm.js 6 with the WebGL renderer**, with no gaps between block characters. CJK text, combining characters, and emoji all render at the correct width, with no misalignment.

## Platform backends

| Platform | Backend |
| --- | --- |
| macOS | Unix PTY |
| Windows | ConPTY |

On Windows, the shell is probed in order: **PowerShell**, then `%ComSpec%`, then `cmd.exe`.

## SSH sessions

SSH sessions **launch the system OpenSSH client directly**, with no intermediary layer:

- Passwords, host fingerprints, and 2FA all interact **natively in the terminal**
- Aliases, keys, and the agent from `~/.ssh/config` are **inherited as-is**
- Check "**Remember password**" when connecting, and it's stored in the system keychain (macOS Keychain / Windows Credential Manager), then filled in automatically next time
- Saved passwords can be **cleared at any time** from the SSH form

## Terminal content handling

- **`⌘F` search** across the current terminal content, including matches that span line breaks
- **HTTP(S) URLs are clickable** and open directly
- **Password prompt detection**, with input not echoed
- **File paths in terminal output are clickable** and jump to the file preview pane

## An invisible detail: OSC color queries

TUI programs (Codex included) query the terminal's foreground/background colors via OSC 10/11 sequences to decide what colors to draw themselves. Belfry **answers these directly in Rust**, instead of letting the query travel the full `PTY → IPC → xterm.js → IPC → PTY` round trip.

Why that round trip had to go: **TUIs like Codex only allow a 100 ms window**, and a full IPC round trip often times out. And on Windows, the consequence of a timeout isn't "no colors" — it's **wrong colors**. Codex falls back to reading ConPTY's black palette and paints the input box as a black block.
