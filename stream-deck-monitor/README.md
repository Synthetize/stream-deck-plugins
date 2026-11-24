# System Monitor

Live system stats on your Stream Deck keys. Each key shows a value and a small graph of its recent history, and changes color when it crosses the thresholds you set.

## Keys

| Key | What it does |
| --- | --- |
| **Metric** | Shows one metric of your choice (see below). |
| **Open Monitor Dashboard** | Opens the bundled **Monitor Dashboard** profile. |
| **Back (profile)** | Returns to the profile you came from. |

### Available metrics

- **CPU**: usage, temperature
- **RAM**: usage and used / total GB
- **GPU**: usage, memory (VRAM), temperature
- **Games**: FPS and frame time
- **Disk**: busy %, read, write and total speed
- **Network**: download, upload, ping and packet loss (to a host you choose, default `1.1.1.1`)

### Monitor Dashboard profile

Designed for the 15-key Stream Deck:

```
CPU       RAM        GPU         VRAM   FPS
CPU temp  GPU temp   Frame time  Ping   Packet loss
Back      (free)     (free)      (free) (free)
```

### Settings

Select a **Metric** key to choose the metric, refresh rate, graph style, units (°C / °F, bytes / bits), the warning and critical thresholds, and the colors.

## Requirements

- Windows 10 or 11
- Stream Deck 7.1 or later

Most metrics work out of the box. Two need something extra:

| Metric | What you need |
| --- | --- |
| **FPS and frame time** | [RivaTuner Statistics Server (RTSS)](https://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/) running while you play. It comes with MSI Afterburner, or you can install it on its own. |
| **CPU temperature** | The **PawnIO** driver and a one-time administrator approval (see below). |

### Enabling CPU temperature

1. Install the PawnIO driver once. Open a terminal and run:
   ```
   winget install namazso.PawnIO
   ```
   Or download it from [pawnio.eu](https://pawnio.eu).
2. Select any Metric key, open **Status** in its settings and press **Enable CPU temperature**.
3. Approve the Windows administrator prompt (UAC).

That's the only prompt you'll see. The plugin installs a small helper in `C:\Program Files\StreamDeckMonitor` and a scheduled task that reads the sensors. **Remove** in the same panel uninstalls both.

After updating the plugin, press **Reinstall / update admin helper** once.

Without this setup the CPU temperature key shows `N/A`, and everything else keeps working. GPU temperature doesn't need it.

## License

This plugin includes [LibreHardwareMonitorLib](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) (MPL-2.0) and other third-party libraries. See [`LICENSE-THIRD-PARTY.txt`](LICENSE-THIRD-PARTY.txt).
