import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

function Mark() {
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-[5px] bg-accent">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M2 1.2v5.6L6.6 4 2 1.2Z" fill="#0B0C0E" />
      </svg>
    </span>
  );
}

export function TitleBar() {
  const win = getCurrentWindow();
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
    <header className="relative flex h-8 shrink-0 items-center justify-between bg-page">
      <div
        className="absolute inset-0"
        data-tauri-drag-region
        onDoubleClick={() => win.toggleMaximize()}
      />
      <div className="pointer-events-none relative z-10 flex items-center gap-2 pl-3">
        <Mark />
        <span className="text-[12px] font-semibold text-ink">TorrentFlow</span>
      </div>
      <div className="relative z-10 flex items-stretch">
        <button aria-label="Minimize" onClick={() => win.minimize()} className="flex h-8 w-10 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-white/[0.08] hover:text-ink">
          <Minus size={14} />
        </button>
        <button aria-label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()} className="flex h-8 w-10 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-white/[0.08] hover:text-ink">
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button aria-label="Close" onClick={() => win.close()} className="flex h-8 w-10 items-center justify-center text-ink-2 transition-colors duration-150 hover:bg-danger hover:text-white">
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
