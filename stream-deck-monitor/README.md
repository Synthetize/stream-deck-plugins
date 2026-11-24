# System Monitor for Stream Deck

Live system metrics on your Stream Deck keys, each with a value and a sparkline graph:

| Metric | Source | Needs |
| --- | --- | --- |
| CPU usage | Windows performance counter (`% Processor Time`, same as RTSS / Resource Monitor) | nothing |
| RAM usage (+ used / total GB) | `GlobalMemoryStatusEx` | nothing |
| GPU usage | Windows `GPU Engine` counters (busiest engine, like Task Manager; AMD / NVIDIA / Intel) | nothing |
| GPU memory (VRAM) | Windows `GPU Adapter Memory` counters | nothing |
| GPU temperature | LibreHardwareMonitorLib (AMD ADL / NVIDIA NVAPI) | nothing (no admin) |
| FPS and frame time | RTSS shared memory (`RTSSSharedMemoryV2`) | RivaTuner Statistics Server running |
| CPU temperature | LibreHardwareMonitorLib + PawnIO driver | **one-time admin setup** (see below) |
| Disk busy %, read, write, total | Windows `PhysicalDisk` counters | nothing |
| Ping and packet loss (last 60 pings) | ICMP ping to a host you choose (default 1.1.1.1), once per second, only while a ping key is visible | nothing |
| Network download / upload | IP helper statistics of the physical adapters that are up | nothing |

Everything except the CPU temperature works as a normal user. Without the setup the CPU temperature key shows `N/A`.

## Install

1. `dist\dev.sdmonitor.streamDeckPlugin` – double-click it (or run `npm run link` while developing).
2. Drag the **Metric** action onto a key and pick the metric in its settings, **or** use the bundled
   profile **Monitor Dashboard** (15-key Stream Deck, installed automatically with the plugin; open it with the
   **Open Monitor Dashboard** action, the **Back** key returns to the previous profile).
3. (Optional) CPU temperature: open the settings of any Metric key → **Status** → **Enable CPU temperature**.

Dashboard layout:

```
CPU       RAM        GPU        VRAM       FPS
CPU temp  GPU temp   Frame time Ping       Packet loss
Back      (free)     (free)     (free)     (free)
```

## Settings of a Metric key

Metric, refresh rate (0.5 / 1 / 2 / 5 s), graph style (filled line / line / bars / none), label on/off,
temperature unit (°C / °F), throughput unit (bytes or bits), warning and critical thresholds (color changes when
a value reaches them; for FPS when it falls *below* them; throughput thresholds are in MB/s) and the three colors.

## CPU temperature: what is really needed

I investigated whether LibreHardwareMonitor can simply be bundled so that nothing has to be installed:

* **The library can be bundled.** `LibreHardwareMonitorLib` 0.9.6 (MPL-2.0) is downloaded by `npm run fetch:lhm`
  (automatically on the first build) together with its managed dependencies and shipped in the plugin's `bin` folder.
  GPU temperatures (AMD ADL, NVIDIA NVAPI) are read through it **without admin and without any driver**.
  Verified on this PC (Radeon RX 9070 XT): GPU core 50 °C, hot spot, memory.
* **CPU sensors need a kernel driver.** Older versions used the WinRing0 driver bundled inside the DLL; it was
  removed because Windows Defender flags it as vulnerable. Since 0.9.5 LibreHardwareMonitor uses the signed
  **PawnIO** driver, which is a *separate installation* and cannot be embedded in a plugin (installing a kernel driver
  needs its own installer and admin rights). Install it once: `winget install namazso.PawnIO`
  (it is already present on the PC this was developed on).
* **Administrator rights are needed** to talk to the driver. The Stream Deck plugin process runs as a normal user, so
  the plugin cannot read the CPU sensors itself. Solution used here:
  1. Press **Enable CPU temperature** → one UAC prompt → `SensorHelper.exe --install-task` copies the helper to
     `C:\Program Files\StreamDeckMonitor` (only administrators can write there, so the elevated task can't be hijacked)
     and registers the scheduled task `StreamDeckMonitorSensors` (run with highest privileges, no trigger).
  2. From then on the plugin starts that task **without any prompt** whenever it needs data. The elevated process
     writes `%LOCALAPPDATA%\StreamDeckMonitor\temps.json` once per second and exits by itself ~45 s after the
     plugin stops asking.
  3. **Remove** deletes the task and the Program Files copy.
* **Graceful degradation:** no setup / no PawnIO / unsupported CPU / missing library → the key shows `N/A` with the
  reason (`setup needed`, `no PawnIO`, `unsupported`, …); everything else keeps working.
* **Limits.** After a plugin update press *Reinstall / update admin helper* so the Program Files copy is refreshed.
  Very new CPUs may only be supported by newer LibreHardwareMonitor releases (change the version with
  `node tools/fetch-lhm.mjs <version>`). The elevated path (CPU temperature on this Ryzen 7 9700X) could not be
  tested automatically because it needs a UAC prompt; the library does see the CPU and its Tctl/Tdie sensor
  without elevation (value 0, as expected).

## FPS (RTSS)

`SensorHelper.exe` opens the `RTSSSharedMemoryV2` mapping read-only and picks the application that rendered the
most recent frame (stale entries older than 2.5 s are ignored). The key shows the FPS and the process name; with RTSS
running but no game it shows `—  no game`, without RTSS `N/A  RTSS not running`. No PresentMon needed. RTSS must hook
the game (it does for most DirectX / Vulkan games).

## Build

Requirements: Node.js 20+ (24 recommended), Windows 10/11 (the C# compiler of the built-in .NET Framework 4 is used).

```
npm.cmd install
npm.cmd run build      # helper (C#), profile, plugin
npm.cmd run validate
npm.cmd run pack       # -> dist\dev.sdmonitor.streamDeckPlugin
```

Use `npm.cmd` / `npx.cmd` in PowerShell (execution policy blocks `npm.ps1`). Bump `Version` in
`dev.sdmonitor.sdPlugin\manifest.json` (and `PLUGIN_VERSION` in `tools\make-profile.mjs`) for every update, otherwise
Stream Deck refuses to update the installed plugin.

Helper diagnostics (from `dev.sdmonitor.sdPlugin\bin`): `SensorHelper.exe --once` prints one sample;
`SensorHelper.exe --dump-sensors` lists every sensor LibreHardwareMonitor sees.

## Project layout

* `helper/SensorHelper.cs` – C# 5 helper: counters, RTSS, LibreHardwareMonitor, sensor server, task setup
* `src/` – plugin (TypeScript, `@elgato/streamdeck` v3): `helper.ts` client, `metrics.ts`, `render.ts` (SVG), `actions/`
* `dev.sdmonitor.sdPlugin/` – manifest, Property Inspector (`ui/inspector.html`), icons, profile
* `tools/` – `fetch-lhm.mjs`, `make-profile.mjs` (Stream Deck 7 "3.0" profile format), `make-icons.ps1`

## Licenses

Plugin code: MIT. LibreHardwareMonitorLib: MPL-2.0 (unmodified, source at
https://github.com/LibreHardwareMonitor/LibreHardwareMonitor). See `LICENSE-THIRD-PARTY.txt`.
