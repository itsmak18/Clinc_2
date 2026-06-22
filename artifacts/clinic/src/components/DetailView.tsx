/**
 * DetailView — small presentational primitives for read-only "view all information"
 * detail panels (Medical Records, Prescriptions, Operations …). Label/value rows
 * grouped into titled sections. RTL-safe: no directional classes, alignment inherits
 * from the document `dir`.
 */
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DetailSection({ title, action, children, className }: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2">
          {title && <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function DetailGrid({ children, cols = 2, className }: {
  children: ReactNode;
  cols?: 1 | 2 | 3;
  className?: string;
}) {
  const colClass = cols === 1 ? "grid-cols-1" : cols === 3 ? "grid-cols-3" : "grid-cols-2";
  return <div className={cn("grid gap-x-4 gap-y-3", colClass, className)}>{children}</div>;
}

export function DetailField({ label, value, secondary, mono, full, className }: {
  label: string;
  value: ReactNode;
  /** Optional secondary line under the value, e.g. an Arabic translation (rendered RTL). */
  secondary?: ReactNode;
  mono?: boolean;
  /** Span the full width of the grid. */
  full?: boolean;
  className?: string;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={cn(full && "col-span-full", className)}>
      <div className="text-[11px] text-[var(--ink-muted)] mb-0.5">{label}</div>
      <div className={cn("text-[13px] whitespace-pre-wrap break-words", mono && "font-mono", empty ? "text-[var(--ink-faint)]" : "text-[var(--ink)]")}>
        {empty ? "—" : value}
      </div>
      {!empty && secondary != null && secondary !== "" && (
        <div className="text-[12px] text-[var(--ink-soft)] mt-0.5 whitespace-pre-wrap break-words" dir="rtl">{secondary}</div>
      )}
    </div>
  );
}
