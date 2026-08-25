pub mod stream;
pub mod types;

use std::collections::{HashMap, HashSet};
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use librqbit::limits::LimitsConfig;
use librqbit::{
    AddTorrent, AddTorrentOptions, Api, ListenerMode, ListenerOptions, ManagedTorrent, Session,
    SessionOptions, SessionPersistenceConfig,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as AsyncMutex;

use crate::settings::{config_dir, MetaStore, Settings, TorrentMetaEntry};
use crate::winint::SleepGuard;
use types::*;

pub const UPDATE_EVENT: &str = "torrents://update";
pub const NOTIFY_EVENT: &str = "app://notify";

#[derive(Serialize, Clone)]
pub struct NotifyDto {
    pub kind: String,
    pub title: String,
    pub message: String,
}

struct EngineInner {
    session: Arc<Session>,
    api: Api,
    app: AppHandle,
    dir: PathBuf,
    settings: Arc<std::sync::Mutex<Settings>>,
    meta: std::sync::Mutex<MetaStore>,
    activity: std::sync::Mutex<HashMap<usize, Vec<LogDto>>>,
    auto_paused: std::sync::Mutex<HashSet<usize>>,
    last_finished: std::sync::Mutex<HashMap<usize, bool>>,
    sleep: AsyncMutex<Option<SleepGuard>>,
    streaming_active: Arc<std::sync::atomic::AtomicUsize>,
    stream_port: AtomicU16,
}

pub struct Engine(Arc<EngineInner>);

impl Clone for Engine {
    fn clone(&self) -> Self {
        Engine(self.0.clone())
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Engine {
    pub async fn init(app: AppHandle, settings: Arc<std::sync::Mutex<Settings>>) -> Result<Engine> {
        let dir = config_dir(&app);
        std::fs::create_dir_all(&dir)?;
        let meta = MetaStore::load(&dir);
        let persist_dir = dir.join("session");
        std::fs::create_dir_all(&persist_dir)?;

        let (dl, ul) = {
            let s = settings.lock().unwrap();
            (
                s.dl_limit_bps
                    .and_then(|v| u32::try_from(v).ok())
                    .and_then(NonZeroU32::new),
                s.ul_limit_bps
                    .and_then(|v| u32::try_from(v).ok())
                    .and_then(NonZeroU32::new),
            )
        };

        let opts = SessionOptions {
            persistence: Some(SessionPersistenceConfig::Json {
                folder: Some(persist_dir),
            }),
            ratelimits: LimitsConfig {
                download_bps: dl,
                upload_bps: ul,
            },
            listen: Some(ListenerOptions {
                mode: ListenerMode::TcpAndUtp,
                enable_upnp_port_forwarding: true,
                ..Default::default()
            }),
            ..Default::default()
        };
        let default_dir = default_download_dir(settings.clone());
        std::fs::create_dir_all(&default_dir)?;
        let session = Session::new_with_opts(default_dir, opts)
            .await
            .context("failed to start torrent engine")?;
        let api = Api::new(session.clone(), None);

        let port = stream::spawn_server(session.clone()).await?;
        let inner = Arc::new(EngineInner {
            session,
            api,
            app,
            dir,
            settings,
            meta: std::sync::Mutex::new(meta),
            activity: std::sync::Mutex::new(HashMap::new()),
            auto_paused: std::sync::Mutex::new(HashSet::new()),
            last_finished: std::sync::Mutex::new(HashMap::new()),
            sleep: AsyncMutex::new(None),
            streaming_active: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            stream_port: AtomicU16::new(port),
        });
        Ok(Engine(inner))
    }

    pub fn stream_port(&self) -> u16 {
        self.0.stream_port.load(Ordering::Relaxed)
    }

    pub fn streaming_active(&self) -> usize {
        self.0.streaming_active.load(Ordering::Relaxed)
    }

    pub fn streaming_active_add(&self, delta: i64) {
        if delta >= 0 {
            self.0
                .streaming_active
                .fetch_add(delta as usize, Ordering::Relaxed);
        } else {
            self.0
                .streaming_active
                .fetch_sub((-delta) as usize, Ordering::Relaxed);
        }
    }

    pub fn session_stats_dht_nodes(&self) -> Option<u64> {
        let v = serde_json::to_value(self.0.api.api_dht_stats().ok()?).ok()?;
        v.get("routing_table_size")
            .and_then(|x| x.as_u64())
            .or_else(|| v.get("size").and_then(|x| x.as_u64()))
    }

    fn log(&self, id: usize, kind: &str, message: impl Into<String>) {
        let entry = LogDto {
            ts: now_ms(),
            kind: kind.to_string(),
            message: message.into(),
        };
        let mut act = self.0.activity.lock().unwrap();
        let list = act.entry(id).or_default();
        list.push(entry);
        if list.len() > 100 {
            let excess = list.len() - 100;
            list.drain(..excess);
        }
    }

    fn take_activity(&self, id: usize) -> Vec<LogDto> {
        self.0
            .activity
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .unwrap_or_default()
    }

    fn meta_entry(&self, hash_hex: &str) -> TorrentMetaEntry {
        let meta = self.0.meta.lock().unwrap();
        meta.entries
            .get(hash_hex)
            .cloned()
            .unwrap_or(TorrentMetaEntry {
                added_at: now_ms(),
                completed_at: None,
                user_paused: false,
            })
    }

    fn save_meta(&self) {
        self.0.meta.lock().unwrap().save(&self.0.dir);
    }

    pub fn id20_hex(id: &librqbit::dht::Id20) -> String {
        id.0.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn build_add(source: &SourceKind) -> Result<(AddTorrent<'static>, String)> {
        Ok(match source {
            SourceKind::Magnet { url } => (AddTorrent::from_url(url.clone()), url.clone()),
            SourceKind::TorrentPath { path } => {
                let bytes = std::fs::read(path).context("cannot read torrent file")?;
                let name = std::path::Path::new(path)
                    .file_name()
                    .map(|f| f.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.clone());
                (AddTorrent::from_bytes(bytes), name)
            }
        })
    }

    /// Fetch metadata without registering anything (librqbit list_only).
    pub async fn preview_source(&self, source: SourceKind) -> Result<PreviewSourceDto> {
        if let Some(hash) = source_info_hash(&source)? {
            if let Some(existing) = self.find_by_hash(&hash) {
                let known = existing
                    .with_metadata(|md| {
                        let files: Vec<PreviewFileDto> = md
                            .file_infos
                            .iter()
                            .enumerate()
                            .map(|(i, fi)| PreviewFileDto {
                                index: i,
                                path: fi.relative_filename.to_string_lossy().into_owned(),
                                len: fi.len,
                            })
                            .collect();
                        let total = files.iter().map(|f| f.len).sum();
                        (
                            md.info.name().map(|s| s.into_owned()).unwrap_or_default(),
                            total,
                            files,
                        )
                    })
                    .ok();
                let (name, total_bytes, files) = known.unwrap_or_default();
                return Ok(PreviewSourceDto {
                    duplicate: true,
                    id: Some(existing.id()),
                    name,
                    info_hash: hash,
                    total_bytes,
                    files,
                });
            }
        }

        let (add, display_name) = Self::build_add(&source)?;
        let opts = AddTorrentOptions {
            list_only: true,
            ..Default::default()
        };
        let response = tokio::time::timeout(
            Duration::from_secs(90),
            self.0.session.add_torrent(add, Some(opts)),
        )
        .await
        .context("timed out reading torrent information")?
        .map_err(|e| friendly_add_error(source.clone(), e))?;

        match response {
            librqbit::AddTorrentResponse::ListOnly(r) => {
                let files: Vec<PreviewFileDto> = r
                    .info
                    .iter_file_details()
                    .enumerate()
                    .map(|(i, fd)| PreviewFileDto {
                        index: i,
                        path: fd.filename.to_string(),
                        len: fd.len,
                    })
                    .collect();
                let name = r
                    .info
                    .name()
                    .map(|s| s.into_owned())
                    .unwrap_or(display_name);
                let total_bytes = files.iter().map(|f| f.len).sum();
                Ok(PreviewSourceDto {
                    duplicate: false,
                    id: None,
                    name,
                    info_hash: Self::id20_hex(&r.info_hash),
                    total_bytes,
                    files,
                })
            }
            _ => unreachable!(),
        }
    }

    pub async fn add_source(
        &self,
        source: SourceKind,
        download_dir_override: Option<String>,
        only_files: Option<Vec<usize>>,
    ) -> Result<(usize, bool)> {
        // Duplicate detection before adding anything.
        if let Some(hash) = source_info_hash(&source)? {
            if let Some(existing) = self.find_by_hash(&hash) {
                return Ok((existing.id(), true));
            }
        }

        let folder = download_dir_override
            .map(PathBuf::from)
            .unwrap_or_else(|| default_download_dir(self.0.settings.clone()));

        let (add, display_name) = Self::build_add(&source)?;

        let opts = AddTorrentOptions {
            overwrite: true,
            paused: false,
            output_folder: Some(folder.to_string_lossy().into_owned()),
            only_files,
            ..Default::default()
        };

        let response = tokio::time::timeout(
            Duration::from_secs(90),
            self.0.session.add_torrent(add, Some(opts)),
        )
        .await
        .context("timed out reading torrent information")?
        .map_err(|e| friendly_add_error(source.clone(), e))?;
        match response {
            librqbit::AddTorrentResponse::Added(_, handle)
            | librqbit::AddTorrentResponse::AlreadyManaged(_, handle) => {
                let hex = Self::id20_hex(&handle.info_hash());
                {
                    let mut meta = self.0.meta.lock().unwrap();
                    meta.entries
                        .entry(hex.clone())
                        .or_insert_with(|| TorrentMetaEntry {
                            added_at: now_ms(),
                            completed_at: None,
                            user_paused: false,
                        });
                    if !meta.order.contains(&hex) {
                        meta.order.push(hex.clone());
                    }
                }
                self.save_meta();
                self.log(handle.id(), "info", format!("Added \"{}\"", display_name));
                Ok((handle.id(), false))
            }
            librqbit::AddTorrentResponse::ListOnly(_) => unreachable!(),
        }
    }

    fn find_by_hash(&self, hash_hex: &str) -> Option<Arc<ManagedTorrent>> {
        let wanted = hash_hex.to_ascii_lowercase();
        self.0.session.with_torrents(|it| {
            it.map(|(_, h)| h.clone())
                .find(|h| Self::id20_hex(&h.info_hash()) == wanted)
        })
    }

    pub fn get_handle(&self, id: usize) -> Result<Arc<ManagedTorrent>> {
        self.0
            .session
            .get(id.into())
            .ok_or_else(|| anyhow!("torrent {id} not found"))
    }

    pub async fn pause(&self, id: usize) -> Result<()> {
        let handle = self.get_handle(id)?;
        self.0.session.pause(&handle).await.ok();
        self.set_user_paused(id, &handle, true);
        self.log(id, "info", "Paused");
        Ok(())
    }

    pub async fn resume(&self, id: usize) -> Result<()> {
        let handle = self.get_handle(id)?;
        self.0.session.unpause(&handle).await?;
        self.set_user_paused(id, &handle, false);
        self.log(id, "info", "Resumed");
        Ok(())
    }

    pub async fn remove(&self, id: usize, delete_files: bool) -> Result<()> {
        let name = self.get_handle(id)?.name().unwrap_or_default();
        self.0.session.delete(id.into(), delete_files).await?;
        self.prune_meta();
        let suffix = if delete_files {
            " and deleted files"
        } else {
            ""
        };
        self.log(id, "warn", format!("Removed \"{name}\"{suffix}"));
        if delete_files {
            self.emit_notify(
                "removed",
                "Torrent removed",
                &format!("\"{name}\" was removed and its files were deleted."),
            );
        }
        Ok(())
    }

    fn prune_meta(&self) {
        let live: HashSet<String> = self
            .0
            .session
            .with_torrents(|it| it.map(|(_, h)| Self::id20_hex(&h.info_hash())).collect());
        let mut meta = self.0.meta.lock().unwrap();
        meta.order.retain(|h| live.contains(h));
        meta.entries.retain(|h, _| live.contains(h));
    }

    fn set_user_paused(&self, _id: usize, handle: &ManagedTorrent, paused: bool) {
        let hex = Self::id20_hex(&handle.info_hash());
        let mut meta = self.0.meta.lock().unwrap();
        let e = meta.entries.entry(hex).or_default();
        e.user_paused = paused;
        drop(meta);
        self.save_meta();
    }

    pub async fn set_files(&self, id: usize, files: Vec<usize>) -> Result<()> {
        let handle = self.get_handle(id)?;
        let set: HashSet<usize> = files.into_iter().collect();
        if set.is_empty() {
            bail!("at least one file must be selected");
        }
        self.0.session.update_only_files(&handle, &set).await?;
        self.log(id, "info", format!("Selected {} file(s)", set.len()));
        Ok(())
    }

    pub async fn recheck(&self, id: usize) -> Result<()> {
        let handle = self.get_handle(id)?;
        let bytes = handle.with_metadata(|m| m.torrent_bytes.clone())?;
        let folder = handle.output_folder().to_path_buf();
        let only_files = handle.only_files();
        let was_user_paused = {
            let hex = Self::id20_hex(&handle.info_hash());
            let meta = self.0.meta.lock().unwrap();
            meta.entries
                .get(&hex)
                .map(|e| e.user_paused)
                .unwrap_or(false)
        };
        self.0.session.delete(id.into(), false).await?;
        let opts = AddTorrentOptions {
            overwrite: true,
            paused: was_user_paused,
            output_folder: Some(folder.to_string_lossy().into_owned()),
            only_files,
            ..Default::default()
        };
        self.0
            .session
            .add_torrent(AddTorrent::from_bytes(bytes), Some(opts))
            .await?;
        self.log(id, "info", "Rechecking downloaded data");
        Ok(())
    }

    pub fn move_order(&self, id: usize, delta: i64) {
        let handle = self.get_handle(id).ok();
        let Some(handle) = handle else { return };
        let hex = Self::id20_hex(&handle.info_hash());
        let mut meta = self.0.meta.lock().unwrap();
        if let Some(pos) = meta.order.iter().position(|h| h == &hex) {
            let new_pos = (pos as i64 + delta).clamp(0, meta.order.len() as i64 - 1) as usize;
            meta.order.remove(pos);
            meta.order.insert(new_pos, hex);
        }
        drop(meta);
        self.save_meta();
    }

    pub fn prioritize(&self, id: usize) {
        self.move_order(id, -(meta_order_len(self) as i64));
        self.enforce_queue_blocking();
    }

    async fn enforce_queue_async(&self) {
        self.enforce_queue_inner().await;
    }

    fn enforce_queue_blocking(&self) {
        // Best-effort synchronous kick; full pass runs on the poll loop anyway.
        let engine = self.clone();
        tauri::async_runtime::spawn(async move {
            engine.enforce_queue_inner().await;
        });
    }

    async fn enforce_queue_inner(&self) {
        let max = {
            let s = self.0.settings.lock().unwrap();
            s.max_downloads.max(1) as usize
        };
        let ordered = self.ordered_handles();
        let mut active: usize = 0;
        let mut to_pause: Vec<Arc<ManagedTorrent>> = Vec::new();
        let mut to_resume: Vec<Arc<ManagedTorrent>> = Vec::new();

        for handle in &ordered {
            let stats = handle.stats();
            let finished = stats.finished
                || (stats.total_bytes > 0 && stats.progress_bytes >= stats.total_bytes);
            let is_live = st(&stats) == "live";
            let user_paused = {
                let hex = Self::id20_hex(&handle.info_hash());
                let meta = self.0.meta.lock().unwrap();
                meta.entries
                    .get(&hex)
                    .map(|e| e.user_paused)
                    .unwrap_or(false)
            };
            if user_paused || finished || !has_metadata(handle) {
                continue;
            }
            if is_live {
                if active < max {
                    active += 1;
                } else {
                    to_pause.push(handle.clone());
                }
            }
        }
        // Resume next queued torrents up to max slots.
        for handle in &ordered {
            if active >= max {
                break;
            }
            let stats = handle.stats();
            let finished = stats.finished;
            let user_paused = {
                let hex = Self::id20_hex(&handle.info_hash());
                let meta = self.0.meta.lock().unwrap();
                meta.entries
                    .get(&hex)
                    .map(|e| e.user_paused)
                    .unwrap_or(false)
            };
            if user_paused || finished || !has_metadata(handle) {
                continue;
            }
            if st(&stats) != "live" {
                to_resume.push(handle.clone());
                active += 1;
            }
        }

        {
            let mut auto = self.0.auto_paused.lock().unwrap();
            for h in to_resume.iter() {
                auto.remove(&h.id());
            }
            for h in to_pause.iter() {
                auto.insert(h.id());
            }
        }

        for h in to_resume {
            let _ = self.0.session.unpause(&h).await;
        }
        for h in to_pause {
            let _ = self.0.session.pause(&h).await;
        }
    }

    fn ordered_handles(&self) -> Vec<Arc<ManagedTorrent>> {
        let order = {
            let meta = self.0.meta.lock().unwrap();
            meta.order.clone()
        };
        let pairs: Vec<Arc<ManagedTorrent>> = self
            .0
            .session
            .with_torrents(|it| it.map(|(_, h)| h.clone()).collect());
        let mut by_hash: HashMap<String, Arc<ManagedTorrent>> = HashMap::new();
        for h in pairs {
            by_hash.insert(Self::id20_hex(&h.info_hash()), h);
        }
        let mut out: Vec<Arc<ManagedTorrent>> = Vec::new();
        for h in &order {
            if let Some(t) = by_hash.remove(h) {
                out.push(t);
            }
        }
        out.extend(by_hash.into_values());
        out
    }

    pub fn snapshot(&self) -> SnapshotDto {
        let handles = self.ordered_handles();
        let mut torrents = Vec::with_capacity(handles.len());
        let mut active_downloads = 0usize;
        let mut total_dl = 0u64;
        let mut total_ul = 0u64;

        for handle in &handles {
            let id = handle.id();
            let stats = handle.stats();
            let hex = Self::id20_hex(&handle.info_hash());
            let mut entry = self.meta_entry(&hex);
            let has_md = has_metadata(handle);

            let resumed_incomplete_download = entry.completed_at.is_some()
                && st(&stats) == "live"
                && !stats.finished
                && stats.total_bytes > 0
                && stats.progress_bytes < stats.total_bytes;
            if resumed_incomplete_download {
                let cleared = {
                    let mut meta = self.0.meta.lock().unwrap();
                    clear_completion(&mut meta, &hex)
                };
                if cleared {
                    entry.completed_at = None;
                    self.save_meta();
                    self.log(
                        id,
                        "warn",
                        "Downloaded data is incomplete; resuming download",
                    );
                }
            }

            if st(&stats) == "live" {
                total_dl += stats
                    .live
                    .as_ref()
                    .map(|l| l.download_speed.as_bytes())
                    .unwrap_or(0);
                total_ul += stats
                    .live
                    .as_ref()
                    .map(|l| l.upload_speed.as_bytes())
                    .unwrap_or(0);
            }
            if st(&stats) == "live" && !stats.finished {
                active_downloads += 1;
            }

            let (state, queued) = derive_state(
                &stats,
                has_md,
                &entry,
                &self.0.auto_paused.lock().unwrap(),
                id,
            );

            let name = handle
                .name()
                .unwrap_or_else(|| "Fetching torrent information".into());
            let trackers: Vec<TrackerDto> = handle
                .shared()
                .trackers
                .iter()
                .map(|u| TrackerDto { url: u.to_string() })
                .collect();

            let files: Vec<FileDto> = handle
                .with_metadata(|md| {
                    md.file_infos
                        .iter()
                        .enumerate()
                        .map(|(i, fi)| FileDto {
                            index: i,
                            path: fi.relative_filename.to_string_lossy().replace('\\', "/"),
                            len: fi.len,
                            downloaded: stats.file_progress.get(i).copied().unwrap_or(0),
                            selected: handle
                                .only_files()
                                .map(|of| of.contains(&i))
                                .unwrap_or(true),
                        })
                        .collect()
                })
                .unwrap_or_default();

            if state_transitioned_to_finished(&self.0.last_finished, id, stats.finished) {
                self.mark_completed(&hex, id, &name);
            }

            let hold_completed_progress = entry.completed_at.is_some() && state == "checking";
            let (progress, progress_bytes) = display_progress(
                stats.progress_bytes,
                stats.total_bytes,
                hold_completed_progress,
            );

            torrents.push(TorrentDto {
                id,
                name,
                info_hash: hex,
                state,
                error: stats.error.clone(),
                progress,
                progress_bytes,
                total_bytes: stats.total_bytes,
                download_bps: stats
                    .live
                    .as_ref()
                    .map(|l| l.download_speed.as_bytes())
                    .unwrap_or(0),
                upload_bps: stats
                    .live
                    .as_ref()
                    .map(|l| l.upload_speed.as_bytes())
                    .unwrap_or(0),
                eta_secs: stats.live.as_ref().and_then(|l| {
                    l.time_remaining
                        .as_ref()
                        .map(|t| parse_eta_secs(&t.to_string()))
                }),
                peers: stats
                    .live
                    .as_ref()
                    .map(|l| {
                        let p = &l.snapshot.peer_stats;
                        (p.live_tcp + p.live_utp + p.live_socks) as i64
                    })
                    .unwrap_or(0),
                swarm_size: stats
                    .live
                    .as_ref()
                    .map(|l| l.snapshot.peer_stats.seen as i64)
                    .unwrap_or(0),
                uploaded_bytes: stats.uploaded_bytes,
                save_path: handle.output_folder().to_string_lossy().into_owned(),
                added_at: entry.added_at,
                completed_at: entry.completed_at,
                queued,
                files,
                trackers,
                activity: self.take_activity(id),
            });
        }

        let listen_port = self.0.session.listen_addr().map(|a| a.port());
        SnapshotDto {
            torrents,
            session: SessionStatsDto {
                download_bps: total_dl,
                upload_bps: total_ul,
                active_downloads,
                dht_nodes: self.session_stats_dht_nodes(),
                listen_port,
            },
        }
    }

    fn mark_completed(&self, hex: &str, id: usize, name: &str) {
        let newly_completed = {
            let mut meta = self.0.meta.lock().unwrap();
            record_completion(&mut meta, hex, now_ms())
        };
        if !newly_completed {
            return;
        }
        self.save_meta();
        self.log(id, "success", "Download complete");
        self.emit_notify("completed", "Download complete", name);
    }

    fn emit_notify(&self, kind: &str, title: &str, message: &str) {
        let notifications_enabled = {
            let s = self.0.settings.lock().unwrap();
            s.notifications
        };
        if !notifications_enabled {
            return;
        }
        let _ = self.0.app.emit(
            NOTIFY_EVENT,
            NotifyDto {
                kind: kind.to_string(),
                title: title.to_string(),
                message: message.to_string(),
            },
        );
    }

    pub async fn run_loop(self) {
        let mut interval = tokio::time::interval(Duration::from_millis(1000));
        loop {
            interval.tick().await;
            self.enforce_queue_async().await;
            self.update_sleep_guard().await;
            self.apply_stop_ratio().await;
            let snap = self.snapshot();
            let _ = self.0.app.emit(UPDATE_EVENT, &snap);
        }
    }

    async fn update_sleep_guard(&self) {
        let prevent = {
            let s = self.0.settings.lock().unwrap();
            s.prevent_sleep
        };
        let busy = {
            let handles = self.ordered_handles();
            handles.iter().any(|h| {
                let ts = h.stats();
                st(&ts) == "live" && !ts.finished
                    || ts
                        .live
                        .as_ref()
                        .map(|l| l.download_speed.as_bytes() > 0 || l.upload_speed.as_bytes() > 0)
                        .unwrap_or(false)
            }) || self.streaming_active() > 0
        };
        let mut guard = self.0.sleep.lock().await;
        if busy && prevent {
            if guard.is_none() {
                *guard = Some(SleepGuard::acquire());
            }
        } else if let Some(g) = guard.as_mut() {
            g.release();
            *guard = None;
        }
    }

    async fn apply_stop_ratio(&self) {
        let ratio = {
            let s = self.0.settings.lock().unwrap();
            s.stop_ratio
        };
        let Some(ratio) = ratio else { return };
        let handles = self.ordered_handles();
        for h in handles {
            let ts = h.stats();
            if ts.finished
                && ts.total_bytes > 0
                && ts.uploaded_bytes as f64 >= ratio * ts.total_bytes as f64
                && st(&ts) == "live"
            {
                let id = h.id();
                if self.0.session.pause(&h).await.is_ok() {
                    self.set_user_paused(id, &h, true);
                    self.log(
                        id,
                        "info",
                        format!("Seeding goal reached ({ratio:.1}x), paused"),
                    );
                }
            }
        }
    }

    pub fn apply_limits(&self) {
        let (dl, ul) = {
            let s = self.0.settings.lock().unwrap();
            (
                s.dl_limit_bps
                    .and_then(|v| u32::try_from(v).ok())
                    .and_then(NonZeroU32::new),
                s.ul_limit_bps
                    .and_then(|v| u32::try_from(v).ok())
                    .and_then(NonZeroU32::new),
            )
        };
        self.0.session.ratelimits.set_download_bps(dl);
        self.0.session.ratelimits.set_upload_bps(ul);
    }

    /// Suggest the largest likely video file index for streaming.
    pub fn suggest_video(&self, id: usize) -> Result<Option<usize>> {
        let handle = self.get_handle(id)?;
        let best = handle.with_metadata(|md| {
            let mut best: Option<(usize, u64)> = None;
            for (i, fi) in md.file_infos.iter().enumerate() {
                let name = fi.relative_filename.to_string_lossy();
                if stream::is_video_file(&name) && best.map(|(_, len)| fi.len > len).unwrap_or(true)
                {
                    best = Some((i, fi.len));
                }
            }
            best.map(|(i, _)| i)
        })?;
        Ok(best)
    }

    /// Bytes ready within the lookahead window starting at `position` of `file_id`.
    pub fn buffer_ready_bytes(&self, id: usize, file_id: usize, position: u64) -> Result<u64> {
        let handle = self.get_handle(id)?;
        let metadata = handle.metadata.load();
        let md = metadata.as_ref().ok_or_else(|| anyhow!("no metadata"))?;
        let fi = md.file_infos.get(file_id).context("bad file")?;
        let dpl = md.lengths().default_piece_length() as u64;
        let abs_start = fi.offset_in_torrent + position.min(fi.len);
        let abs_end = (abs_start + LOOKAHEAD).min(fi.offset_in_torrent + fi.len);
        if abs_end <= abs_start {
            return Ok(0);
        }
        let (haves, _pieces): (Vec<bool>, u32) = {
            let (bb, piece_len) = self.0.api.api_dump_haves(id.into())?;
            (bb.iter().map(|b| *b).collect(), piece_len)
        };
        let start_piece = (abs_start / dpl) as usize;
        let end_piece = abs_end.div_ceil(dpl) as usize;
        let mut ready = 0u64;
        for (p, &have) in haves
            .iter()
            .enumerate()
            .take(end_piece.min(haves.len()))
            .skip(start_piece)
        {
            if !have {
                continue;
            }
            let ps = p as u64 * dpl;
            let pe = ps + dpl;
            let overlap = pe.min(abs_end).saturating_sub(ps.max(abs_start));
            ready += overlap;
        }
        Ok(ready)
    }

    pub fn stream_url(&self, id: usize, file_id: usize) -> String {
        format!(
            "http://127.0.0.1:{}/stream/{id}/{file_id}",
            self.stream_port()
        )
    }
}

pub const LOOKAHEAD: u64 = 32 * 1024 * 1024;

/// Resolve the effective download folder for the given settings.
pub fn resolve_download_dir(settings: Settings) -> String {
    if let Some(dir) = settings.download_dir {
        let pb = PathBuf::from(&dir);
        if pb.is_dir() {
            return pb.to_string_lossy().into_owned();
        }
    }
    dirs_download().to_string_lossy().into_owned()
}

fn has_metadata(handle: &ManagedTorrent) -> bool {
    !handle.metadata.load().is_none()
}

/// librqbit state Display: "initializing" | "live" | "paused" | "error"
fn st(stats: &librqbit::TorrentStats) -> String {
    stats.state.to_string()
}

fn derive_state(
    stats: &librqbit::TorrentStats,
    has_md: bool,
    entry: &TorrentMetaEntry,
    auto_paused: &HashSet<usize>,
    id: usize,
) -> (String, bool) {
    if !has_md {
        return ("fetching_metadata".into(), false);
    }
    match st(stats).as_str() {
        "error" => ("error".into(), false),
        "initializing" => ("checking".into(), false),
        "live" => {
            if stats.finished {
                ("seeding".into(), false)
            } else {
                ("downloading".into(), false)
            }
        }
        _ => {
            if stats.finished
                || (stats.total_bytes > 0 && stats.progress_bytes >= stats.total_bytes)
            {
                ("paused".into(), false)
            } else if auto_paused.contains(&id) && !entry.user_paused {
                // waiting for a free download slot
                ("downloading".into(), true)
            } else {
                ("paused".into(), false)
            }
        }
    }
}

fn state_transitioned_to_finished(
    map: &std::sync::Mutex<HashMap<usize, bool>>,
    id: usize,
    finished: bool,
) -> bool {
    let mut m = map.lock().unwrap();
    let prev = m.insert(id, finished).unwrap_or(false);
    !prev && finished
}

fn record_completion(meta: &mut MetaStore, hex: &str, completed_at: i64) -> bool {
    let entry = meta.entries.entry(hex.to_string()).or_default();
    if entry.completed_at.is_some() {
        return false;
    }
    entry.completed_at = Some(completed_at);
    true
}

fn clear_completion(meta: &mut MetaStore, hex: &str) -> bool {
    let Some(entry) = meta.entries.get_mut(hex) else {
        return false;
    };
    if entry.completed_at.take().is_none() {
        return false;
    }
    true
}

fn display_progress(
    progress_bytes: u64,
    total_bytes: u64,
    hold_completed_progress: bool,
) -> (f64, u64) {
    if hold_completed_progress {
        return (1.0, total_bytes);
    }
    if total_bytes == 0 {
        return (0.0, progress_bytes);
    }
    (progress_bytes as f64 / total_bytes as f64, progress_bytes)
}

fn parse_eta_secs(human: &str) -> u64 {
    // human like "1h 2m" / "3m 4s" / "12s"
    let mut secs = 0u64;
    for part in human.split_whitespace() {
        let (num, unit) = part.split_at(part.len().saturating_sub(1));
        let n: u64 = num.parse().unwrap_or(0);
        match unit {
            "h" => secs += n * 3600,
            "m" => secs += n * 60,
            _ => secs += n,
        }
    }
    secs
}

fn source_info_hash(source: &SourceKind) -> Result<Option<String>> {
    match source {
        SourceKind::Magnet { url } => {
            let lower = url.trim().to_string();
            if !lower.to_ascii_lowercase().starts_with("magnet:?") {
                bail!("Invalid magnet link. It must start with magnet:?xt=urn:btih:");
            }
            let hash = lower[8..]
                .split('&')
                .find_map(|p| p.strip_prefix("xt=urn:btih:"))
                .ok_or_else(|| anyhow!("Invalid magnet link: missing info hash"))?;
            Ok(hex_of_btih(hash))
        }
        SourceKind::TorrentPath { path } => {
            let bytes = std::fs::read(path).context("cannot read torrent file")?;
            let parsed = librqbit::torrent_from_bytes(&bytes)
                .map_err(|e| anyhow!("Corrupted torrent file: {e}"))?;
            Ok(Some(Engine::id20_hex(&parsed.info_hash)))
        }
    }
}

fn hex_of_btih(xt: &str) -> Option<String> {
    // xt like "urn:btih:<40hex>" or base32
    let rest = xt.strip_prefix("urn:btih:")?;
    if rest.len() == 40 && rest.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(rest.to_ascii_lowercase())
    } else {
        if let Ok(bytes) = base32_decode(&rest.to_uppercase()) {
            Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
        } else {
            None
        }
    }
}

fn base32_decode(s: &str) -> Result<Vec<u8>> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bits = 0u32;
    let mut acc = 0u32;
    let mut out = Vec::new();
    for c in s.bytes() {
        let v = ALPHABET
            .iter()
            .position(|&a| a.eq_ignore_ascii_case(&c))
            .ok_or_else(|| anyhow!("invalid base32"))? as u32;
        acc = (acc << 5) | v;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

fn friendly_add_error(source: SourceKind, e: anyhow::Error) -> anyhow::Error {
    let msg = format!("{e:#}");
    if msg.to_lowercase().contains("already") {
        anyhow!("This torrent is already in the list.")
    } else {
        match source {
            SourceKind::Magnet { .. } => anyhow!("Could not add magnet link: {msg}"),
            SourceKind::TorrentPath { .. } => anyhow!("Could not add torrent file: {msg}"),
        }
    }
}

fn default_download_dir(settings: Arc<std::sync::Mutex<Settings>>) -> PathBuf {
    let configured = {
        let s = settings.lock().unwrap();
        s.download_dir.clone()
    };
    if let Some(dir) = configured {
        let pb = PathBuf::from(&dir);
        if pb.is_dir() {
            return pb;
        }
    }
    dirs_download()
}

fn dirs_download() -> PathBuf {
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let downloads = PathBuf::from(home).join("Downloads").join("TorrentFlow");
        return downloads;
    }
    PathBuf::from(".")
}

fn meta_order_len(engine: &Engine) -> usize {
    engine.0.meta.lock().unwrap().order.len().saturating_sub(1)
}

#[cfg(test)]
mod tests {
    use super::{clear_completion, display_progress, record_completion};
    use crate::settings::MetaStore;

    #[test]
    fn completion_is_recorded_only_once() {
        let mut meta = MetaStore::default();

        assert!(record_completion(&mut meta, "abc123", 100));
        assert!(!record_completion(&mut meta, "abc123", 200));
        assert_eq!(meta.entries["abc123"].completed_at, Some(100));
    }

    #[test]
    fn completed_verification_keeps_progress_full() {
        assert_eq!(display_progress(25, 100, true), (1.0, 100));
        assert_eq!(display_progress(25, 100, false), (0.25, 25));
    }

    #[test]
    fn incomplete_download_clears_previous_completion() {
        let mut meta = MetaStore::default();
        assert!(record_completion(&mut meta, "abc123", 100));

        assert!(clear_completion(&mut meta, "abc123"));
        assert!(!clear_completion(&mut meta, "abc123"));
        assert_eq!(meta.entries["abc123"].completed_at, None);
    }
}
