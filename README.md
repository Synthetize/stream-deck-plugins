# Stream Deck Plugins

A collection of open-source plugins for the [Elgato Stream Deck](https://www.elgato.com/stream-deck) on Windows.

Each plugin lives in its own folder, with its own source code, build scripts and documentation. All of them are built with the official [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started) (Node.js / TypeScript), plus a small native C# helper where Windows APIs are needed.

## Plugins

| Plugin | Description | Docs |
| --- | --- | --- |
| **App Volume Mixer** | Per-application volume mixer with automatic app icons, key-based volume sliders, an auto-filling profile and hideable processes. | [README](app-volume-mixer/README.md) |
| **System Monitor** | Live CPU, RAM, GPU, VRAM, disk, network, ping, temperatures and in-game FPS (RTSS), each with a sparkline graph. | [README](stream-deck-monitor/README.md) |

## Installation

1. Open the [**Releases**](../../releases/latest) page.
2. Download the `.streamDeckPlugin` file of the plugin you want.
3. Double-click it: Stream Deck installs the plugin and its bundled profile.

Requirements: Windows 10/11 and Stream Deck 7.1 or later. Check each plugin's README for any extra requirements.

## Building from source

You need [Node.js](https://nodejs.org/) 22 or later. The C# helpers are compiled with the .NET Framework compiler that ships with Windows, so no .NET SDK is required.

```powershell
cd <plugin-folder>
npm install
npm run build   # native helper, profile and plugin
npm run pack    # creates dist\<plugin>.streamDeckPlugin
```

See each plugin's README for development details (`npm run link`, `npm run watch`, validation).

## Releases

Releases are built automatically by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)). Pushing a tag that starts with `v` builds every plugin and attaches the packages to a new release:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

Remember to bump `Version` in the plugin's `manifest.json` before tagging, otherwise Stream Deck refuses to update an installed plugin.

## Repository layout

```
stream-deck-plugins/
├─ .github/workflows/   release automation
├─ <plugin-folder>/     one folder per plugin (source, helper, tools, README)
├─ LICENSE
└─ README.md
```

## License

[MIT](LICENSE). Some plugins bundle third-party libraries under their own licenses: see the `LICENSE-THIRD-PARTY.txt` file inside the plugin folder, where present.
