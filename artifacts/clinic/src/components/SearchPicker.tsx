import { useState, useRef, useEffect, useId } from "react";
import { cn } from "@/lib/utils";
import { Search, X } from "lucide-react";

export interface SearchPickerOption {
  id: number | string;
  label: string;
  sublabel?: string;
  initials?: string;
  tone?: "teal" | "sage" | "sand" | "rose" | "amber" | "blue";
}

interface SearchPickerProps {
  options: SearchPickerOption[];
  value?: SearchPickerOption | null;
  onChange: (opt: SearchPickerOption | null) => void;
  placeholder?: string;
  size?: "md" | "sm";
  className?: string;
  disabled?: boolean;
}

function matchOption(opt: SearchPickerOption, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    opt.label.toLowerCase().includes(q) ||
    (opt.sublabel?.toLowerCase().includes(q) ?? false) ||
    String(opt.id).includes(q)
  );
}

export default function SearchPicker({ options, value, onChange, placeholder = "Search…", size = "md", className, disabled }: SearchPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const filtered = options.filter(o => matchOption(o, query)).slice(0, 20);

  useEffect(() => { setActiveIdx(0); }, [query]);

  const select = (opt: SearchPickerOption) => {
    onChange(opt);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const clear = () => { onChange(null); setQuery(""); inputRef.current?.focus(); };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && filtered[activeIdx]) { e.preventDefault(); select(filtered[activeIdx]); }
    if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const el = document.getElementById(id);
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, id]);

  const h = size === "sm" ? "h-9" : "h-11";

  return (
    <div id={id} className={cn("relative", className)}>
      {value ? (
        <div className={cn("input flex items-center gap-2 cursor-pointer", h)} onClick={() => !disabled && clear()}>
          {value.initials && (
            <span className={cn("avatar avatar-sm", value.tone ? `avatar-${value.tone}` : "")}>{value.initials}</span>
          )}
          <span className="flex-1 truncate text-[13px]">{value.label}</span>
          {!disabled && <X className="w-3.5 h-3.5 opacity-40 hover:opacity-100 flex-shrink-0" />}
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--ink-faint)] pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            className={cn("input ps-8", h)}
            placeholder={placeholder}
            value={query}
            disabled={disabled}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKey}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            role="combobox"
          />
        </div>
      )}

      {open && !value && filtered.length > 0 && (
        <ul
          id={`${id}-list`}
          ref={listRef}
          role="listbox"
          className="card absolute z-50 mt-1 w-full max-h-64 overflow-auto py-1"
          style={{ boxShadow: "var(--shadow)" }}
        >
          {filtered.map((opt, i) => (
            <li
              key={opt.id}
              role="option"
              aria-selected={i === activeIdx}
              className={cn(
                "flex items-center gap-2 px-3 py-2 cursor-pointer text-[13px] transition-colors",
                i === activeIdx ? "bg-[var(--teal-50)] text-[var(--teal-700)]" : "hover:bg-[var(--surface-2)]"
              )}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={e => { e.preventDefault(); select(opt); }}
            >
              {opt.initials && (
                <span className={cn("avatar avatar-sm flex-shrink-0", opt.tone ? `avatar-${opt.tone}` : "")}>{opt.initials}</span>
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{opt.label}</div>
                {opt.sublabel && <div className="truncate text-[11px] text-[var(--ink-muted)]">{opt.sublabel}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
