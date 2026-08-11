<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="112" alt="Otty" />

# Otty

---

### Hosts your CLI agents. Still a real terminal.

Run Codex and Claude Code through one interface on macOS and Windows, and see what they're doing — working, waiting on you, or done. No agent installed? It's still a full terminal.

**English** · [简体中文](README.md)

[![Open Source](https://img.shields.io/badge/Open%20Source-GitHub-181717?logo=github&logoColor=white)](https://github.com/ChengSoon/otty-desktop)
[![Release](https://img.shields.io/github/v/release/ChengSoon/otty-desktop?label=Release&color=1f6feb&include_prereleases)](https://github.com/ChengSoon/otty-desktop/releases)
[![License](https://img.shields.io/badge/License-LGPL--3.0-4caf50)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-555555)](#download)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![Stars](https://img.shields.io/github/stars/ChengSoon/otty-desktop?color=f5a623)](https://github.com/ChengSoon/otty-desktop/stargazers)

[Download](#download) · [Get started](#get-started) · [Features](#features) · [UI](#ui) · [Principles](#principles) · [Development](#development) · [Roadmap](#roadmap) · [License](#license)

</div>

> [!WARNING]
> **Early development.** What works today is one vertical slice: open a project → detect agents → launch switchable agent/shell tabs. That's a long way from the full shape described in the roadmap below. Interfaces and data formats may change incompatibly.

## Download

Installers live on the [Releases](https://github.com/ChengSoon/otty-desktop/releases) page. Four build targets: macOS Apple Silicon (`aarch64`), macOS Intel (`x64`), Windows, Linux.

The binaries are unsigned:

- On macOS, allow the first launch under System Settings → Privacy & Security.
- On Windows, SmartScreen flags an unknown publisher — choose More info → Run anyway.

Minimum versions: macOS 14, Windows 10 22H2 (Build 19045) / Windows 11.

## Get started

Otty ships no agents of its own — it hosts the ones already on your machine. So first make sure at least one works:

```bash
codex --version
claude --version
```

Then:

1. Launch Otty, click the project switcher at the top, pick a local directory.
2. Open the new-session menu in the sidebar and choose Shell, Codex, or Claude. Undetected agents are greyed out; hover to see why.
3. Open as many sessions per project as you want — tabs name themselves after your first prompt.
4. Hit `⌘U` for the usage panel to see which model and project your tokens went to.

Neither agent detected? Doesn't matter. Shell sessions don't depend on them, and Otty is just a terminal at that point.

## Features

**Project workspace**

- Open a local directory as a project; recents are remembered
- Sidebar groups by project, folds, and has a draggable width (`⌘B` collapses it entirely)
- Each session carries its own project, so different sessions can point at different directories

**Agent hosting**

- Detects Codex and Claude Code automatically: executable path, version, and a reason when unavailable
- Session state separates process lifecycle (creating / running / exited / error) from current behavior (idle / talking / awaiting choice)
- Tab titles are extracted from your first prompt; the untruncated original stays in the tooltip

**Terminal**

- xterm.js with the WebGL renderer — no seams between block characters
- Unix PTY on macOS, ConPTY on Windows; shell resolution tries PowerShell, `%ComSpec%`, then `cmd.exe`
- OSC 10/11 color queries are answered in Rust. This isn't optional: TUIs like Codex allow a ~100 ms window, and a round trip through `PTY → IPC → xterm.js → IPC → PTY` frequently misses it. On Windows the cost of a timeout isn't "no color" but "wrong color" — Codex falls back to ConPTY's black palette and paints the input box as a black block.
- Password prompt detection, with echo suppressed

**Usage stats**

- Aggregated straight from local Codex / Claude session logs — no network requests
- Four token buckets on one scale: input (excluding cache hits), cachedInput, cacheWrite, output
- Broken down by model and by project; window selectable as last 7 days / last 30 days / all time
- Quota windows and plan type (only Codex logs carry these fields; Claude's don't)

**Appearance**

- Light/dark theme, with theme colors fed through to the terminal palette
- JetBrains Mono and HarmonyOS Sans SC bundled

Shortcuts: `⌘B` collapses the sidebar, `⌘U` toggles the usage panel. Use `Ctrl` on Windows.

## UI

> Screenshots pending.

## Principles

**No model requests are proxied.** Otty embeds no inference client, stores no model API keys, and never touches your tokens. It launches your local CLI agent and reads the logs that agent writes itself.

**Full degradation to a plain terminal when agents are unavailable.** Agent integration is an enhancement, not a prerequisite. Failed detection should never stop you from opening a shell.

**Shared UI and core; branch on capability, not on OS name.** Platform differences are confined to adapters — no `if (windows)` in business code.

**Pixel parity across platforms is a non-goal.** Menus, shortcuts, and window behavior follow each platform's conventions.

Explicit non-goals: iOS / Android / web builds; built-in model inference; cloud sync, accounts, team collaboration, a plugin marketplace, LSP, and debuggers; silent privilege escalation.

## Stack

| Layer | Choice |
| --- | --- |
| Desktop shell | Tauri 2 |
| Backend | Rust 2024 edition (rustc 1.85+), portable-pty |
| Frontend | React 19, TypeScript, Vite |
| Terminal | xterm.js 6 + WebGL addon |

## Development

Requires the [Rust toolchain](https://rustup.rs), Node.js LTS, and pnpm 10.

```bash
pnpm install

pnpm desktop:dev      # desktop app, dev mode
pnpm desktop:build    # package
pnpm test             # frontend tests (vitest)
pnpm build            # typecheck + frontend build
```

Rust-side tests:

```bash
cd src-tauri && cargo test
```

### Layout

```
src/                  frontend
  workspace/          project workspace, tabs, sidebar
  terminal/           PTY sessions and xterm control
  usage/              token usage aggregation and display
  panel/              panel width and dragging
  theme/              theming and terminal palette
src-tauri/src/        Rust backend
  project/            project directories and recents
  agent/              Codex / Claude detection
  terminal/           PTY backend, launch profiles, OSC replies
  usage/              Codex / Claude session log parsing
.codestable/          requirements, roadmap, architecture decisions, feature designs
```

`.codestable/` is this project's documentation base — where requirements came from, how modules were split, and the design plus acceptance checklist for every feature. Worth a look before changing code.

## Roadmap

Past the delivered vertical slice, work proceeds along the split in [`.codestable/roadmap/otty-desktop/`](.codestable/roadmap/otty-desktop/):

- **Shared UI** — split panes, settings, prompt composer and queue, quick open, file preview panes
- **Shared Core** — session persistence and restore, agent adapter foundation, history and resume, recipe replay, import/export
- **Terminal Runtime** — cross-platform shell profiles (zsh/bash/fish, PowerShell/CMD/WSL/Git Bash), SSH
- **Platform Services** — notifications, Dock / Taskbar, credentials (Keychain / Credential Manager), global shortcuts, control CLI
- **Content & Git** — file browsing, edit preview, Git integration
- **Distribution** — signing, notarization, installers, auto-update

## Contributing

Issues and PRs welcome. Opening an issue first to align on direction is a good idea — interfaces shift often at this stage, and it saves wasted work.

Before opening a PR, please confirm `pnpm test`, `pnpm build`, and `cargo test` are all green.

## Disclaimer

Otty is a hosting layer for terminals and sessions. It is not responsible for what an agent executes on your machine. An agent's privileges are your shell's privileges: give it the ability to read and write files, run builds, and install dependencies, and it has the ability to delete things it shouldn't. Use it in version-controlled directories and review consequential operations yourself.

Numbers in the usage panel come from logs the agents write locally. Treat them as an estimate, not a bill — your provider's console is authoritative.

## License

[LGPL-3.0](LICENSE). LGPL-3.0 is a set of additional permissions on top of GPL-3.0; the complete terms require reading [GPL-3.0](LICENSE.GPL-3.0) alongside it.

Bundled fonts carry their own licenses: [JetBrains Mono](public/fonts/LICENSE-JetBrains-Mono.txt) (SIL OFL 1.1) and [HarmonyOS Sans](public/fonts/LICENSE-HarmonyOS-Sans.txt).
