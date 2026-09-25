import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

function Mark() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-accent shadow-[0_0_14px_rgba(34,197,94,0.35)]">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M12.75 4.75H6.25a2.25 2.25 0 0 0 0 4.5h3.5a2.25 2.25 0 0 1 0 4.5H3.25"
          stroke="#0B0C0E"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <path
          d="M10.5 2.5l2.25 2.25L10.5 7"
          stroke="#0B0C0E"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M5.5 9.5L3.25 11.75 5.5 14"
          stroke="#0B0C0E"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function TitleBar() {
  // getCurrentWindow() returns a new object per call; keep one so the effect runs once
  const [win] = useState(getCurrentWindow);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    win.isMaximized().then((m) => alive && setMaximized(m));
    const unP = win.onResized(async () => {
      const m = await win.isMaximized();
      if (alive) setMaximized(m);
    });
    return () => {
      alive = false;
      unP.then((u) => u());
    };
  }, [win]);

  return (
    <header className="relative flex h-10 shrink-0 items-center justify-between border-b border-hairline bg-page">
      <div
        className="absolute inset-0"
        onMouseDown={(e) => {
          if (e.button === 0 && e.detail === 1) win.startDragging();
        }}
        onDoubleClick={() => win.toggleMaximize()}
      />
      <div className="pointer-events-none relative z-10 flex items-center gap-2.5 pl-3.5">
        <Mark />
        <span className="text-[13px] font-semibold tracking-tight text-ink">TorrentFlow</span>
      </div>
      <div className="relative z-10 flex items-stretch">
        <button aria-label="Minimize" onClick={() => win.minimize()} className="flex h-10 w-11 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-white/[0.08] hover:text-ink">
          <Minus size={15} />
        </button>
        <button aria-label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()} className="flex h-10 w-11 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-white/[0.08] hover:text-ink">
          {maximized ? <Copy size={13} /> : <Square size={13} />}
        </button>
        <button aria-label="Close" onClick={() => win.close()} className="flex h-10 w-11 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-danger hover:text-white">
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
