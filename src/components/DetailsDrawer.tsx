import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Clipboard,
  FolderOpen,
  Loader2,
  Play,
  Subtitles,
  X,
} from "lucide-react";
import type { TorrentDto } from "../lib/types";
import {
  bufferStatus,
  launchVlc,
  setTorrentFiles,
  streamUrl,
  suggestVideoFile,
} from "../lib/api";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  errMsg,
  formatBytes,
  formatClock,
  formatDate,
  formatEta,
  formatMmss,
  formatSpeed,
  percent,
  truncMiddle,
} from "../lib/format";
import { isSubtitle, isVideo } from "../lib/video";
import { ProgressBar, type ProgressVariant } from "./ProgressBar";
import { Dropdown } from "./Menu";

type PushFn = (kind: "info" | "success" | "warn" | "error", title: string, message?: string) => void;
type Tab = "overview" | "files" | "trackers" | "activity";

const READY_THRESHOLD = 0.02;
const LOOKAHEAD_BYTES = 32 * 1024 * 1024;

function Def({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-baseline justify-between gap-3">
      <span className="shrink-0 text-[11px] text-ink-3">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] text-ink">{children}</span>
    </div>
  );
}

function Badge({ tone, children }: { tone: "green" | "amber" | "dim"; children: React.ReactNode }) {
  const cls =
    tone === "green"
      ? "bg-accent-dim text-accent"
      : tone === "amber"
        ? "bg-warn/10 text-warn"
        : "bg-white/[0.06] text-ink-3";
  return <span className={`inline-flex h-5 items-center rounded px-2 text-[11px] font-medium ${cls}`}>{children}</span>;
}

type StreamPhase = "idle" | "preparing" | "playing";

function StreamingSection({
  t,
  toast,
  onPhaseChange,
}: {
  t: TorrentDto;
  toast: PushFn;
  onPhaseChange: (phase: StreamPhase, buffer: number) => void;
}) {
  const videoFiles = useMemo(() => t.files.filter((f) => isVideo(f.path)), [t]);
  const [suggested, setSuggested] = useState<number | null>(null);
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [buffer, setBuffer] = useState(0);
  const videoKey = videoFiles.map((file) => file.index).join(",");

  useEffect(() => {
    let alive = true;
    suggestVideoFile(t.id)
      .then((v) => alive && setSuggested(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [t.id, videoKey]);

  const buffering = phase === "playing" && buffer < 0.01 && t.downloadBps < 65536;

  useEffect(() => {
    onPhaseChange(phase, buffer);
  }, [phase, buffer, onPhaseChange]);

  useEffect(() => {
    if (phase === "idle") return;
    if (suggested == null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const b = await bufferStatus(t.id, suggested, 0);
        if (cancelled) return;
        setBuffer(b);
        if (phase === "preparing" && b >= READY_THRESHOLD) {
          try {
            await launchVlc(t.id, suggested);
            if (cancelled) return;
            toast("success", "Playing in VLC", "Stream is being served locally.");
            setPhase("playing");
          } catch (e) {
            if (cancelled) return;
            toast("error", "Could not start VLC", errMsg(e));
            setPhase("idle");
          }
          return;
        }
        timer = setTimeout(poll, 800);
      } catch (e) {
        if (cancelled) return;
        setPhase("idle");
        toast("error", "Could not check stream readiness", errMsg(e));
      }
    };
    timer = setTimeout(poll, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, suggested, t.id, toast]);

  if (videoFiles.length === 0) return null;

  async function watch(fileId?: number) {
    const fid = fileId ?? suggested;
    if (fid == null) {
      toast("warn", "No playable video file");
      return;
    }
    try {
      await launchVlc(t.id, fid);
      toast("success", "Launching VLC", "Playback starts once enough data is ready.");
    } catch (e) {
      toast("error", "Could not start VLC", errMsg(e));
    }
  }

  async function copyUrl() {
    if (suggested == null) return;
    try {
      const url = await streamUrl(t.id, suggested);
      await navigator.clipboard.writeText(url);
      toast("success", "Stream URL copied");
    } catch (e) {
      toast("error", "Could not copy URL", errMsg(e));
    }
  }

  function playEta(): string {
    const fileLen = videoFiles.find((f) => f.index === suggested)?.len ?? LOOKAHEAD_BYTES;
    const windowBytes = Math.min(fileLen, LOOKAHEAD_BYTES);
    const remaining = Math.max(0, READY_THRESHOLD - buffer) * windowBytes;
    return formatMmss(remaining / Math.max(t.downloadBps, 1));
  }

  const mainName = videoFiles.find((f) => f.index === suggested)?.path.split(/[\\/]/).pop() ?? "video";
  const others = videoFiles.filter((f) => f.index !== suggested);

  return (
    <section className="rounded-lg border border-hairline bg-panel-2 p-3">
      <div className="flex items-center gap-2">
        {others.length > 0 ? (
          <>
            <button disabled={suggested == null} onClick={() => watch()} className="btn-primary flex-1">
              <Play size={14} />
              Watch in VLC
              <span className="ml-1 hidden min-w-0 truncate opacity-60 xl:inline" title={mainName}>
                · {mainName}
              </span>
            </button>
            <Dropdown
              label="Other video files"
              width={260}
              align="start"
              trigger={() => <ChevronDown size={15} />}
              items={others.map((f) => ({
                label: f.path.split(/[\\/]/).pop() ?? f.path,
                icon: <Play size={12} />,
                onSelect: () => watch(f.index),
              }))}
            />
          </>
        ) : (
          <button disabled={suggested == null} onClick={() => watch()} className="btn-primary flex-1">
            <Play size={14} />
            Watch in VLC
          </button>
        )}
        <button disabled={suggested == null} onClick={copyUrl} className="btn-secondary">
          <Clipboard size={13} />
          Copy stream URL
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
        <label className="flex cursor-default items-center gap-2 text-ink-2">
          <input
            type="checkbox"
            checked={phase !== "idle"}
            onChange={(e) => setPhase(e.target.checked ? "preparing" : "idle")}
            disabled={phase === "playing" || suggested == null}
            className="h-3.5 w-3.5"
          />
          Play when ready
        </label>
        {phase === "preparing" ? (
          <span className="flex items-center gap-1.5 text-warn tabular-nums">
            <Loader2 size={12} className="animate-spin" />
            Preparing… {percent(buffer)} · playable in ~{playEta()}
          </span>
        ) : buffering ? (
          <span className="text-warn">Buffering…</span>
        ) : phase === "playing" ? (
          <span className="flex items-center gap-1.5 text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Playing
          </span>
        ) : (
          <span className="text-ink-3">Stream starts as soon as pieces arrive</span>
        )}
      </div>
      {phase !== "idle" && (
        <div className="mt-2">
          <ProgressBar value={Math.min(1, buffer / Math.max(READY_THRESHOLD, buffer))} variant="normal" />
        </div>
      )}
    </section>
  );
}

function FilesTab({ t, toast }: { t: TorrentDto; toast: PushFn }) {
  const [sel, setSel] = useState<Set<number>>(() => new Set(t.files.filter((f) => f.selected).map((f) => f.index)));
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const selectionKey = t.files.filter((f) => f.selected).map((f) => f.index).join(",");
  useEffect(() => {
    if (!pending.current) setSel(new Set(selectionKey ? selectionKey.split(",").map(Number) : []));
  }, [selectionKey]);
  const locked = t.state === "seeding" || t.progress >= 1 || t.completedAt != null;
  const selectedBytes = t.files.reduce((acc, f) => (sel.has(f.index) ? acc + f.len : acc), 0);

  async function commit(next: Set<number>) {
    if (pending.current || locked) return;
    const previous = sel;
    pending.current = true;
    setSaving(true);
    setSel(next);
    try {
      await setTorrentFiles(t.id, [...next]);
    } catch (e) {
      setSel(previous);
      toast("error", "Could not update files", errMsg(e));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-2 text-[11px]">
        <span className="tabular-nums text-ink-3">
          {sel.size} / {t.files.length} selected · {formatBytes(selectedBytes)}
        </span>
        <div className="flex gap-3">
          <button
            disabled={locked || saving}
            onClick={() => commit(new Set(t.files.map((f) => f.index)))}
            className="text-accent hover:underline disabled:pointer-events-none disabled:opacity-40"
          >
            Select all
          </button>
          <button
            disabled={locked || saving}
            onClick={() => commit(new Set())}
            className="text-ink-2 hover:text-ink hover:underline disabled:pointer-events-none disabled:opacity-40"
          >
            Deselect all
          </button>
        </div>
      </div>
      {locked && (
        <p className="shrink-0 bg-panel px-4 py-1.5 text-[11px] text-ink-3">
          File selection is locked because this torrent is complete.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {t.files.map((f) => (
          <label key={f.index} className="flex cursor-default items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-white/[0.03]">
            <input
              type="checkbox"
              checked={sel.has(f.index)}
              disabled={locked || saving}
              onChange={() => {
                const next = new Set(sel);
                if (next.has(f.index)) next.delete(f.index);
                else next.add(f.index);
                commit(next);
              }}
              className="h-3.5 w-3.5 shrink-0"
            />
            {isSubtitle(f.path) ? (
              <Subtitles size={14} className="shrink-0 text-ink-3" />
            ) : (
              <span className="w-[14px] shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink" title={`${f.path}${isSubtitle(f.path) ? " — subtitle and video pieces are prioritized automatically" : ""}`}>
              {f.path}
            </span>
            <span className="shrink-0 text-right text-[11px] tabular-nums text-ink-3">
              {formatBytes(f.downloaded)}
            </span>
            <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-ink-2">
              {formatBytes(f.len)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function DetailsDrawer({
  torrent,
  onClose,
  toast,
}: {
  torrent: TorrentDto;
  onClose: () => void;
  toast: PushFn;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const t = torrent;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector('[aria-modal="true"], [role="menu"]')) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [stream, setStream] = useState<{ phase: StreamPhase; buffer: number }>({ phase: "idle", buffer: 0 });
  const onPhaseChange = useCallback((phase: StreamPhase, buffer: number) => setStream({ phase, buffer }), []);

  const ratio = t.totalBytes > 0 ? t.uploadedBytes / t.totalBytes : 0;
  const activity = [...t.activity].sort((a, b) => b.ts - a.ts);
  const hasVideo = t.files.some((f) => isVideo(f.path));
  const dotColor =
    t.error != null ? "bg-danger" : t.state === "downloading" ? "bg-accent" : t.state === "seeding" ? "bg-accent/50" : "bg-ink-3";

  const readiness =
    !hasVideo ? (
      <Badge tone="dim">No video</Badge>
    ) : stream.phase === "preparing" ? (
      <Badge tone="amber">Preparing {percent(stream.buffer)}</Badge>
    ) : stream.phase === "playing" ? (
      <Badge tone="green">Playing</Badge>
    ) : (
      <Badge tone="green">Ready to stream</Badge>
    );

  const variantForGrid: ProgressVariant = t.error
    ? "error"
    : t.queued
      ? "queued"
      : t.state === "seeding"
        ? "seeding"
        : t.state === "paused"
          ? "paused"
          : "normal";

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={`Details for ${t.name}`}
        className="fixed top-8 bottom-7 right-0 z-40 flex w-[420px] animate-slide-in flex-col border-l border-hairline bg-panel shadow-2xl shadow-black/50"
      >
        <header className="flex shrink-0 items-start justify-between gap-2 border-b border-hairline px-4 py-3">
          <h2 className="line-clamp-2 text-[13px] leading-snug font-semibold text-ink" title={t.name}>
            {t.name || t.infoHash}
          </h2>
          <button aria-label="Close details" onClick={onClose} className="icon-btn -mt-0.5 -mr-1">
            <X size={15} />
          </button>
        </header>

        <div className="flex shrink-0 gap-4 border-b border-hairline px-4">
          {(["overview", "files", "trackers", "activity"] as Tab[]).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative py-2.5 text-[12px] capitalize transition-colors duration-150 ${
                tab === id ? "font-medium text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {id}
              {tab === id && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <StreamingSection t={t} toast={toast} onPhaseChange={onPhaseChange} />

            <div className="rounded-lg border border-hairline bg-panel-2 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                <span className="flex-1 text-[12px] font-medium capitalize text-ink">
                  {t.error ? "Error" : t.queued ? "Queued" : t.state.replace("_", " ")}
                </span>
                {readiness}
              </div>
              <ProgressBar value={t.progress} variant={variantForGrid} />
              <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-ink-3">
                <span>{percent(t.progress)}</span>
                <span>
                  {formatBytes(t.progressBytes)} / {formatBytes(t.totalBytes)}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-hairline bg-panel-2 px-3 py-2">
              <Def label="State">{t.error ? "Error" : t.queued ? "Queued" : t.state.replace("_", " ")}</Def>
              <Def label="Download speed">{formatSpeed(t.downloadBps)}</Def>
              <Def label="Upload speed">{formatSpeed(t.uploadBps)}</Def>
              <Def label="Remaining">{t.progress >= 1 ? "—" : `${formatBytes(Math.max(0, t.totalBytes - t.progressBytes))}`}</Def>
              <Def label="ETA">{formatEta(t.etaSecs)}</Def>
              <Def label="Seeds / Peers">
                {Math.max(0, t.peers)} / {t.swarmSize < 0 ? "?" : t.swarmSize} seen
              </Def>
              <Def label="Uploaded">
                {formatBytes(t.uploadedBytes)} · ratio {ratio.toFixed(2)}
              </Def>
              <Def label="Added">{formatDate(t.addedAt)}</Def>
              <Def label="Completed">{t.completedAt != null ? formatDate(t.completedAt) : "—"}</Def>
              <Def label="Info hash">
                <span className="font-mono text-[11px] text-ink-2">{t.infoHash}</span>
              </Def>
              <Def label="Save location">
                <span className="flex items-center justify-end gap-1.5">
                  <button
                    title={`Click to copy · ${t.savePath}`}
                    onClick={() =>
                      navigator.clipboard.writeText(t.savePath).then(
                        () => toast("success", "Path copied"),
                        () => {},
                      )
                    }
                    className="max-w-full truncate hover:text-accent"
                  >
                    {truncMiddle(t.savePath, 34)}
                  </button>
                  <button
                    aria-label="Open folder in Explorer"
                    title="Open in Explorer"
                    onClick={() =>
                      revealItemInDir(t.savePath).catch((e) => toast("error", "Could not open folder", errMsg(e)))
                    }
                    className="icon-btn h-5 w-5 shrink-0"
                  >
                    <FolderOpen size={13} />
                  </button>
                </span>
              </Def>
            </div>

            {t.error && (
              <p className="rounded-md border border-danger/30 bg-danger/[0.08] px-3 py-2 text-[11px] break-words text-danger">
                {t.error}
              </p>
            )}
          </div>
        )}

        {tab === "files" && <FilesTab key={t.id} t={t} toast={toast} />}

        {tab === "trackers" && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {t.trackers.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-ink-3">No trackers reported.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {t.trackers.map((tr) => (
                  <li key={tr.url} className="truncate py-2 font-mono text-[11px] break-all text-ink-2" title={tr.url}>
                    {tr.url}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "activity" && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {activity.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-ink-3">No activity yet.</p>
            ) : (
              <ul className="space-y-2">
                {activity.map((l, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="w-14 shrink-0 tabular-nums text-ink-3">{formatClock(l.ts)}</span>
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                        l.kind === "success"
                          ? "bg-accent"
                          : l.kind === "warn"
                            ? "bg-warn"
                            : l.kind === "error"
                              ? "bg-danger"
                              : "bg-ink-3"
                      }`}
                    />
                    <span className="min-w-0 flex-1 break-words text-ink-2">{l.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
