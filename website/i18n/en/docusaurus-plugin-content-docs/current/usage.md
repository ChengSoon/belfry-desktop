---
sidebar_position: 40
title: Usage stats
description: Aggregating CLI session logs locally to see where tokens went
---

# Usage stats

Press `⌘U` (`Ctrl+Shift+U` on Windows) to open the usage panel and see which model and which project your tokens went to.

## Where the data comes from

Belfry **reads and aggregates the local Codex / Claude session logs directly, without making any network requests.** The data never leaves your machine.

## Four token categories

Belfry normalizes tokens into four categories, so that different CLIs computing things differently doesn't muddy the numbers:

| Category | Meaning |
| --- | --- |
| `input` | Input tokens (**excluding cache hits**) |
| `cachedInput` | The portion that hit the context cache |
| `cacheWrite` | Writes to the context cache |
| `output` | Output tokens |

`input` and `cachedInput` are separated because cache hits are usually billed at a much lower rate — merging them would overstate your real spend.

## Two breakdown dimensions

- **By model** — see which model costs the most
- **By project** — see which project costs the most

Time windows: **last 7 days / last 30 days / all time**.

## Quotas and plans

If the logs carry quota window and plan information, the panel shows it too. **Note: currently only Codex's logs carry these fields — Claude's do not**, so you won't see quota information for Claude sessions.

:::caution For reference only
The usage panel's numbers come from the local logs written by the Agents themselves, so **treat them as a reference, not a bill**. Always go by your provider's console.
:::
