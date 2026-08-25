use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::engine::types::{PreviewSourceDto, SnapshotDto, SourceKind};
use crate::engine::Engine;
use crate::settings::Settings;
use crate::vlc;
use crate::winint;

pub struct AppState {
    pub engine: Engine,
    pub settings: Mutex<Settings>,
    pub app: AppHandle,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VlcStatus {
    pub found: bool,
    pub path: Option<String>,
}

fn settings_snapshot(state: &AppState) -> Settings {
    state.settings.lock().unwrap().clone()
}

fn save_settings(state: &AppState, s: &Settings) -> Result<(), String> {
    let dir = crate::settings::config_dir(&state.app);
    s.save(&dir)
        .map_err(|e| format!("failed to save settings: {e:#}"))?;
    *state.settings.lock().unwrap() = s.clone();
    Ok(())
}

#[tauri::command]
pub fn get_snapshot(state: State<AppState>) -> SnapshotDto {
    state.engine.snapshot()
}

#[tauri::command]
pub async fn preview_source(
    state: State<'_, AppState>,
    source: SourceKind,
) -> Result<PreviewSourceDto, String> {
    state
        .engine
        .preview_source(source)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn add_source(
    state: State<'_, AppState>,
    source: SourceKind,
    download_dir: Option<String>,
    files: Option<Vec<usize>>,
) -> Result<(usize, bool), String> {
    state
        .engine
        .add_source(source, download_dir, files)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn pause_torrent(state: State<'_, AppState>, id: usize) -> Result<(), String> {
    state.engine.pause(id).await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn resume_torrent(state: State<'_, AppState>, id: usize) -> Result<(), String> {
    state.engine.resume(id).await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn remove_torrent(
    state: State<'_, AppState>,
    id: usize,
    delete_files: bool,
) -> Result<(), String> {
    state
        .engine
        .remove(id, delete_files)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn set_torrent_files(
    state: State<'_, AppState>,
    id: usize,
    files: Vec<usize>,
) -> Result<(), String> {
    state
        .engine
        .set_files(id, files)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn recheck_torrent(state: State<'_, AppState>, id: usize) -> Result<(), String> {
    state.engine.recheck(id).await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn move_torrent_order(state: State<AppState>, id: usize, delta: i64) {
    state.engine.move_order(id, delta);
}

#[tauri::command]
pub fn prioritize_torrent(state: State<AppState>, id: usize) {
    state.engine.prioritize(id);
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    settings_snapshot(&state)
}

#[tauri::command]
pub fn save_settings_cmd(state: State<AppState>, settings: Settings) -> Result<(), String> {
    let previous = settings_snapshot(&state);
    let association_backups = update_file_associations(&previous, &settings)?;
    if let Err(save_error) = save_settings(&state, &settings) {
        return match restore_file_associations(&association_backups) {
            Ok(()) => Err(save_error),
            Err(rollback_error) => Err(format!(
                "{save_error}; failed to restore file associations: {rollback_error}"
            )),
        };
    }
    state.engine.apply_limits();
    apply_side_effects(&state, &settings);
    Ok(())
}

fn apply_side_effects(state: &AppState, s: &Settings) {
    // autostart
    use tauri_plugin_autostart::ManagerExt as _;
    let autostart = state.app.autolaunch();
    let _ = if s.start_with_windows {
        autostart.enable()
    } else {
        autostart.disable()
    };
}

fn release_exe() -> Result<Option<String>, String> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    std::env::current_exe()
        .map(|p| Some(p.to_string_lossy().into_owned()))
        .map_err(|e| format!("failed to locate TorrentFlow executable: {e}"))
}

fn restore_file_associations(backups: &[winint::FileAssociationBackup]) -> Result<(), String> {
    let errors = backups
        .iter()
        .rev()
        .filter_map(|backup| {
            winint::restore_file_association(backup)
                .err()
                .map(|error| format!("{error:#}"))
        })
        .collect::<Vec<_>>();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(", "))
    }
}

fn update_file_associations(
    previous: &Settings,
    next: &Settings,
) -> Result<Vec<winint::FileAssociationBackup>, String> {
    let Some(exe) = release_exe()? else {
        return Ok(Vec::new());
    };
    let mut backups = Vec::new();
    for (kind, was_enabled, enabled) in [
        ("torrent", previous.assoc_torrent, next.assoc_torrent),
        ("magnet", previous.assoc_magnet, next.assoc_magnet),
    ] {
        if was_enabled == enabled {
            continue;
        }
        let backup = match winint::snapshot_file_association(kind) {
            Ok(backup) => backup,
            Err(error) => {
                let rollback = restore_file_associations(&backups)
                    .err()
                    .map(|rollback_error| format!("; rollback failed: {rollback_error}"))
                    .unwrap_or_default();
                return Err(format!(
                    "failed to inspect {kind} association: {error:#}{rollback}"
                ));
            }
        };
        backups.push(backup);
        if let Err(error) = winint::set_file_association(kind, enabled, &exe) {
            let rollback = restore_file_associations(&backups)
                .err()
                .map(|rollback_error| format!("; rollback failed: {rollback_error}"))
                .unwrap_or_default();
            return Err(format!(
                "failed to update {kind} association: {error:#}{rollback}"
            ));
        }
    }
    Ok(backups)
}

pub(crate) fn refresh_file_associations(settings: &Settings) -> Result<(), String> {
    let Some(exe) = release_exe()? else {
        return Ok(());
    };
    for (kind, enabled) in [
        ("torrent", settings.assoc_torrent),
        ("magnet", settings.assoc_magnet),
    ] {
        if enabled {
            winint::ensure_file_association(kind, &exe)
                .map_err(|e| format!("failed to refresh {kind} association: {e:#}"))?;
        } else {
            winint::remove_owned_file_association(kind)
                .map_err(|e| format!("failed to remove stale {kind} association: {e:#}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn disk_free_bytes(state: State<AppState>, path: Option<String>) -> Option<u64> {
    let dir = match path {
        Some(p) => p,
        None => crate::engine::resolve_download_dir(state.settings.lock().unwrap().clone()),
    };
    winint::disk_free_bytes(std::path::Path::new(&dir))
}

#[tauri::command]
pub fn default_download_dir(state: State<AppState>) -> String {
    crate::engine::resolve_download_dir(state.settings.lock().unwrap().clone())
}

#[tauri::command]
pub fn vlc_status(state: State<AppState>) -> VlcStatus {
    let manual = state.settings.lock().unwrap().vlc_path.clone();
    match vlc::detect_vlc(manual.as_deref()) {
        Some(p) => VlcStatus {
            found: true,
            path: Some(p.to_string_lossy().into_owned()),
        },
        None => VlcStatus {
            found: false,
            path: None,
        },
    }
}

#[tauri::command]
pub fn launch_vlc(state: State<AppState>, torrent_id: usize, file_id: usize) -> Result<(), String> {
    let manual = state.settings.lock().unwrap().vlc_path.clone();
    let Some(vlc_path) = vlc::detect_vlc(manual.as_deref()) else {
        return Err("VLC was not found.".into());
    };
    let url = state.engine.stream_url(torrent_id, file_id);
    // keep the torrent alive while VLC plays
    state.engine.streaming_active_add(1);
    let res = vlc::launch_vlc(&vlc_path, &url);
    // best-effort decrement after a while; actual streaming holds its own guard
    let engine2 = state.engine.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        engine2.streaming_active_add(-1);
    });
    res.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn stream_url(state: State<AppState>, torrent_id: usize, file_id: usize) -> String {
    state.engine.stream_url(torrent_id, file_id)
}

#[tauri::command]
pub fn buffer_status(
    state: State<AppState>,
    torrent_id: usize,
    file_id: usize,
    position: u64,
) -> Result<f64, String> {
    let handle = state
        .engine
        .get_handle(torrent_id)
        .map_err(|e| format!("{e:#}"))?;
    let total = handle
        .with_metadata(|m| m.file_infos.get(file_id).map(|f| f.len))
        .ok()
        .flatten()
        .unwrap_or(0);
    if total == 0 {
        return Ok(0.0);
    }
    let ready = state
        .engine
        .buffer_ready_bytes(torrent_id, file_id, position)
        .unwrap_or(0);
    let window = (total - position.min(total)).min(crate::engine::LOOKAHEAD);
    Ok((ready as f64 / window.max(1) as f64).clamp(0.0, 1.0))
}

#[tauri::command]
pub fn suggest_video_file(
    state: State<AppState>,
    torrent_id: usize,
) -> Result<Option<usize>, String> {
    state
        .engine
        .suggest_video(torrent_id)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn take_pending_source() -> Option<crate::PendingSource> {
    crate::PENDING_SOURCE.lock().unwrap().take()
}

#[tauri::command]
pub fn acknowledge_pending_source(delivery_id: u64) -> bool {
    let mut pending = crate::PENDING_SOURCE.lock().unwrap();
    if pending
        .as_ref()
        .is_some_and(|source| source.delivery_id == delivery_id)
    {
        *pending = None;
        true
    } else {
        false
    }
}

#[tauri::command]
pub fn take_startup_error() -> Option<String> {
    crate::STARTUP_ERROR.lock().unwrap().take()
}
