export interface FileDto {
  index: number;
  path: string;
  len: number;
  downloaded: number;
  selected: boolean;
}

export interface TrackerDto {
  url: string;
}

export interface LogDto {
  ts: number;
  kind: string;
  message: string;
}

export interface TorrentDto {
  id: number;
  name: string;
  infoHash: string;
  state: string;
  error: string | null;
  progress: number;
  progressBytes: number;
  totalBytes: number;
  downloadBps: number;
  uploadBps: number;
  etaSecs: number | null;
  peers: number;
  swarmSize: number;
  uploadedBytes: number;
  savePath: string;
  addedAt: number;
  completedAt: number | null;
  queued: boolean;
  files: FileDto[];
  trackers: TrackerDto[];
  activity: LogDto[];
}

export interface SessionStats {
  downloadBps: number;
  uploadBps: number;
  activeDownloads: number;
  dhtNodes: number | null;
  listenPort: number | null;
}

export interface Snapshot {
  torrents: TorrentDto[];
  session: SessionStats;
}

export interface Settings {
  downloadDir: string | null;
  maxDownloads: number;
  dlLimitBps: number | null;
  ulLimitBps: number | null;
  stopRatio: number | null;
  vlcPath: string | null;
  startWithWindows: boolean;
  startMinimized: boolean;
  minimizeToTray: boolean;
  autoResume: boolean;
  notifications: boolean;
  preventSleep: boolean;
  assocTorrent: boolean;
  assocMagnet: boolean;
}

export interface VlcStatus {
  found: boolean;
  path: string | null;
}

export type Source =
  | { kind: "magnet"; url: string }
  | { kind: "torrentPath"; path: string };
