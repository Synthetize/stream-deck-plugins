# Stream Deck Plugins

A collection of open-source plugins for the [Elgato Stream Deck](https://www.elgato.com/stream-deck) on Windows.

Each plugin lives in its own folder, with its own source code, build scripts and documentation. All of them are built with the official [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started) (Node.js / TypeScript), plus a small native C# helper where Windows APIs are needed.

## Plugins

| Plugin | Description | Docs |
| --- | --- | --- |
| **App Volume Mixer** | Per-application volume mixer with automatic app icons, key-based volume sliders, an auto-filling profile and hideable processes. | [README](app-volume-mixer/README.md) |
| **System Monitor** | Live CPU, RAM, GPU, VRAM, disk, network, ping, temperatures and in-game FPS (RTSS), each with a sparkline graph. | [README](stream-deck-monitor/README.md) |

## Installation

1. Open the [**Releases**](../../releases) page and find the latest release of the plugin you want.
2. Download its `.streamDeckPlugin` file.
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

Each plugin is versioned and released independently by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)). Pushing a tag in the form `<plugin-folder>/v<version>` builds only that plugin and publishes it as a new release:

```powershell
git tag app-volume-mixer/v3.2.0
git push origin app-volume-mixer/v3.2.0
```

Bump `Version` in the plugin's `manifest.json` first (e.g. `3.2.0.0`), and `PLUGIN_VERSION` in its `tools/make-profile.mjs` to the same value: the workflow fails if the tag and the manifest don't match, since Stream Deck refuses to update an installed plugin with the same version.

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
