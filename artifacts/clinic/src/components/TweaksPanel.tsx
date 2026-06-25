import { cn } from "@/lib/utils";
import { Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTweaks, type Palette, type Voice, type Density } from "@/hooks/useTweaks";
import { useI18n } from "@/hooks/i18n";

type ChipOpt<T> = { value: T; label: string };

const PALETTES: ChipOpt<Palette>[] = [
  { value: "mint",   label: "Mint" },
  { value: "sage",   label: "Sage" },
  { value: "plum",   label: "Plum" },
  { value: "indigo", label: "Indigo" },
];

const VOICES: ChipOpt<Voice>[] = [
  { value: "editorial", label: "Editorial" },
  { value: "modern",    label: "Modern" },
  { value: "classical", label: "Classical" },
];

const DENSITIES: ChipOpt<Density>[] = [
  { value: "compact",     label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "spacious",    label: "Spacious" },
];

function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ChipOpt<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="eyebrow text-[10px] text-[var(--ink-muted)] mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer",
              opt.value === value
                ? "bg-[var(--teal-100)] text-[var(--teal-700)] border-[var(--teal-200)]"
                : "bg-[var(--surface-2)] text-[var(--ink-soft)] border-[var(--line)] hover:border-[var(--teal-200)] hover:text-[var(--teal-700)]"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TweaksPanel() {
  const { tweaks, setTweaks } = useTweaks();
  const { t } = useI18n();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
          aria-label={t("appearance")}
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-64 p-4 space-y-4 border-[var(--line)] bg-[var(--bg)]"
        style={{ boxShadow: "var(--shadow-lg)" }}
      >
        <p className="text-[13px] font-semibold text-[var(--ink)]">{t("appearance")}</p>
        <ChipGroup
          label={t("paletteLabel")}
          options={PALETTES}
          value={tweaks.palette}
          onChange={palette => setTweaks({ palette })}
        />
        <ChipGroup
          label={t("typeVoiceLabel")}
          options={VOICES}
          value={tweaks.voice}
          onChange={voice => setTweaks({ voice })}
        />
        <ChipGroup
          label={t("densityLabel")}
          options={DENSITIES}
          value={tweaks.density}
          onChange={density => setTweaks({ density })}
        />
      </PopoverContent>
    </Popover>
  );
}
