use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileDto {
    pub index: usize,
    pub path: String,
    pub len: u64,
    pub downloaded: u64,
    pub selected: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrackerDto {
    pub url: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogDto {
    pub ts: i64,
    pub kind: String,
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TorrentDto {
    pub id: usize,
    pub name: String,
    pub info_hash: String,
    pub state: String,
    pub error: Option<String>,
    pub progress: f64,
    pub progress_bytes: u64,
    pub total_bytes: u64,
    pub download_bps: u64,
    pub upload_bps: u64,
    pub eta_secs: Option<u64>,
    pub peers: i64,
    pub swarm_size: i64,
    pub uploaded_bytes: u64,
    pub save_path: String,
    pub added_at: i64,
    pub completed_at: Option<i64>,
    pub queued: bool,
    pub files: Vec<FileDto>,
    pub trackers: Vec<TrackerDto>,
    pub activity: Vec<LogDto>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatsDto {
    pub download_bps: u64,
    pub upload_bps: u64,
    pub active_downloads: usize,
    pub dht_nodes: Option<u64>,
    pub listen_port: Option<u16>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDto {
    pub torrents: Vec<TorrentDto>,
    pub session: SessionStatsDto,
}

/// How a torrent was handed to the app.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SourceKind {
    Magnet { url: String },
    TorrentPath { path: String },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFileDto {
    pub index: usize,
    pub path: String,
    pub len: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSourceDto {
    pub duplicate: bool,
    pub id: Option<usize>,
    pub name: String,
    pub info_hash: String,
    pub total_bytes: u64,
    pub files: Vec<PreviewFileDto>,
}
