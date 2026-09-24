mod commands;
mod engine;
mod settings;
mod vlc;
mod winint;

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

use commands::AppState;
use engine::Engine;
use settings::Settings;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingSource {
    delivery_id: u64,
    source: serde_json::Value,
}

static NEXT_DELIVERY_ID: AtomicU64 = AtomicU64::new(1);
static PENDING_SOURCE: Mutex<Option<PendingSource>> = Mutex::new(None);
static STARTUP_ERROR: Mutex<Option<String>> = Mutex::new(None);

fn pending_source(source: serde_json::Value) -> PendingSource {
    PendingSource {
        delivery_id: NEXT_DELIVERY_ID.fetch_add(1, Ordering::Relaxed),
        source,
    }
}

fn source_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<serde_json::Value> {
    for a in args {
        let lower = a.to_ascii_lowercase();
        if lower.starts_with("magnet:") {
            return Some(serde_json::json!({ "kind": "magnet", "url": a }));
        }
        if lower.ends_with(".torrent") {
            return Some(serde_json::json!({ "kind": "torrentPath", "path": a }));
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            if let Some(src) = source_from_args(args.iter().cloned()) {
                let pending = pending_source(src);
                *PENDING_SOURCE.lock().unwrap() = Some(pending.clone());
                let _ = app.emit("app://source", pending);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ));

    builder
        .setup(|app| {
            let handle = app.handle().clone();
            let has_startup_source = if let Some(src) = source_from_args(std::env::args().skip(1)) {
                *PENDING_SOURCE.lock().unwrap() = Some(pending_source(src));
                true
            } else {
                false
            };
            let loaded_settings = Settings::load(&settings::config_dir(&handle));
            if let Err(e) = commands::refresh_file_associations(&loaded_settings) {
                *STARTUP_ERROR.lock().unwrap() = Some(e);
            }
            let settings = std::sync::Arc::new(Mutex::new(loaded_settings));

            tauri::async_runtime::block_on(async {
                let engine = match Engine::init(handle.clone(), settings.clone()).await {
                    Ok(engine) => engine,
                    Err(e) => {
                        winint::show_fatal_error(
                            "TorrentFlow could not start",
                            &format!("The torrent engine failed to start.\n\n{e:#}"),
                        );
                        std::process::exit(1);
                    }
                };
                let state = AppState {
                    engine: engine.clone(),
                    settings: settings.clone(),
                    app: handle.clone(),
                };
                handle.manage(state);
                tauri::async_runtime::spawn(async move {
                    engine.run_loop().await;
                });
            });

            // tray
            let show = MenuItem::with_id(app, "show", "Show TorrentFlow", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("TorrentFlow")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // start minimized support
            let minimized = {
                let s = settings.lock().unwrap();
                s.start_minimized
            };
            if minimized && !has_startup_source {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let minimize_to_tray = window
                    .app_handle()
                    .try_state::<AppState>()
                    .map(|s| s.settings.lock().unwrap().minimize_to_tray)
                    .unwrap_or(false);
                if minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::preview_source,
            commands::add_source,
            commands::pause_torrent,
            commands::resume_torrent,
            commands::remove_torrent,
            commands::set_torrent_files,
            commands::recheck_torrent,
            commands::move_torrent_order,
            commands::prioritize_torrent,
            commands::get_settings,
            commands::save_settings_cmd,
            commands::disk_free_bytes,
            commands::default_download_dir,
            commands::vlc_status,
            commands::launch_vlc,
            commands::stream_url,
            commands::buffer_status,
            commands::suggest_video_file,
            commands::take_pending_source,
            commands::acknowledge_pending_source,
            commands::take_startup_error,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::source_from_args;

    #[test]
    fn recognizes_magnet_scheme_case_insensitively() {
        let uri = "MAGNET:?xt=urn:btih:123";
        let source = source_from_args([uri.to_string()]).unwrap();
        assert_eq!(source["kind"], "magnet");
        assert_eq!(source["url"], uri);
        assert!(source_from_args(["magnetized:value".to_string()]).is_none());
    }
}
