---
sidebar_position: 10
title: Workspace
description: How projects, sessions, and splits are organized
---

# Workspace

## Projects

**A project is just a local directory.** Click the project selector at the top to open a directory, and sessions will live under it.

- Recently opened projects are remembered for next time
- **Different sessions can point at different directories** — each session carries its own project affiliation; it isn't a single global setting
- The sidebar groups sessions by project, with collapsible groups and a draggable width

## Sessions and splits

You can open as many sessions as you want under a project. **Drag a tab to split the view** and arrange the layout however you like.

Common combinations:

| Setup | Good for |
| --- | --- |
| Codex + Shell | Let an Agent modify code while you watch logs and run tests |
| Two Codex sessions | Dividing work between Agents — see [Session collaboration](./collab.md) |
| SSH + Shell | Working on a remote server while operating locally |
| Pure Shell | Using it as a regular terminal |

## Named workspaces

Once you have a split layout you like, save it as a **named workspace**. It preserves:

- Session grouping
- Split layout
- Active focus

When you reopen a named workspace, **background sessions restore their identity too** — no need to log in again or re-run `cd`.

## Quick Open

Press `⌘K` (`Ctrl+Shift+K` on Windows) to open Quick Open, where you can:

- Search for and switch to a session
- Open a recent project
- Run common workspace actions

It supports keyboard navigation, so you can jump around without leaving the keyboard.

## File preview pane

The file preview pane lets you browse the current project directory and open **read-only** code previews. Two handy behaviors:

- **File paths in terminal output are clickable** and open in the preview pane
- When a file changes on disk externally, the preview tells you it's stale

:::caution Read-only
The preview pane is read-only — you can't edit files in it. To change a file, use your editor, or let an Agent do it.
:::

## Collapse the sidebar

Press `⌘B` (`Ctrl+Shift+B` on Windows) to collapse the sidebar entirely and give all the space to the terminal.
