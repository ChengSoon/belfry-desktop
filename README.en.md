<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="112" alt="Belfry" />

# Belfry

---

### Hosts your CLI agents. Still a real terminal.

Run Codex and Claude Code through one interface on macOS and Windows, and see what they're doing — working, waiting on you, or done. No agent installed? It's still a full terminal.

**English** · [简体中文](README.md)

[![Open Source](https://img.shields.io/badge/Open%20Source-GitHub-181717?logo=github&logoColor=white)](https://github.com/ChengSoon/belfry-desktop)
[![Release](https://img.shields.io/github/v/release/ChengSoon/belfry-desktop?label=Release&color=1f6feb&include_prereleases)](https://github.com/ChengSoon/belfry-desktop/releases)
[![License](https://img.shields.io/badge/License-LGPL--3.0-4caf50)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-555555)](#download)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![Stars](https://img.shields.io/github/stars/ChengSoon/belfry-desktop?color=f5a623)](https://github.com/ChengSoon/belfry-desktop/stargazers)

[Download](#download) · [Get started](#get-started) · [Features](#features) · [UI](#ui) · [Principles](#principles) · [Development](#development) · [Roadmap](#roadmap) · [License](#license)

</div>

> [!WARNING]
> **Early development.** What works today is one vertical slice: open a project → detect agents → launch switchable agent/shell tabs. That's a long way from the full shape described in the roadmap below. Interfaces and data formats may change incompatibly.

## Download

Installers live on the [Releases](https://github.com/ChengSoon/belfry-desktop/releases) page. Four build targets: macOS Apple Silicon (`aarch64`), macOS Intel (`x64`), Windows, Linux.

The macOS builds are ad-hoc signed but not notarized by Apple. The Windows builds are unsigned:

- On macOS, if Gatekeeper blocks the first launch, right-click the app in Finder and choose Open, or allow it under System Settings → Privacy & Security.
- On Windows, SmartScreen flags an unknown publisher — choose More info → Run anyway.

Minimum versions: macOS 14, Windows 10 22H2 (Build 19045) / Windows 11.

## Get started

Belfry ships no agents of its own — it hosts the ones already on your machine. So first make sure at least one works:

```bash
codex --version
claude --version
```

Then:

1. Launch Belfry, click the project switcher at the top, pick a local directory.
2. Open the new-session menu in the sidebar and choose Shell, SSH, Codex, or Claude. Undetected agents are greyed out; hover to see why.
3. Open as many sessions per project as you want — tabs name themselves after your first prompt.
4. Hit `⌘U` for the usage panel to see which model and project your tokens went to.

Neither agent detected? Doesn't matter. Shell sessions don't depend on them, and Belfry is just a terminal at that point.

## Features

**Project workspace**

- Open a local directory as a project; recents are remembered
- Sidebar groups by project, folds, and has a draggable width (`⌘B` collapses it entirely)
- Each session carries its own project, so different sessions can point at different directories
- Quick Open (`⌘K`) searches sessions and recent projects, and runs common workspace actions

**Agent hosting**

- Detects Codex and Claude Code automatically: executable path, version, and a reason when unavailable
- Session state separates process lifecycle (creating / running / exited / error) from current behavior (idle / talking / awaiting choice)
- Tab titles are extracted from your first prompt; the untruncated original stays in the tooltip
- Prompt Composer (`⌘J`; `Ctrl+Shift+J` on Windows / Linux) sends multiline prompts to a selected Codex or Claude session
- New prompts queue per session while an agent is talking or awaiting confirmation, then dispatch in order when it returns to idle; queued items can be removed or sent manually

**Activity notifications**

- Only two things are worth interrupting you for: the agent finished, or it's stuck on something only you can answer
- Completion notifications wait 1500 ms before firing. Activity is inferred by scanning screen text, and `talking → idle → awaiting choice` is a common path (the spinner disappears a beat before the permission prompt paints) — firing "finished" in that gap is a pure false positive
- Nothing pops while you're looking right at that session — you've already seen it
- State goes in the title, identity in the body: first decide whether to deal with it now, then which session it was
- Unread counts aggregate into the Dock / taskbar badge and clear when you come back

**Provider switching**

- Switch Codex / Claude Code routing between official endpoints and third-party relays. It rewrites the CLI's own config files, so running `claude` or `codex` outside Belfry picks up the same setting
- Surgical field rewrites: only routing keys like `ANTHROPIC_BASE_URL` and the `[model_providers.belfry]` table are touched — your hooks, MCP definitions, and project trust records stay byte-for-byte intact
- On first launch, whatever is already in your config files is adopted as a switchable entry, so nothing is silently overwritten
- Codex's ChatGPT login state is backed up before switching to a third party and restored verbatim when you switch back
- Detects `ANTHROPIC_*` / `OPENAI_*` environment variables that would override the config file, and says so

**Terminal**

- xterm.js with the WebGL renderer — no seams between block characters
- Unix PTY on macOS, ConPTY on Windows; shell resolution tries PowerShell, `%ComSpec%`, then `cmd.exe`
- SSH sessions spawn the system OpenSSH client: passwords, host-key fingerprints, and 2FA are handled interactively in the terminal, and `~/.ssh/config` aliases, keys, and agent inherit as-is
  - Check "remember password" when connecting to store it in the OS keychain (macOS Keychain / Windows Credential Manager) and auto-fill future connections; saved passwords can be cleared from the SSH form
- OSC 10/11 color queries are answered in Rust. This isn't optional: TUIs like Codex allow a ~100 ms window, and a round trip through `PTY → IPC → xterm.js → IPC → PTY` frequently misses it. On Windows the cost of a timeout isn't "no color" but "wrong color" — Codex falls back to ConPTY's black palette and paints the input box as a black block.
- Password prompt detection, with echo suppressed
- `⌘F` searches terminal content across wrapped lines; HTTP(S) URLs are clickable; CJK, combining characters, and emoji use correct cell widths

**Usage stats**

- Aggregated straight from local Codex / Claude session logs — no network requests
- Four token buckets on one scale: input (excluding cache hits), cachedInput, cacheWrite, output
- Broken down by model and by project; window selectable as last 7 days / last 30 days / all time
- Quota windows and plan type (only Codex logs carry these fields; Claude's don't)

**Appearance**

- Light/dark theme, with theme colors fed through to the terminal palette
- Synchronized app-wide font and 10–20px sizing, with locally installed font support
- Multiple persistent TTF / OTF / WOFF / WOFF2 imports, each independently selectable and removable, with instant switching back to system fonts
- JetBrains Mono and HarmonyOS Sans SC bundled

Belfry shortcuts: `⌘T` opens a Shell, `⌘B` toggles the sidebar, `⌘J` opens Prompt Composer, `⌘K` opens Quick Open, `⌘U` toggles usage,
`⌘⇧H` toggles history, `⌘,` opens settings, `⌘1–9` switches sessions, and `⌘/` opens
the shortcut guide. Windows and Linux use `Ctrl+Shift` chords so Codex and Claude keep
their native `Ctrl` shortcuts.

## UI

> Screenshots pending.

## Principles

**No model requests are proxied.** Belfry embeds no inference client — requests go straight from the CLI agent to whichever provider you picked, never through Belfry. Switching providers rewrites the agent's own config files, touching only the routing keys and leaving everything else byte-for-byte intact; API keys are stored in plain text on your machine (owner-readable only), the same way the CLIs store them.

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
  prompt/             Prompt Composer and per-agent queue
  quickopen/          fast search across sessions, projects, and actions
  provider/           provider switching for the agent CLIs
  settings/           settings dialog (appearance, providers)
  notify/             activity notifications and badge
  usage/              token usage aggregation and display
  panel/              panel width and dragging
  shortcuts/          global shortcuts and shortcut guide
  theme/              theming and terminal palette
  typography/         global font, sizing, and imported assets
src-tauri/src/        Rust backend
  project/            project directories and recents
  agent/              Codex / Claude detection
  provider/           surgical rewrites of both CLIs' config files
  terminal/           PTY backend, launch profiles, OSC replies
  usage/              Codex / Claude session log parsing
.codestable/          requirements, roadmap, architecture decisions, feature designs
```

`.codestable/` is this project's documentation base — where requirements came from, how modules were split, and the design plus acceptance checklist for every feature. Worth a look before changing code.

## Roadmap

Past the delivered vertical slice, work proceeds along the split in [`.codestable/roadmap/belfry-desktop/`](.codestable/roadmap/belfry-desktop/):

### Shipped versions

- **v0.10.0 · Terminal foundation**: cross-platform Shell Profiles, terminal search, clickable HTTP(S) links, Unicode width support, and backwards-compatible workspace archives.
- **v0.11.0 · Workspace navigation**: Quick Open search across sessions, projects, and actions, with keyboard navigation and common workspace commands.
- **v0.12.0 · Prompt Composer & Queue**: choose a Codex or Claude session, submit multiline prompts from a dedicated Composer, queue per session while the agent is busy, dispatch serially when idle, and recover queued work across target remounts, send failures, and session closure.

### Next milestones

- **v0.13.0 · File preview pane**: open read-only previews from projects and terminal paths, navigate directories, highlight syntax, follow the active project, and signal when a file changed on disk.
- **v0.14.0 · Agent adapter foundation**: unify Codex / Claude launch, state, and history capabilities behind a stable adapter contract for recipe replay and import / export.

### Long-term tracks

- **Shared UI** — split panes, settings, prompt composer and queue, quick open, file preview panes (v0.13)
- **Shared Core** — session persistence and restore, agent adapter foundation, history and resume, recipe replay, import/export
- **Terminal Runtime** — cross-platform shell profiles (zsh/bash/fish, PowerShell/CMD/WSL/Git Bash), SSH
- **Platform Services** — notifications, Dock / Taskbar, credentials (Keychain / Credential Manager), global shortcuts, control CLI
- **Content & Git** — file browsing, edit preview, Git integration
- **Distribution** — signing, notarization, installers, auto-update

## Contributing

Issues and PRs welcome. Opening an issue first to align on direction is a good idea — interfaces shift often at this stage, and it saves wasted work.

Before opening a PR, please confirm `pnpm test`, `pnpm build`, and `cargo test` are all green.

## Disclaimer

Belfry is a hosting layer for terminals and sessions. It is not responsible for what an agent executes on your machine. An agent's privileges are your shell's privileges: give it the ability to read and write files, run builds, and install dependencies, and it has the ability to delete things it shouldn't. Use it in version-controlled directories and review consequential operations yourself.

Numbers in the usage panel come from logs the agents write locally. Treat them as an estimate, not a bill — your provider's console is authoritative.

## License

[LGPL-3.0](LICENSE). LGPL-3.0 is a set of additional permissions on top of GPL-3.0; the complete terms require reading [GPL-3.0](LICENSE.GPL-3.0) alongside it.

Bundled fonts carry their own licenses: [JetBrains Mono](public/fonts/LICENSE-JetBrains-Mono.txt) (SIL OFL 1.1) and [HarmonyOS Sans](public/fonts/LICENSE-HarmonyOS-Sans.txt).

## Links

- [LINUX DO](https://linux.do/) — developer community
