export type ProgressVariant = "normal" | "paused" | "error" | "seeding" | "queued";

const FILL: Record<ProgressVariant, string> = {
  normal: "bg-accent",
  paused: "bg-[#565b63]",
  error: "bg-danger",
  seeding: "bg-accent/50",
  queued: "bg-accent animate-pulse-soft",
};

export function ProgressBar({ value, variant }: { value: number; variant: ProgressVariant }) {
  const v = Math.min(1, Math.max(0, value));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${FILL[variant]}`}
        style={{ width: `${v * 100}%` }}
      />
    </div>
  );
}
