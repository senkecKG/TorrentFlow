# TorrentFlow

A fast, lightweight torrent client for Windows. Built with Tauri 2, React 19 and librqbit.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Release](https://img.shields.io/github/v/release/seNkoKG/TorrentFlow)
![License](https://img.shields.io/badge/license-MIT-green)

## Why TorrentFlow

- **Small and fast.** Native binary, no Electron. Starts in under a second.
- **Preview before you download.** See the name, file list and total size of any magnet or .torrent before adding it.
- **Duplicate detection.** Adding the same torrent twice is caught by info-hash.
- **Live progress.** Per-torrent progress bars with download/upload speeds and peer counts.
- **Clean UI.** Custom title bar, dark interface, keyboard friendly.

## Download

Grab the latest installer from [Releases](https://github.com/seNkoKG/TorrentFlow/releases/latest):

- `TorrentFlow_x.y.z_x64-setup.exe` — Windows installer (NSIS)

## Build from source

Requirements: Node.js 20+, Rust (stable), npm.

```sh
npm install
npm run tauri dev     # development
npm run tauri build   # production bundle
```

## Tech stack

| Layer    | Choice                          |
| -------- | ------------------------------- |
| Shell    | Tauri 2 (Rust)                  |
| Engine   | librqbit                        |
| Frontend | React 19, TypeScript, Tailwind 4 |
| Build    | Vite 7                          |

## License

MIT
