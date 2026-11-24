# App Volume Mixer

A per-application volume mixer for Stream Deck on Windows. Every app that plays audio gets its own key with its real icon and volume, plus key-based sliders to change it, without opening the Windows mixer.

## Keys

| Key | What it does |
| --- | --- |
| **App** | Shows the app's icon and volume. Press to mute or unmute it. |
| **Volume slider** | Place it below an App key, in the same column. With 2 keys: up / down (hold to keep going). With 3 or more keys: a bar where each key sets a volume level. |
| **Auto** | Opens the bundled **App Mixer Auto** profile, which fills itself with the apps that are playing audio. |
| **Back (profile)** | Returns to the profile you came from. |
| **Next page** / **Previous page** | Flip through the apps when there are more than fit on one page. |

### Auto profile

Designed for the 15-key Stream Deck. The left column holds Back and the page keys; each of the other 4 columns shows one app with its two slider keys. Apps appear when they start playing and disappear about 20 seconds after they stop.

### Settings

Select an **App** key to open its settings:

- **Automatic** mode: the key shows the next app in the list. **Fixed process**: it always shows the app you pick.
- **Processes**: hide apps you never want on the keys (e.g. System sounds), change their order, or show only the apps you tick.
- **Auto profile**: show only the apps playing audio (default) or all apps.

These settings are shared by all keys.

## Requirements

- Windows 10 or 11
- Stream Deck 7.1 or later

Nothing else to install, and no administrator rights needed.

## Notes

- Windows Defender or SmartScreen may warn about `AudioHelper.exe`, the small helper that talks to the Windows audio system, because it is not code-signed. Its source code is in [`helper/AudioHelper.cs`](helper/AudioHelper.cs).
- Some Microsoft Store apps may show a generic icon instead of their own.
