---
sidebar_position: 2
title: Installation
description: Downloading Belfry and trusting it on first launch
---

# Installation

## Download

Installers are published on the [GitHub Releases](https://github.com/ChengSoon/belfry-desktop/releases) page, for three build targets:

| Platform | Artifact |
| --- | --- |
| macOS Apple Silicon | `aarch64` installer |
| macOS Intel | `x64` installer |
| Windows | installer |

## How to verify SHA256

Download `SHA256SUMS.txt` and your installer from the **same release**. Open a terminal in your download directory and replace the example filename below with the name of the file you downloaded.

On Windows, run this in Command Prompt or PowerShell:

```powershell
certutil -hashfile "Belfry_VERSION_x64-setup.exe" SHA256
```

On macOS, run this in Terminal (the Intel installer uses `x64` in its filename):

```sh
shasum -a 256 "Belfry_VERSION_aarch64.dmg"
```

Compare the 64 hexadecimal digits with the entry for the **same filename** in `SHA256SUMS.txt`, ignoring letter case and spaces used for display. The values must match exactly. If they differ, download the installer again and repeat the check. The manifest also covers updater packages and update metadata; you only need to check the installer you downloaded.

## System requirements

- **macOS** 14 or later
- **Windows** 10 22H2 (Build 19045) or Windows 11

## First launch

The macOS and Windows installers are currently **not code-signed or notarized**, so the operating system will block them once. This is expected — just trust them as described below.

### macOS

The installer is ad-hoc signed but not notarized by Apple. If Gatekeeper blocks it on first launch, either:

- **Right-click** the app in Finder and choose "Open"
- Or go to "System Settings → Privacy & Security" and click "Open Anyway" at the bottom

### Windows

SmartScreen will report "Unknown publisher": click "**More info**" → "**Run anyway**".

## Automatic updates

Belfry ships with an auto-updater. When a new version is released, the app will prompt you, then download, install, and restart on confirmation. You can also check the current version and update status on the "About" settings page.

:::tip Prefer manual control?
If you'd rather not use auto-updates, you can always download a new version manually from [Releases](https://github.com/ChengSoon/belfry-desktop/releases) and install it over the top. Your configuration and session history are preserved.
:::
