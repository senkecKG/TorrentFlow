# TorrentFlow Implementation Checklist

Design language: near-black bg (#0b0c0e), graphite panels, subtle borders, white primary text,
muted gray secondary, green for healthy/primary, red only for errors. Lucide icons. No gradients.

## Phase 1 — Working torrent core
- [ ] Tauri 2 + React + TS + Tailwind scaffold builds and runs
- [ ] Rust service layer wrapping librqbit (`engine` module, no engine types leaking)
- [ ] Add magnet link (metadata fetch state shown, not frozen UI)
- [ ] Add .torrent file (dialog + drag-drop)
- [ ] Pause / resume / remove (keep files) / remove + delete files
- [ ] Session persistence: torrents restore after app restart
- [ ] File selection before start; recheck on start
- [ ] Real progress, speeds, ETA, seeds/peers in list
- [ ] Verified with a legal torrent

## Phase 2 — Complete UI
- [ ] Custom titlebar (min/max/close, drag region), tray icon + menu
- [ ] Nav rail: All / Downloading / Completed / Settings
- [ ] Torrent table rows + status pills
- [ ] Details drawer: Overview, Files (selectable), Trackers, Activity
- [ ] Add-torrent modal (metadata, file picker checkboxes, disk space, duplicate detect)
- [ ] Settings page (limits, folder, VLC path, behavior toggles)
- [ ] Global stats header + bottom status bar
- [ ] Notifications (download complete, errors)

## Phase 3 — VLC streaming
- [ ] axum HTTP server on 127.0.0.1 only, Range support via librqbit FileStream
- [ ] Piece prioritization around playback position (engine streams do this natively)
- [ ] Buffer %, preparing/ready/buffering states, play-when-ready
- [ ] Multiple video picker (largest suggested), subtitle prioritization
- [ ] Copy stream URL
- [ ] VLC detection (registry x64/x32, PATH, manual path) + launch with args
- [ ] "VLC was not found." flow with Install VLC / Choose manually

## Phase 4 — Installer & QA
- [ ] NSIS installer: associations (.torrent, magnet), desktop shortcut, autostart options
- [ ] Optional VLC download+install step at install time (official VideoLAN source, consent first)
- [ ] Uninstall never deletes content
- [ ] Unicode filenames, long paths, restart-recovery tests
- [x] cargo fmt/clippy clean, tsc clean, production build succeeds

Out of scope: search, RSS, RSS auto-download, torrent creation, accounts, cloud, remote access, themes.
