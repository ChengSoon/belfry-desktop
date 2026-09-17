---
sidebar_position: 41
title: Plugins
description: Extending Belfry with .piplug packages
---

# Plugins

Belfry supports optional plugins, with capability boundaries declared by each plugin itself.

## Three ways to install

From **Settings**:

- Install a `.piplug` package
- Load a local development directory (point at source during development)
- Pick one from the **plugin marketplace**

## What plugins can provide

A plugin can offer:

- **Panels**
- **Commands**
- **Agent tools**
- **Skills**
- **Settings**
- **Themes**

:::info Executable plugins need Node.js
Executable plugins require **Node.js 20 or newer** on your machine. Plugins that only provide static assets (themes, styles) do not.
:::

## Development and distribution

Belfry provides plugin authors with:

- **Template scaffolding** — quickly generate a plugin skeleton
- **Validation** — check the manifest and permissions before packaging
- **Packaging** — produce a distributable `.piplug`
- **A local "My Marketplace"** — publish finished plugins to your own local marketplace
- Or use a **standalone online catalog**

## Going deeper

For plugin capabilities, permission boundaries, and setting up your own marketplace, see `docs/plugins/pi-runtime-guide.md` and `docs/plugins/own-market-guide.md` in the repository (distributed with the source).
