use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub download_dir: Option<String>,
    pub max_downloads: u32,
    pub dl_limit_bps: Option<u64>,
    pub ul_limit_bps: Option<u64>,
    pub stop_ratio: Option<f64>,
    pub vlc_path: Option<String>,
    pub start_with_windows: bool,
    pub start_minimized: bool,
    pub minimize_to_tray: bool,
    pub auto_resume: bool,
    pub notifications: bool,
    pub prevent_sleep: bool,
    pub assoc_torrent: bool,
    pub assoc_magnet: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: None,
            max_downloads: 4,
            dl_limit_bps: None,
            ul_limit_bps: None,
            stop_ratio: None,
            vlc_path: None,
            start_with_windows: false,
            start_minimized: false,
            minimize_to_tray: true,
            auto_resume: true,
            notifications: true,
            prevent_sleep: true,
            assoc_torrent: false,
            assoc_magnet: false,
        }
    }
}

impl Settings {
    pub fn load(dir: &std::path::Path) -> Settings {
        let path = dir.join("settings.json");
        match std::fs::read_to_string(&path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => Settings::default(),
        }
    }

    pub fn save(&self, dir: &std::path::Path) -> anyhow::Result<()> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join("settings.json");
        Ok(std::fs::write(path, serde_json::to_string_pretty(self)?)?)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TorrentMetaEntry {
    pub added_at: i64,
    pub completed_at: Option<i64>,
    pub user_paused: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MetaStore {
    pub entries: std::collections::HashMap<String, TorrentMetaEntry>,
    pub order: Vec<String>,
}

impl MetaStore {
    pub fn load(dir: &std::path::Path) -> MetaStore {
        let path = dir.join("torrents.json");
        match std::fs::read_to_string(&path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => MetaStore::default(),
        }
    }

    pub fn save(&self, dir: &std::path::Path) {
        if let Ok(s) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(dir.join("torrents.json"), s);
        }
    }
}

pub fn config_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("no config dir available")
}
