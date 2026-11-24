# App Volume Mixer – Stream Deck plugin for Windows

A Windows volume mixer **per application**, as an alternative to Elgato's official "Volume Controller", with extras:

- **automatic icons**: every key shows the icon extracted from the process executable (e.g. `spotify.exe`) and the volume percentage; pressing it mutes the app (the key then says MUTE);
- a vertical **volume slider** made of keys, below each app;
- an **Auto profile** that shows every app that is playing audio, with pages;
- **hideable processes**: a persistent blacklist (or whitelist) configured from a checkbox list in the Property Inspector;
- custom **ordering** of the processes (↑ ↓ arrows).

## Architecture (and why)

```
Stream Deck ──WebSocket──▶ bin/plugin.js (Node/TypeScript, official @elgato/streamdeck SDK v3)
                               │  stdin/stdout, one JSON line per command
                               ▼
                         bin/AudioHelper.exe (C#, Windows Core Audio via COM)
```

- **Node/TypeScript plugin using the official SDK** `@elgato/streamdeck` and the `streamdeck` CLI (link, validate, pack): this is the path supported by Elgato, and Node is bundled with Stream Deck (no runtime for the end user to install).
- **Native C# helper** for the Core Audio APIs (`IMMDeviceEnumerator` → `IAudioSessionManager2` → `IAudioSessionControl2` / `ISimpleAudioVolume`) and icon extraction (`PrivateExtractIcons` at 128 px → base64 PNG).
  It is built with the C# compiler of the **.NET Framework 4.x that already ships with Windows 10/11** (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`):
  no .NET SDK, no extra runtime, no native Node addons to rebuild for every Node version (as would happen with modules like `node-audio-volume-mixer`). The executable is about 14 KB.
- The helper keeps running and answers text commands (`list`, `icon <name>`, `set <name> <0-100>`, `mute <name> <0|1>`); if it exits it is restarted automatically.
- Sessions are **grouped by executable** (Chrome, Discord, etc. open several sessions/processes): volume and mute apply to all of them. All active playback devices are considered.
- The process settings (hidden, order, filter) are **global plugin settings**, stored by Stream Deck and shared by all keys/profiles.

## Requirements

- Windows 10/11, Stream Deck **7.1 or later** (tested with 7.6).
- Only to build: **Node.js 24 LTS** (or 22+) with npm. Recommended install:
  ```bash
  winget install OpenJS.NodeJS.LTS
  ```

## Build

In the project folder:

```bash
npm install
```

```bash
npm run build
```

`npm run build` runs:
1. `helper\build-helper.cmd` → builds `dev.appmixer.volume.sdPlugin\bin\AudioHelper.exe`;
2. `tools/make-profile.mjs` → generates the bundled Auto profile `App Mixer Auto.streamDeckProfile`;
3. `rollup -c` → compiles the TypeScript into `dev.appmixer.volume.sdPlugin\bin\plugin.js`.

The static icons are already included; to regenerate them: `powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1`.

> On Windows PowerShell, `npm` may be blocked by the script execution policy. Use `npm.cmd` / `npx.cmd` instead, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

## Installation

### Option A – development (`streamdeck link`)

Links the plugin folder to Stream Deck (creates a link in `%APPDATA%\Elgato\StreamDeck\Plugins`):

```bash
npx streamdeck link dev.appmixer.volume.sdPlugin
```

```bash
npx streamdeck restart dev.appmixer.volume
```

While developing, `npm run watch` rebuilds and restarts the plugin on every change. The link points to this folder: do not move or delete it while the plugin is linked (`npx streamdeck unlink dev.appmixer.volume` removes it).

### Option B – installable package (`.streamDeckPlugin`)

```bash
npm run pack
```

Creates `dist\dev.appmixer.volume.streamDeckPlugin`: double-click the file and Stream Deck installs the plugin (it copies it, so the project folder is no longer needed).

If you already installed the plugin with `link`, remove the link first to avoid conflicts. When updating an installed plugin, increase `Version` in `manifest.json` first, otherwise Stream Deck says it already exists.

## Usage

The **App Volume Mixer** category appears in the Stream Deck action list with these actions:

| Action | What it does |
| --- | --- |
| **App** | Shows the app icon and the volume percentage. Press = mute: **MUTE** is shown instead of the percentage (press again to unmute). |
| **Volume slider** | A vertical bar made of keys stacked below each other, in the column of an App key; it fills up according to the volume. **With 2 keys**: the upper one raises the volume, the lower one lowers it (step configurable in the panel, holding keeps going). **With 3 or more keys**: press a segment to set the volume to that level (4 keys = 25/50/75/100%). |
| **Auto** | Switches to the **App Mixer Auto** profile (see below). |
| **Back (profile)**, **Next page**, **Previous page** | Used in the Auto profile: go back to the previous profile and flip pages. You can also use them in your own profiles. |

Volume sliders act on the app of the **nearest App key above them in the same column**. Without an App key above they do nothing (the key flashes an alert).

### Auto profile (every app that is playing)

The plugin ships with the **App Mixer Auto** profile for the 15-key Stream Deck. Drag the **Auto** key onto one of your profiles and press it: Stream Deck switches to the Auto profile, which picks the apps by itself (by default **the ones that are playing audio**, or all of them: see below) and puts them on the keys:

- **left column**: *Back* (returns to the previous profile), *Next page* (only appears when there are more than 4 apps), *Previous page* (only appears when you are not on the first page);
- **other 4 columns**: one per app, with the App key (icon, percentage, mute) and the two Volume slider keys below it.

The list refreshes by itself every second: an app appears when it starts playing audio and stays for another 20 seconds after it stopped (so it does not vanish at every pause). Apps already on the keys do not change position when new ones arrive. The hidden processes and the order set in the panel are honoured. In the panel (*Processes* section, **Auto profile** entry) you choose whether the Auto profile shows **only the apps that are playing audio** (default) or **all detected apps**, which then stay on the keys even when silent. The profile is installed together with the plugin (Stream Deck asks for confirmation); the file is `App Mixer Auto.streamDeckProfile` and is regenerated with `npm run build:profile`.

### Typical setup

1. Drag the **App** action onto several keys (e.g. a whole row). In *Automatic* mode every key picks the next position by itself (row by row, left to right): the first key shows the 1st app, the second the 2nd, and so on.
2. Below each App key put two **Volume slider** keys (same column).
3. Select an **App** key and, in the Property Inspector:
   - **This key** section: mode: *Automatic* (the key shows the app according to its position, no other settings) or *Fixed process* (always the same app of your choice);
   - **Processes** section: the list of all detected audio processes with their icon. Tick **Hide** to remove them from the keys (e.g. *System sounds*, *Steam*), use ↑ ↓ for the order. With the filter **Show only the checked processes** the list becomes a whitelist. The option *Only show apps that are playing audio* hides inactive sessions.

   These settings apply to all keys and are kept (also for processes that are no longer running, which stay in the list as "not running").

To always have the same app on a key (even if it is hidden from the automatic list) use the **Fixed process** mode: when the app is not running the key shows it greyed out as "inactive".

Raising the volume of a muted app unmutes it (like the Windows mixer).

## Testing

1. **The helper alone** (after `npm run build`):
   ```bash
   dev.appmixer.volume.sdPlugin\bin\AudioHelper.exe list
   ```
   Prints the JSON of the audio sessions (name, label, PID, volume, muted, active, path). Other commands: `AudioHelper.exe icon spotify`, `AudioHelper.exe set spotify 50`, `AudioHelper.exe mute spotify 1`.
2. **Manifest/structure validation**:
   ```bash
   npm run validate
   ```
3. **On Stream Deck**: start an app that plays audio (a browser with a video, Spotify…), link the plugin (Option A) and drag 3–4 **App** keys: icon and volume should appear; press to mute and check in the Windows volume mixer (`sndvol`). Hide a process from the Property Inspector: the keys realign immediately.
4. **Logs**: `dev.appmixer.volume.sdPlugin\logs\` (plugin log) and `%APPDATA%\Elgato\StreamDeck\logs\`. To debug the Property Inspector: `npx streamdeck dev`, then open `http://localhost:23654/`.

## Project structure

```
app-volume-mixer/
├─ helper/
│  ├─ AudioHelper.cs          Core Audio helper + icon extraction (C# 5, .NET Framework 4)
│  └─ build-helper.cmd        builds with the csc.exe that ships with Windows
├─ src/
│  ├─ plugin.ts               entry point: registers the actions and starts polling
│  ├─ audio-helper.ts         client of the AudioHelper.exe process
│  ├─ mixer.ts                shared state: sessions, icons, filters, Auto list, volume/mute
│  ├─ layout.ts               automatic key positions, app above/below in a column, Auto pages
│  ├─ render.ts               SVG key images (icon + volume, slider, navigation)
│  ├─ inspector.ts            sends the process list to the Property Inspector
│  └─ actions/                "App", "Volume slider", "Auto" and navigation actions
├─ dev.appmixer.volume.sdPlugin/
│  ├─ manifest.json
│  ├─ App Mixer Auto.streamDeckProfile   bundled Auto profile (generated)
│  ├─ ui/inspector.html       Property Inspector (plain HTML/JS, no dependencies)
│  ├─ imgs/                   action/category/plugin icons
│  └─ bin/                    build output (plugin.js, AudioHelper.exe)
├─ tools/make-icons.ps1       regenerates the icons
├─ tools/make-profile.mjs     generates the Auto profile (.streamDeckProfile)
├─ package.json, tsconfig.json, rollup.config.mjs
```

## Notes and limits

- The volume is read every second: changes made from the Windows mixer show up on the keys within ~1 s.
- UWP/Store apps may show the host icon instead of the app icon.
- A process is identified by its executable name (e.g. `brave`): hiding `brave` hides all of its sessions.
- If Windows Defender/SmartScreen flags `AudioHelper.exe`, it is because it is a freshly built, unsigned executable; the full source is in `helper/AudioHelper.cs`.
