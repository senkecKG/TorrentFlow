import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, FolderOpen, Minus, Plus, TriangleAlert } from "lucide-react";
import type { Settings, VlcStatus } from "../lib/types";
import {
  defaultDownloadDir,
  diskFreeBytes,
  getSettings,
  saveSettingsCmd,
  vlcStatus,
} from "../lib/api";
import { errMsg, formatBytes, truncMiddle } from "../lib/format";
import { Field } from "./Field";
import { Toggle } from "./Toggle";

type PushFn = (kind: "info" | "success" | "warn" | "error", title: string, message?: string) => void;

const VLC_URL = "https://www.videolan.org/vlc/";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="mb-2 text-[13px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function LimitInput({ bps, onBytes }: { bps: number | null; onBytes: (v: number | null) => void }) {
  return (
    <>
      <input
        type="number"
        min={0}
        step={1}
        placeholder="Unlimited"
        value={bps == null ? "" : String(Math.round(bps / 1024))}
        onChange={(e) => {
          const raw = e.target.value;
          const n = raw === "" ? 0 : Number(raw);
          onBytes(!raw || !Number.isFinite(n) || n <= 0 ? null : Math.round(n * 1024));
        }}
        className="input w-28 text-right tabular-nums"
      />
      <span className="text-[11px] text-ink-3">KB/s</span>
    </>
  );
}

export function SettingsPage({ toast }: { toast: PushFn }) {
  const [base, setBase] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [systemDir, setSystemDir] = useState<string>("");
  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  const [vlc, setVlc] = useState<VlcStatus | null>(null);
  const [ratioMode, setRatioMode] = useState<"unlimited" | "1" | "2" | "custom">("unlimited");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const displayDir = draft?.downloadDir ?? systemDir;

  function loadSettings() {
    setLoadError(null);
    return getSettings()
      .then(async (s) => {
        const dir = s.downloadDir ?? (await defaultDownloadDir().catch(() => ""));
        setSystemDir(dir);
        setBase(s);
        setDraft(s);
        setRatioMode(s.stopRatio == null ? "unlimited" : s.stopRatio === 1 ? "1" : s.stopRatio === 2 ? "2" : "custom");
      })
      .catch((e) => {
        setLoadError(errMsg(e));
        toast("error", "Could not load settings", errMsg(e));
      });
  }

  useEffect(() => {
    void loadSettings();
    vlcStatus().then(setVlc).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFreeSpace(null);
    diskFreeBytes(displayDir || undefined)
      .then((bytes) => { if (!cancelled) setFreeSpace(bytes); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [displayDir]);

  const dirty = base != null && draft != null && JSON.stringify(base) !== JSON.stringify(draft);
  const patch = (p: Partial<Settings>) => setDraft((d) => (d == null ? d : { ...d, ...p }));

  const vlcResolved = useMemo(
    () => (vlc?.found ? (vlc.path ?? "") : "") || draft?.vlcPath || "",
    [vlc, draft],
  );
  const vlcMissing = vlc != null && !vlc.found && !draft?.vlcPath;

  async function pickDownloadDir() {
    try {
      const dir = await open({ directory: true });
      if (typeof dir === "string") patch({ downloadDir: dir });
    } catch (e) {
      toast("error", "Could not open folder picker", errMsg(e));
    }
  }

  async function pickVlcExe() {
    try {
      const path = await open({ filters: [{ name: "VLC", extensions: ["exe"] }] });
      if (typeof path === "string") patch({ vlcPath: path });
    } catch (e) {
      toast("error", "Could not open VLC picker", errMsg(e));
    }
  }

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await saveSettingsCmd(draft);
      setBase(draft);
      toast("success", "Settings saved");
      vlcStatus().then(setVlc).catch(() => {});
    } catch (e) {
      toast("error", "Could not save settings", errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[12px] text-ink-3">
        {loadError ? <><p role="alert">Could not load settings: {loadError}</p><button className="btn-secondary" onClick={loadSettings}>Try again</button></> : "Loading settings…"}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] space-y-4 px-6 py-5">
        <Group title="Downloads">
          <Field label="Default download folder" hint={
            freeSpace != null ? `${formatBytes(freeSpace)} free` : "Free space unavailable"
          }>
            <span className="max-w-[280px] truncate text-[11px] text-ink-3" title={displayDir || undefined}>
              {displayDir ? truncMiddle(displayDir, 34) : "System default"}
            </span>
            <button onClick={pickDownloadDir} className="btn-secondary h-7 px-2.5 text-[11px]">
              <FolderOpen size={13} />
              Change
            </button>
          </Field>
          <Field label="Maximum simultaneous downloads">
            <div className="flex items-center gap-1">
              <button
                aria-label="Fewer downloads"
                onClick={() => patch({ maxDownloads: Math.max(1, draft.maxDownloads - 1) })}
                disabled={draft.maxDownloads <= 1}
                className="icon-btn h-7 w-7 border border-hairline"
              >
                <Minus size={13} />
              </button>
              <span className="w-8 text-center text-[12px] tabular-nums">{draft.maxDownloads}</span>
              <button
                aria-label="More downloads"
                onClick={() => patch({ maxDownloads: Math.min(10, draft.maxDownloads + 1) })}
                disabled={draft.maxDownloads >= 10}
                className="icon-btn h-7 w-7 border border-hairline"
              >
                <Plus size={13} />
              </button>
            </div>
          </Field>
          <Field label="Download speed limit">
            <LimitInput bps={draft.dlLimitBps} onBytes={(v) => patch({ dlLimitBps: v })} />
          </Field>
          <Field label="Upload speed limit">
            <LimitInput bps={draft.ulLimitBps} onBytes={(v) => patch({ ulLimitBps: v })} />
          </Field>
          <Field label="Stop seeding at ratio">
            <select
              value={ratioMode}
              onChange={(e) => {
                const mode = e.target.value as typeof ratioMode;
                setRatioMode(mode);
                patch({ stopRatio: mode === "unlimited" ? null : mode === "custom" ? (draft.stopRatio ?? 1.5) : Number(mode) });
              }}
              className="input w-32 cursor-default"
            >
              <option value="unlimited">Unlimited</option>
              <option value="1">1.0x</option>
              <option value="2">2.0x</option>
              <option value="custom">Custom…</option>
            </select>
            {ratioMode === "custom" && (
              <input
                type="number"
                min={0}
                step={0.1}
                value={draft.stopRatio ?? ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  // empty or negative means no limit, and the field shows exactly what will be saved
                  patch({ stopRatio: e.target.value === "" || !(n >= 0) ? null : n });
                }}
                className="input w-16 text-right tabular-nums"
              />
            )}
          </Field>
        </Group>

        <Group title="Playback">
          {vlcMissing ? (
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="flex items-center gap-2 text-[12px] text-danger">
                <TriangleAlert size={15} />
                VLC was not found.
              </span>
              <span className="flex gap-2">
                <button onClick={() => openUrl(VLC_URL)} className="btn-secondary h-7 px-2.5 text-[11px]">
                  Install VLC
                </button>
                <button onClick={pickVlcExe} className="btn-secondary h-7 px-2.5 text-[11px]">
                  Choose VLC manually
                </button>
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="flex min-w-0 items-center gap-2 text-[12px] text-ink-2">
                <CheckCircle2 size={15} className="shrink-0 text-accent" />
                <span className="truncate" title={vlcResolved}>
                  {vlcResolved ? truncMiddle(vlcResolved, 44) : "Using bundled lookup"}
                </span>
              </span>
              <button onClick={pickVlcExe} className="btn-secondary h-7 shrink-0 px-2.5 text-[11px]">
                Change
              </button>
            </div>
          )}
        </Group>

        <Group title="Behavior">
          <Field label="Start with Windows">
            <Toggle checked={draft.startWithWindows} onChange={(v) => patch({ startWithWindows: v })} label="Start with Windows" />
          </Field>
          <Field label="Start minimized">
            <Toggle checked={draft.startMinimized} onChange={(v) => patch({ startMinimized: v })} label="Start minimized" />
          </Field>
          <Field label="Minimize to system tray" hint="Closing the window keeps TorrentFlow running in the tray.">
            <Toggle checked={draft.minimizeToTray} onChange={(v) => patch({ minimizeToTray: v })} label="Minimize to system tray" />
          </Field>
          <Field label="Desktop notifications">
            <Toggle checked={draft.notifications} onChange={(v) => patch({ notifications: v })} label="Desktop notifications" />
          </Field>
          <Field label="Prevent sleep while downloading or streaming">
            <Toggle checked={draft.preventSleep} onChange={(v) => patch({ preventSleep: v })} label="Prevent sleep while downloading" />
          </Field>
          <Field label="Automatically resume unfinished torrents" hint="Applied when the app starts.">
            <Toggle checked={draft.autoResume} onChange={(v) => patch({ autoResume: v })} label="Automatically resume unfinished torrents" />
          </Field>
        </Group>

        <Group title="Integrations">
          <Field label="Associate .torrent files">
            <Toggle checked={draft.assocTorrent} onChange={(v) => patch({ assocTorrent: v })} label="Associate .torrent files" />
          </Field>
          <Field label="Handle magnet links">
            <Toggle checked={draft.assocMagnet} onChange={(v) => patch({ assocMagnet: v })} label="Handle magnet links" />
          </Field>
        </Group>
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-10 mt-2 border-t border-hairline bg-panel-2 px-6 py-3">
          <div className="mx-auto flex max-w-[720px] items-center justify-end gap-2">
            <button
              onClick={() => {
                if (base) {
                  setDraft(base);
                  setRatioMode(base.stopRatio == null ? "unlimited" : base.stopRatio === 1 ? "1" : base.stopRatio === 2 ? "2" : "custom");
                }
              }}
              disabled={saving}
              className="btn-ghost"
            >
              Discard
            </button>
            <button onClick={save} disabled={saving} className="btn-primary">
              Save changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
