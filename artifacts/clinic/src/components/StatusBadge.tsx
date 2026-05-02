import { cn } from "@/lib/utils";

interface Props {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className }: Props) {
  const label = status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span
      className={cn(
        `status-${status}`,
        "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium capitalize",
        className
      )}
      data-testid={`status-${status}`}
    >
      {label}
    </span>
  );
}
