import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Source, TorrentDto } from "./lib/types";
import {
  acknowledgePendingSource,
  launchVlc,
  moveTorrentOrder,
  pauseTorrent,
  prioritizeTorrent,
  recheckTorrent,
  removeTorrent,
  resumeTorrent,
  suggestVideoFile,
  takePendingSource,
  takeStartupError,
  type SourceDelivery,
} from "./lib/api";
import { errMsg } from "./lib/format";
import { isResumable, isTorrentSort, sortTorrents, type TorrentSort } from "./lib/torrentList";
import { useSnapshot } from "./hooks/useSnapshot";
import { TitleBar } from "./components/TitleBar";
import { NavRail, type View } from "./components/NavRail";
import { Header } from "./components/Header";
import { StatusBar } from "./components/StatusBar";
import { TorrentList } from "./components/TorrentList";
import { SettingsPage } from "./components/SettingsPage";
import { DetailsDrawer } from "./components/DetailsDrawer";
import { AddTorrentModal } from "./components/AddTorrentModal";
import { RemoveDialog } from "./components/RemoveDialog";
import { ToastProvider, useToast, type ToastKind } from "./components/Toaster";

const DOWNLOADING_STATES = new Set(["fetching_metadata", "checking", "downloading"]);
const SORT_STORAGE_KEY = "torrentflow.torrentSort";

function matchesFilter(t: TorrentDto, view: Exclude<View, "settings">): boolean {
  if (view === "all") return true;
  if (view === "downloading") {
    return t.completedAt == null && (DOWNLOADING_STATES.has(t.state) || t.queued);
  }
  return t.state === "seeding" || t.progress >= 1 || t.completedAt != null;
}

async function osNotify(title: string, body: string) {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (granted) sendNotification({ title, body });
}

function Shell() {
  const toast = useToast();
  const { snapshot, refresh } = useSnapshot();
  const [view, setView] = useState<View>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [addModal, setAddModal] = useState<{
    requestId: number;
    source: Source | null;
  } | null>(null);
  const nextAddRequestId = useRef(0);
  const [removeTargets, setRemoveTargets] = useState<TorrentDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<TorrentSort>(() => {
    const stored = localStorage.getItem(SORT_STORAGE_KEY);
    return isTorrentSort(stored) ? stored : "recent";
  });
  const [dragOver, setDragOver] = useState(false);
  const [winWidth, setWinWidth] = useState(window.innerWidth);

  useEffect(() => localStorage.setItem(SORT_STORAGE_KEY, sort), [sort]);

  const openAddModal = useCallback((source: Source | null) => {
    setAddModal({ requestId: ++nextAddRequestId.current, source });
  }, []);

  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const unP = listen<{ kind: string; title: string; message: string }>("app://notify", (e) => {
      toast((e.payload.kind as ToastKind) ?? "info", e.payload.title, e.payload.message);
      if (document.hidden) osNotify(e.payload.title, e.payload.message);
    });
    return () => {
      unP.then((u) => u());
    };
  }, [toast]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const handled = new Set<number>();
    const handleSource = (delivery: SourceDelivery) => {
      if (disposed) return;
      if (handled.has(delivery.deliveryId)) return;
      handled.add(delivery.deliveryId);
      openAddModal(delivery.source);
      acknowledgePendingSource(delivery.deliveryId).catch((error) => {
        if (!disposed) toast("error", "Could not acknowledge external torrent", errMsg(error));
      });
    };
    listen<SourceDelivery>("app://source", (e) => handleSource(e.payload))
      .then((u) => {
        if (disposed) {
          u();
          return;
        }
        unlisten = u;
        takePendingSource()
          .then((s) => {
            if (s) handleSource(s);
          })
          .catch((e) => {
            if (!disposed) toast("error", "Could not open external torrent", errMsg(e));
          });
      })
      .catch((e) => {
        if (!disposed) toast("error", "Could not listen for external torrents", errMsg(e));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openAddModal, toast]);

  useEffect(() => {
    takeStartupError()
      .then((error) => {
        if (error) toast("error", "Could not repair Windows link handling", error);
      })
      .catch((error) => toast("error", "Could not read startup status", errMsg(error)));
  }, [toast]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((ev) => {
        const p = ev.payload;
        if (p.type === "leave") {
          setDragOver(false);
          return;
        }
        if (p.type === "over") return;
        const torrentPath = p.paths.find((x) => x.toLowerCase().endsWith(".torrent"));
        if (p.type === "drop") {
          setDragOver(false);
          if (torrentPath) openAddModal({ kind: "torrentPath", path: torrentPath });
          return;
        }
        setDragOver(torrentPath != null);
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openAddModal]);

  const run = useCallback(
    (p: Promise<unknown>, what: string) =>
      p.catch((e) => toast("error", `Could not ${what}`, errMsg(e))),
    [toast],
  );

  const torrents = snapshot?.torrents ?? [];
  const filtered = useMemo(
    () =>
      view === "settings"
        ? []
        : sortTorrents(
            torrents.filter((torrent) => matchesFilter(torrent, view)),
            sort,
          ),
    [sort, torrents, view],
  );
  const selectedTorrents = useMemo(
    () => filtered.filter((torrent) => selectedIds.has(torrent.id)),
    [filtered, selectedIds],
  );

  useEffect(() => {
    const liveIds = new Set(torrents.map((torrent) => torrent.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => liveIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [torrents]);

  const toggleSelection = useCallback((torrent: TorrentDto) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(torrent.id)) next.delete(torrent.id);
      else next.add(torrent.id);
      return next;
    });
  }, []);

  const watchTorrent = useCallback(
    async (torrent: TorrentDto) => {
      try {
        const fileId = await suggestVideoFile(torrent.id);
        if (fileId == null) {
          toast("warn", "No playable video file");
          return;
        }
        await launchVlc(torrent.id, fileId);
        toast("success", "Launching VLC", "Playback starts once enough data is ready.");
      } catch (error) {
        toast("error", "Could not start VLC", errMsg(error));
      }
    },
    [toast],
  );

  const actions = useMemo(
    () => ({
      onSelect: (torrent: TorrentDto) => setDrawerId(torrent.id),
      onToggleSelection: toggleSelection,
      onPauseResume: (torrent: TorrentDto) =>
        run(
          (isResumable(torrent) ? resumeTorrent(torrent.id) : pauseTorrent(torrent.id)).then(refresh),
          "change state",
        ),
      onPrioritize: (torrent: TorrentDto) => run(prioritizeTorrent(torrent.id), "prioritize"),
      onMove: (torrent: TorrentDto, delta: number) =>
        run(moveTorrentOrder(torrent.id, delta).then(refresh), "reorder"),
      onRecheck: (torrent: TorrentDto) => run(recheckTorrent(torrent.id).then(refresh), "recheck"),
      onWatch: watchTorrent,
      onOpenFolder: (torrent: TorrentDto) => run(revealItemInDir(torrent.savePath), "open folder"),
      onRemove: (torrent: TorrentDto) => setRemoveTargets([torrent]),
    }),
    [refresh, run, toggleSelection, watchTorrent],
  );

  const changeSelectedState = useCallback(
    async (mode: "pause" | "resume") => {
      if (busy || selectedTorrents.length === 0) return;
      const targets = selectedTorrents.filter((torrent) =>
        mode === "resume" ? isResumable(torrent) : !isResumable(torrent),
      );
      if (targets.length === 0) {
        toast("info", mode === "resume" ? "Selection is already running" : "Selection is already paused");
        return;
      }

      setBusy(true);
      const failed = new Set<number>();
      let firstError = "";
      for (const torrent of targets) {
        try {
          if (mode === "resume") await resumeTorrent(torrent.id);
          else await pauseTorrent(torrent.id);
        } catch (error) {
          failed.add(torrent.id);
          firstError ||= errMsg(error);
        }
      }
      await refresh();
      setSelectedIds(failed);
      setBusy(false);
      if (failed.size > 0) {
        toast("error", `${targets.length - failed.size} changed, ${failed.size} failed`, firstError);
      } else {
        toast("success", `${targets.length} torrent${targets.length === 1 ? "" : "s"} ${mode === "resume" ? "resumed" : "paused"}`);
      }
    },
    [busy, refresh, selectedTorrents, toast],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editingText =
        target?.matches('textarea, select, [contenteditable="true"]') ||
        (target instanceof HTMLInputElement && !["button", "checkbox", "radio"].includes(target.type));
      if (
        event.defaultPrevented ||
        document.querySelector('[role="dialog"], [role="menu"]') ||
        editingText
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "n") {
        event.preventDefault();
        openAddModal(null);
      } else if ((event.ctrlKey || event.metaKey) && key === "a" && view !== "settings") {
        event.preventDefault();
        setSelectedIds(new Set(filtered.map((torrent) => torrent.id)));
      } else if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.repeat &&
        !target?.closest("aside") &&
        selectedTorrents.length > 0
      ) {
        if (event.key === "Escape") {
          event.preventDefault();
          setSelectedIds(new Set());
        } else if (event.key === "Delete") {
          event.preventDefault();
          if (!busy) setRemoveTargets(selectedTorrents);
        } else if (!target?.closest("input, button") && event.code === "Space") {
          event.preventDefault();
          const mode = selectedTorrents.every(isResumable) ? "resume" : "pause";
          void changeSelectedState(mode);
        } else if (!target?.closest("input, button") && key === "f" && selectedTorrents.length === 1) {
          event.preventDefault();
          void run(revealItemInDir(selectedTorrents[0].savePath), "open folder");
        } else if (!target?.closest("input, button") && key === "v" && selectedTorrents.length === 1) {
          event.preventDefault();
          void watchTorrent(selectedTorrents[0]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, changeSelectedState, filtered, openAddModal, run, selectedTorrents, view, watchTorrent]);

  const drawerTorrent = drawerId == null ? null : (torrents.find((t) => t.id === drawerId) ?? null);
  const closeDrawer = useCallback(() => setDrawerId(null), []);
  const collapsedRail = winWidth < 1100;

  async function confirmRemove(deleteFiles: boolean) {
    if (busy || removeTargets.length === 0) return;
    const targets = removeTargets;
    setBusy(true);
    const failed = new Set<number>();
    let firstError = "";
    for (const torrent of targets) {
      try {
        await removeTorrent(torrent.id, deleteFiles);
      } catch (error) {
        failed.add(torrent.id);
        firstError ||= errMsg(error);
      }
    }

    const removedIds = new Set(targets.filter((torrent) => !failed.has(torrent.id)).map((torrent) => torrent.id));
    if (drawerId != null && removedIds.has(drawerId)) setDrawerId(null);
    setRemoveTargets([]);
    await refresh();
    setBusy(false);

    if (failed.size > 0) {
      toast("error", `${removedIds.size} removed, ${failed.size} failed`, firstError);
    } else {
      toast(
        "success",
        `${removedIds.size} torrent${removedIds.size === 1 ? "" : "s"} removed`,
        deleteFiles ? "Downloaded files were deleted." : undefined,
      );
    }
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <NavRail
          view={view}
          onView={(nextView) => {
            setView(nextView);
            setSelectedIds(new Set());
            setDrawerId(null);
          }}
          collapsed={collapsedRail}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <Header
            view={view}
            onAdd={() => openAddModal(null)}
            sort={sort}
            onSort={setSort}
            selectionCount={selectedTorrents.length}
            busy={busy}
            onPause={() => void changeSelectedState("pause")}
            onResume={() => void changeSelectedState("resume")}
            onRemove={() => setRemoveTargets(selectedTorrents)}
            onClear={() => setSelectedIds(new Set())}
          />
          {view === "settings" ? (
            <SettingsPage toast={toast} />
          ) : (
            <TorrentList
              torrents={filtered}
              activeId={drawerId}
              selectedIds={selectedIds}
              manualOrder={sort === "queue"}
              view={view}
              actions={actions}
              onAdd={() => openAddModal(null)}
              onSelectAll={(selected) =>
                setSelectedIds(selected ? new Set(filtered.map((torrent) => torrent.id)) : new Set())
              }
            />
          )}
        </main>
      </div>
      <StatusBar session={snapshot?.session ?? null} />

      {drawerTorrent && <DetailsDrawer torrent={drawerTorrent} onClose={closeDrawer} toast={toast} />}
      {addModal && (
        <AddTorrentModal
          key={addModal.requestId}
          initialSource={addModal.source}
          onClose={() => setAddModal(null)}
          onAdded={(id) => {
            setAddModal(null);
            setDrawerId(id);
            refresh();
          }}
          toast={toast}
        />
      )}
      {removeTargets.length > 0 && (
        <RemoveDialog
          torrents={removeTargets}
          busy={busy}
          onClose={() => !busy && setRemoveTargets([])}
          onConfirm={confirmRemove}
        />
      )}

      {dragOver && (
        <div className="pointer-events-none fixed inset-2 z-[80] flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/[0.04]">
          <span className="rounded-md bg-panel px-3 py-1.5 text-[12px] font-medium text-ink shadow-lg">
            Drop to add torrent
          </span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
