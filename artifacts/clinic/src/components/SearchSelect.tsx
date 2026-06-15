import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

export interface SearchSelectOption {
  value: string;
  label: string;
  /** Extra text matched while searching (e.g. an MRN). Optional. */
  search?: string;
}

interface SearchSelectProps {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

/**
 * A searchable single-select combobox (shadcn Command + Popover). Drop-in
 * replacement for a plain <Select> when the option list is long enough to want
 * a type-to-filter search box. Filtering is a case-insensitive substring match
 * over `label` + `search`, so e.g. a patient is findable by name OR MRN.
 */
export default function SearchSelect({
  options, value, onChange, placeholder, searchPlaceholder, emptyText, disabled,
  "data-testid": testId,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50",
            !selected && "text-[var(--ink-muted)]",
          )}
        >
          <span className="truncate text-start">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map(o => (
                <CommandItem
                  // cmdk filters on this string; appending `value` keeps it
                  // unique even if two labels collide. onSelect's arg is
                  // lowercased by cmdk, so we close over `o.value` instead.
                  key={o.value}
                  value={`${o.label} ${o.search ?? ""} ${o.value}`}
                  onSelect={() => { onChange(o.value); setOpen(false); }}
                >
                  <Check className={cn("me-2 h-4 w-4 shrink-0", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
