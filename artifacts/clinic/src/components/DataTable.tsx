import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks/i18n";

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
  density?: "comfortable" | "compact";
}

export default function DataTable<T>({ columns, data, isLoading, emptyMessage, onRowClick, rowClassName, expandedRow, density = "comfortable" }: Props<T>) {
  const { t } = useI18n();
  const cellPad = density === "compact" ? "px-3 py-1.5" : "px-4 py-2.5";
  const headPad = density === "compact" ? "px-3 py-1.5" : "px-4 py-2.5";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        {t("loading")}
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        {emptyMessage || t("noData")}
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
                className={cn(headPad, "text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide", col.className)}
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
                    <td key={col.key} className={cn(cellPad, "text-foreground", col.className)}>
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
