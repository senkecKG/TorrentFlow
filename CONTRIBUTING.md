# Contributing to TorrentFlow

Thanks for helping out.

## Setup

```sh
git clone https://github.com/seNkoKG/TorrentFlow
cd TorrentFlow
npm install
npm run tauri dev
```

Requires Node.js 20+, Rust stable, npm.

## Ground rules

- Keep PRs small and focused. One feature or fix per PR.
- Run `npm run build` before submitting. It typechecks and bundles the frontend.
- Match existing code style. The backend lives in `src-tauri/src/engine/`; frontend components in `src/components/`.
- No new dependencies without a strong reason. Fewer moving parts wins.

## Reporting bugs

Open a [bug report](https://github.com/seNkoKG/TorrentFlow/issues/new?template=bug_report.yml) with reproduction steps and your TorrentFlow version.
