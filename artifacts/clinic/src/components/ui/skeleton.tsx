import { cn } from "@/lib/utils"

/** Base shimmer skeleton primitive. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skel-line", className)}
      {...props}
    />
  );
}

/** A skeleton row with optional avatar circle + N content lines. */
function SkeletonRow({ avatar = true, cols = 3 }: { avatar?: boolean; cols?: number }) {
  return (
    <div className="skel-row">
      {avatar && <div className="skel-circle" />}
      <div className="flex-1 flex flex-col gap-2">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className={cn("skel-line", i === 0 ? "t" : "")} style={{ width: i === 0 ? "60%" : `${40 + i * 15}%` }} />
        ))}
      </div>
    </div>
  );
}

/** A skeleton KPI/metric card. */
function SkeletonMetric() {
  return (
    <div className="skel-metric">
      <div className="skel-line" style={{ width: "45%" }} />
      <div className="skel-line h" style={{ width: "55%" }} />
      <div className="skel-line" style={{ width: "35%" }} />
    </div>
  );
}

/** A skeleton card with N rows. */
function SkeletonCard({ rows = 4, header = true }: { rows?: number; header?: boolean }) {
  return (
    <div className="card">
      {header && (
        <div className="card-pad border-b border-[var(--line-soft)] flex items-center gap-3">
          <div className="skel-line t" style={{ width: "30%" }} />
          <div className="spacer" />
          <div className="skel-line" style={{ width: "80px" }} />
        </div>
      )}
      <div className="skel-stack p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow key={i} avatar={i === 0} />
        ))}
      </div>
    </div>
  );
}

export { Skeleton, SkeletonRow, SkeletonMetric, SkeletonCard }
