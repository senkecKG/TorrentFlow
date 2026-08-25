<div align="center">

<img src="docs/assets/logo.svg" width="72" alt="TorrentFlow logo" />

# TorrentFlow

**A fast, lightweight torrent client for Windows. Stream while you download.**

[![Release](https://img.shields.io/gitlab/v/release/senkec21/TorrentFlow?gitlab_url=https%3A%2F%2Fgitlab.com&style=flat-square&color=22c55e)](https://gitlab.com/senkec21/TorrentFlow/-/releases/permalink/latest)
[![Pipeline](https://gitlab.com/senkec21/TorrentFlow/badges/main/pipeline.svg?style=flat-square)](https://gitlab.com/senkec21/TorrentFlow/-/commits/main)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4?style=flat-square)](https://gitlab.com/senkec21/TorrentFlow/-/releases/permalink/latest)
[![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)

[Download](https://gitlab.com/senkec21/TorrentFlow/-/releases/permalink/latest) · [Website](https://senkec21.gitlab.io/torrentflow) · [Report a bug](https://gitlab.com/senkec21/TorrentFlow/-/issues)

<img src="docs/assets/app.png" width="820" alt="TorrentFlow main window with live torrent progress" />

</div>

---

## Why TorrentFlow

Most torrent clients are either ancient (uTorrent, 2005 UX) or bloated (Electron shells eating 500 MB of RAM). TorrentFlow is neither: a **native 19 MB binary** with a modern interface, built for one job — getting files onto your disk fast, and letting you watch them even faster.

| | |
|---|---|
| 🎬 **Stream while downloading** | Watch video torrents in VLC the moment enough pieces arrive. Sequential fetching, subtitles prioritized. |
| 👁️ **Preview before you commit** | Paste a magnet, see the real name, file list and exact size before anything downloads. |
| 🛡️ **Duplicate guard** | Torrents are keyed by info-hash. The same content can never be added twice. |
| 🎛️ **File-level control** | Select exactly which files to download, per torrent, any time. |
| ⚡ **DHT native** | Trackerless magnets work out of the box — hundreds of nodes within seconds. |
| 📂 **One-click reveal** | Jump to any download in Explorer from the details panel. |
| 🌙 **Designed dark** | Custom title bar, tabular numbers, a UI built for long sessions. |

## Install

Grab the installer from [**Releases**](https://gitlab.com/senkec21/TorrentFlow/-/releases/permalink/latest):

```
TorrentFlow_x.y.z_x64-setup.exe   (~5 MB, NSIS)
```

Windows 10/11, x64.

## Build from source

**Requirements:** Node.js 20+, Rust stable, npm.

```sh
git clone https://gitlab.com/senkec21/TorrentFlow
cd TorrentFlow
npm install
npm run tauri dev      # development with hot reload
npm run tauri build    # production installer
```

## Architecture

```mermaid
flowchart LR
    subgraph Frontend ["Frontend · React 19 + Tailwind 4"]
        UI[App shell, torrent list, details drawer]
    end
    subgraph Backend ["Backend · Rust, Tauri 2"]
        CMD[Command handlers]
        ENG[Engine]
    end
    subgraph Core ["Torrent core · librqbit"]
        DHT[DHT]
        BT[BitTorrent peer wire]
    end
    UI <-->|Tauri IPC| CMD --> ENG --> BT
    ENG --> DHT
```

<details>
<summary><strong>Project layout</strong></summary>

```
src/                  React frontend
  components/         UI components (list, drawer, modals)
  lib/api.ts          typed Tauri IPC bridge
  lib/types.ts        shared DTO types
src-tauri/
  src/engine/         librqbit session wrapper + DTO mapping
  src/commands.rs     IPC command surface
  src/lib.rs          Tauri setup, plugins
docs/                 Landing page (published via GitLab Pages)
```

</details>

## Roadmap

- [ ] Torrent list persistence across restarts
- [ ] RSS feeds with auto-download rules
- [ ] Sequential download toggle in the UI
- [ ] Speed limits and scheduling
- [ ] Portable (no-install) build

## Contributing

Issues and merge requests welcome. Keep MRs small and focused; run `npm run build` (typecheck + bundle) before submitting.

## License

[MIT](LICENSE) — use it, fork it, ship it.

<div align="center">
<sub>Built with Tauri 2 · librqbit · React 19 · Vite 7</sub>
</div>
