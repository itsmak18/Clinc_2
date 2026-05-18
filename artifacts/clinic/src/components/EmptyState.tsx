import { type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { InboxIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  className?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon: Icon = InboxIcon, title, description, className, action }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-10 text-center", className)}>
      <Icon className="w-8 h-8 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground/70 max-w-xs">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
