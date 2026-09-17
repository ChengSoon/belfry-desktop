---
sidebar_position: 60
title: Troubleshooting
description: Common problems and how to fix them
---

# Troubleshooting

## An Agent isn't detected

Agents appear grayed out in the new session menu, and hovering shows the reason. Match it up:

| Reason | Fix |
| --- | --- |
| Not installed | Install it following that CLI's official docs |
| Not on PATH | Confirm `codex --version` / `claude --version` runs in a **normal system terminal** |
| Version too old | Upgrade — or use the one-click upgrade on the "About" settings page |

If you installed a **third-party mirror package** (such as `@cometix/claude-code`), the About page shows the official version, but upgrades only target the package you actually installed — nothing gets swapped.

## macOS: app won't open / "damaged"

The installer is ad-hoc signed and not notarized by Apple. See [Installation](./install.md#macos):

- **Right-click** the app in Finder → "Open"
- Or "System Settings → Privacy & Security" → "Open Anyway"

## Windows: "Unknown publisher"

SmartScreen is blocking it. Click "**More info**" → "**Run anyway**". See [Installation](./install.md#windows).

## Wrong terminal colors (black input box on Windows)

This comes from a TUI like Codex timing out while querying terminal colors via **OSC 10/11**. Belfry already answers these directly in Rust to work around it. If you still hit it, it's usually a ConPTY palette read issue — **try switching themes** (light/dark), since the theme color is fed into the terminal palette.

## Usage numbers don't match your bill

The usage panel is **derived from the local logs written by the Agents themselves — a reference, not a bill**. Common reasons for differences:

- Cache hits are billed at different rates (`input` and `cachedInput` are counted separately)
- Plan discounts and free credits aren't included
- **Always go by your provider's console**

## Collaboration dispatch fails

Collaboration depends on the Belfry skill, CLI login state, and collaboration channels. Run the **environment diagnostics** on the settings page to check:

- Whether the Belfry skill is present and up to date
- Codex / Claude login and feature status
- doctor results and collaboration channel connectivity

Diagnostics **preserve partial successes** — one client failing doesn't hide another's success. Fix the reported items one at a time.

## Clearing a saved SSH password

Saved passwords (kept in the system keychain) can be **cleared at any time from the SSH form**. Open the SSH session settings to do it.

## Still stuck

Open an issue on [GitHub Issues](https://github.com/ChengSoon/belfry-desktop/issues) and include:

- Your OS and version
- The Belfry version (visible on the "About" settings page)
- Reproduction steps
- What you saw, and what you expected

## Disclaimer {#disclaimer}

Belfry is a hosting layer for terminals and sessions. **It is not responsible for the commands an Agent executes on your machine.** The Agent's permissions are your shell's permissions: if you give it read/write access to files, the ability to run builds and install dependencies, it also has the ability to delete things it shouldn't. **Use it inside version-controlled directories**, and keep an eye on important operations.

The usage panel's numbers come from the local logs written by the Agents themselves. Treat them as a reference, not a bill. Always go by your provider's console.
