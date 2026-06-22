// Shared doctor avatar (colored initials) used by the Schedule day-dashboard
// and the weekly-template editor so both read consistently.

// Distinct, always-defined accent colors. teal is the palette-accent and shifts
// per [data-palette]; the rest are fixed across palettes.
const DOCTOR_COLORS = [
  "var(--teal-600)", "var(--blue-500)", "var(--rose-500)",
  "var(--amber-500)", "var(--sage-500)", "var(--sand-500)",
];

export const doctorColor = (id: number) => DOCTOR_COLORS[Math.abs(id) % DOCTOR_COLORS.length];

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";

export function DoctorAvatar({ id, name, size = 32 }: { id: number; name: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold flex-shrink-0"
      style={{ background: doctorColor(id), width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  );
}
