import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  expandedRow?: (row: T) => ReactNode | null | undefined;
}

export default function DataTable<T>({ columns, data, isLoading, emptyMessage, onRowClick, rowClassName, expandedRow }: Props<T>) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        {emptyMessage || "No data found"}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {columns.map(col => (
              <th
                key={col.key}
                className={cn("px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide", col.className)}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const expanded = expandedRow?.(row);
            return (
              <>
                <tr
                  key={i}
                  className={cn(
                    "border-b border-border/50 transition-colors",
                    onRowClick ? "cursor-pointer hover:bg-muted/30" : "",
                    rowClassName?.(row) ?? ""
                  )}
                  onClick={() => onRowClick?.(row)}
                  data-testid={`row-${i}`}
                >
                  {columns.map(col => (
                    <td key={col.key} className={cn("px-4 py-2.5 text-foreground", col.className)}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
                {expanded && (
                  <tr key={`${i}-expanded`} className="bg-muted/10">
                    <td colSpan={columns.length} className="p-0">
                      {expanded}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
