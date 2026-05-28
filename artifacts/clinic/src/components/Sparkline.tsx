import { useState } from "react";
import { cn } from "@/lib/utils";

type Tone = "teal" | "sage" | "sand" | "rose" | "amber" | "blue";

const TONE_COLORS: Record<Tone, string> = {
  teal:  "var(--teal-500)",
  sage:  "var(--sage-500)",
  sand:  "var(--sand-500)",
  rose:  "var(--rose-500)",
  amber: "var(--amber-500)",
  blue:  "var(--blue-500)",
};

const TONE_FILL: Record<Tone, string> = {
  teal:  "var(--teal-100)",
  sage:  "var(--sage-200)",
  sand:  "var(--sand-100)",
  rose:  "var(--rose-300)",
  amber: "var(--amber-50)",
  blue:  "var(--blue-50)",
};

interface SparklineProps {
  data: number[];
  tone?: Tone;
  width?: number;
  height?: number;
  className?: string;
}

export default function Sparkline({ data, tone = "teal", width = 72, height = 28, className }: SparklineProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - ((v - min) / range) * (height - 4) - 2,
  ] as [number, number]);

  const linePath = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const fillPath = `${linePath} L${pts[pts.length - 1][0]},${height} L${pts[0][0]},${height} Z`;

  const latest = data[data.length - 1];
  const ariaLabel = `min ${min}, max ${max}, latest ${latest}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-label={ariaLabel}
      role="img"
      onMouseLeave={() => setHoveredIdx(null)}
    >
      <path d={fillPath} fill={TONE_FILL[tone]} opacity="0.5" />
      <path d={linePath} fill="none" stroke={TONE_COLORS[tone]} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x} cy={y} r={hoveredIdx === i ? 3.5 : 0}
          fill={TONE_COLORS[tone]}
          onMouseEnter={() => setHoveredIdx(i)}
          style={{ cursor: "default" }}
        />
      ))}
      {hoveredIdx !== null && (
        <text
          x={pts[hoveredIdx][0]}
          y={pts[hoveredIdx][1] - 6}
          textAnchor="middle"
          fontSize="9"
          fill={TONE_COLORS[tone]}
          fontFamily="var(--font-mono)"
        >
          {data[hoveredIdx]}
        </text>
      )}
    </svg>
  );
}
