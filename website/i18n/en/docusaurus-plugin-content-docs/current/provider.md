---
sidebar_position: 21
title: Provider switching
description: Switching Codex / Claude Code routing between official endpoints and third-party relays
---

# Provider switching

Switch the routing of Codex / Claude Code between official endpoints and third-party relays.

## Key point: it edits the CLI's own config

**Provider switching modifies the CLI's own configuration file** — it is not an in-app proxy layer. This means:

- After switching inside Belfry, **running `claude` or `codex` directly, outside Belfry, works the same way**
- API keys are stored locally the way the CLI stores them

## Precise field rewriting

Switching touches **only the routing-related fields**:

- Routing keys like `ANTHROPIC_BASE_URL`
- The `[model_providers.belfry]` table

Your **hooks, MCP definitions, and project trust records are left byte-for-byte untouched**.

## No silent overwrites

On first open, Belfry takes the settings already in your config file and **turns them into a switchable entry you can go back to**. Switch back and forth as much as you like — nothing gets silently overwritten.

## Login state protection

Before switching to a third-party provider, Belfry **backs up Codex's ChatGPT login state** and restores it exactly when you switch back to the official endpoint. No re-login needed.

## Environment variable detection

If you've set `ANTHROPIC_*` or `OPENAI_*` environment variables, and they would **override the config file**, Belfry warns you — so you don't mistakenly think the config file is in effect when it's actually the environment variables.

:::tip Relationship with plugins
Optional plugins can call configured services through the host's model API. Plugin capabilities and permissions are a separate system — see [Plugins](./plugins.md).
:::
