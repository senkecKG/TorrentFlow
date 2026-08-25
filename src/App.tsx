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

function matchesFilter(t: TorrentDto, view: Exclude<View, "settings">): boolean {
  if (view === "all") return true;
  if (view === "downloading") return DOWNLOADING_STATES.has(t.state) || t.queued;
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [addModal, setAddModal] = useState<{
    requestId: number;
    source: Source | null;
  } | null>(null);
  const nextAddRequestId = useRef(0);
  const [removeTarget, setRemoveTarget] = useState<TorrentDto | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [winWidth, setWinWidth] = useState(window.innerWidth);

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

  const actions = useMemo(
    () => ({
      onSelect: (t: TorrentDto | null) => {
        if (t == null) return;
        setSelectedId(t.id);
        setDrawerId(t.id);
      },
      onPauseResume: (t: TorrentDto) =>
        run(
          (t.queued || t.state === "paused" ? resumeTorrent(t.id) : pauseTorrent(t.id)),
          "change state",
        ),
      onPrioritize: (t: TorrentDto) => run(prioritizeTorrent(t.id), "prioritize"),
      onMove: (t: TorrentDto, delta: number) => run(moveTorrentOrder(t.id, delta), "reorder"),
      onRecheck: (t: TorrentDto) => run(recheckTorrent(t.id).then(refresh), "recheck"),
      onWatch: async (t: TorrentDto) => {
        try {
          const fid = await suggestVideoFile(t.id);
          if (fid == null) {
            toast("warn", "No playable video file");
            return;
          }
          await launchVlc(t.id, fid);
          toast("success", "Launching VLC", "Playback starts once enough data is ready.");
        } catch (e) {
          toast("error", "Could not start VLC", errMsg(e));
        }
      },
      onOpenFolder: (t: TorrentDto) => run(revealItemInDir(t.savePath), "open folder"),
      onRemove: (t: TorrentDto) => setRemoveTarget(t),
    }),
    [run, refresh],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openAddModal(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openAddModal]);

  const torrents = snapshot?.torrents ?? [];
  const filtered = useMemo(
    () => (view === "settings" ? [] : torrents.filter((t) => matchesFilter(t, view))),
    [torrents, view],
  );
  const drawerTorrent = drawerId == null ? null : (torrents.find((t) => t.id === drawerId) ?? null);
  const collapsedRail = winWidth < 1100;

  function confirmRemove(deleteFiles: boolean) {
    const t = removeTarget;
    if (!t) return;
    setRemoveTarget(null);
    if (drawerId === t.id) setDrawerId(null);
    if (selectedId === t.id) setSelectedId(null);
    removeTorrent(t.id, deleteFiles)
      .then(refresh)
      .then(() => toast("success", "Torrent removed", deleteFiles ? "Files were deleted." : undefined))
      .catch((e) => toast("error", "Could not remove torrent", errMsg(e)));
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <NavRail view={view} onView={setView} collapsed={collapsedRail} />
        <main className="flex min-w-0 flex-1 flex-col">
          <Header
            view={view}
            onAdd={() => openAddModal(null)}
          />
          {view === "settings" ? (
            <SettingsPage toast={toast} />
          ) : (
            <TorrentList
              torrents={filtered}
              selectedId={selectedId}
              view={view}
              actions={actions}
              onAdd={() => openAddModal(null)}
            />
          )}
        </main>
      </div>
      <StatusBar session={snapshot?.session ?? null} />

      {drawerTorrent && (
        <DetailsDrawer torrent={drawerTorrent} onClose={() => setDrawerId(null)} toast={toast} />
      )}
      {addModal && (
        <AddTorrentModal
          key={addModal.requestId}
          initialSource={addModal.source}
          onClose={() => setAddModal(null)}
          onAdded={(id) => {
            setAddModal(null);
            setSelectedId(id);
            setDrawerId(id);
            refresh();
          }}
          toast={toast}
        />
      )}
      {removeTarget && (
        <RemoveDialog torrent={removeTarget} onClose={() => setRemoveTarget(null)} onConfirm={confirmRemove} />
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
