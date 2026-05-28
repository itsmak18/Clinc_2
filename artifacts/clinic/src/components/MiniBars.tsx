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
  rose:  "var(--rose-50)",
  amber: "var(--amber-50)",
  blue:  "var(--blue-50)",
};

interface MiniBarsProps {
  data: number[];
  labels?: string[];
  tone?: Tone;
  height?: number;
  className?: string;
}

export default function MiniBars({ data, labels, tone = "teal", height = 32, className }: MiniBarsProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) return null;

  const max = Math.max(...data) || 1;
  const barW = 8;
  const gap = 3;
  const width = data.length * (barW + gap) - gap;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-label={`Bar chart: ${data.join(", ")}`}
      role="img"
      onMouseLeave={() => setHoveredIdx(null)}
    >
      {data.map((v, i) => {
        const barH = Math.max(2, (v / max) * (height - 2));
        const x = i * (barW + gap);
        const y = height - barH;
        const isHovered = hoveredIdx === i;
        return (
          <g key={i} onMouseEnter={() => setHoveredIdx(i)}>
            <rect
              x={x} y={y}
              width={barW} height={barH}
              rx="2"
              fill={isHovered ? TONE_COLORS[tone] : TONE_FILL[tone]}
              stroke={TONE_COLORS[tone]}
              strokeWidth="0.8"
              style={{ cursor: "default", transition: "fill .1s" }}
            />
            {isHovered && (
              <text
                x={x + barW / 2} y={y - 4}
                textAnchor="middle"
                fontSize="8"
                fill={TONE_COLORS[tone]}
                fontFamily="var(--font-mono)"
              >
                {labels ? labels[i] : v}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
