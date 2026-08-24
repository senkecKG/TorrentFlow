mod commands;
mod engine;
mod settings;
mod vlc;
mod winint;

use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

use commands::AppState;
use engine::Engine;
use settings::Settings;

static PENDING_SOURCE: Mutex<Option<serde_json::Value>> = Mutex::new(None);

fn source_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<serde_json::Value> {
    for a in args {
        if a.starts_with("magnet:") {
            return Some(serde_json::json!({ "kind": "magnet", "url": a }));
        }
        if a.to_lowercase().ends_with(".torrent") {
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
                *PENDING_SOURCE.lock().unwrap() = Some(src.clone());
                let _ = app.emit("app://source", src);
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
            if let Some(src) = source_from_args(std::env::args().skip(1)) {
                *PENDING_SOURCE.lock().unwrap() = Some(src);
            }
            let settings =
                std::sync::Arc::new(Mutex::new(Settings::load(&settings::config_dir(&handle))));

            tauri::async_runtime::block_on(async {
                let engine = Engine::init(handle.clone(), settings.clone())
                    .await
                    .expect("engine init failed");
                let state = AppState {
                    engine: engine.clone(),
                    settings: Mutex::new(settings.lock().unwrap().clone()),
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
            if minimized {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
