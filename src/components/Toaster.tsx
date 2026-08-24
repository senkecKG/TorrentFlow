import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export type ToastKind = "info" | "success" | "warn" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message: string;
}

type PushFn = (kind: ToastKind, title: string, message?: string) => void;

const ToastCtx = createContext<PushFn>(() => {});

export const useToast = () => useContext(ToastCtx);

const ACCENT: Record<ToastKind, string> = {
  info: "bg-ink-3",
  success: "bg-accent",
  warn: "bg-warn",
  error: "bg-danger",
};

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback<PushFn>((kind, title, message = "") => {
    const id = ++seq;
    setToasts((t) => [...t.slice(-3), { id, kind, title, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-3 bottom-9 z-[70] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex animate-pop-in overflow-hidden rounded-md border border-hairline bg-panel-2 shadow-xl shadow-black/50"
          >
            <div className={`w-1 shrink-0 ${ACCENT[t.kind]}`} />
            <div className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-ink">{t.title}</div>
                {t.message && (
                  <div className="mt-0.5 line-clamp-2 text-[11px] break-words text-ink-2">{t.message}</div>
                )}
              </div>
              <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="icon-btn -mt-1 -mr-1 h-6 w-6">
                <X size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
