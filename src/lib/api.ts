import { invoke } from "@tauri-apps/api/core";
import type { PreviewSource, Settings, Source, Snapshot, VlcStatus } from "./types";

export const getSnapshot = () => invoke<Snapshot>("get_snapshot");

// backend returns a Rust tuple -> JSON array [id, duplicate]
export const addSource = (source: Source, downloadDir: string | null, files: number[] | null) =>
  invoke<[number, boolean]>("add_source", { source, downloadDir, files });

export const previewSource = (source: Source) =>
  invoke<PreviewSource>("preview_source", { source });
export const pauseTorrent = (id: number) => invoke<void>("pause_torrent", { id });
export const resumeTorrent = (id: number) => invoke<void>("resume_torrent", { id });
export const removeTorrent = (id: number, deleteFiles: boolean) =>
  invoke<void>("remove_torrent", { id, deleteFiles });
export const recheckTorrent = (id: number) => invoke<void>("recheck_torrent", { id });
export const setTorrentFiles = (id: number, files: number[]) =>
  invoke<void>("set_torrent_files", { id, files });
export const moveTorrentOrder = (id: number, delta: number) =>
  invoke<void>("move_torrent_order", { id, delta });
export const prioritizeTorrent = (id: number) => invoke<void>("prioritize_torrent", { id });

export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettingsCmd = (settings: Settings) =>
  invoke<void>("save_settings_cmd", { settings });

export const diskFreeBytes = (path?: string | null) =>
  invoke<number | null>("disk_free_bytes", { path: path ?? null });
export const defaultDownloadDir = () => invoke<string>("default_download_dir");

export const vlcStatus = () => invoke<VlcStatus>("vlc_status");
export const launchVlc = (torrentId: number, fileId: number) =>
  invoke<void>("launch_vlc", { torrentId, fileId });
export const streamUrl = (torrentId: number, fileId: number) =>
  invoke<string>("stream_url", { torrentId, fileId });
export const bufferStatus = (torrentId: number, fileId: number, position: number) =>
  invoke<number>("buffer_status", { torrentId, fileId, position: Math.round(position) });
export const suggestVideoFile = (torrentId: number) =>
  invoke<number | null>("suggest_video_file", { torrentId });

export const takePendingSource = () => invoke<Source | null>("take_pending_source");
