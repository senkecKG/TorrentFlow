# Security Policy

## Reporting a vulnerability

Do not open a public issue for security vulnerabilities.

Use GitHub's [private vulnerability reporting](https://github.com/senkecKG/TorrentFlow/security/advisories/new) instead. Include reproduction steps and affected versions.

You will get a response within a few days.

## Scope

- `src-tauri/` — Rust backend, IPC surface, torrent engine
- `src/` — frontend
- The NSIS installer produced by `npm run tauri build`

## Known boundaries

TorrentFlow talks to arbitrary peers over BitTorrent and DHT by design. Reports about receiving malicious metadata from hostile peers are valid; reports about "torrents can contain malware" are not — that is the nature of the protocol.
