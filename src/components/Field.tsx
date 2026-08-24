import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 py-1">
      <div className="min-w-0 shrink-0 text-[12px] text-ink-2">
        {label}
        {hint && <div className="mt-0.5 text-[11px] text-ink-3">{hint}</div>}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">{children}</div>
    </div>
  );
}
