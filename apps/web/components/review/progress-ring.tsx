/**
 * The right-rail progress ring (§9): "7/12" answered, drawn as an SVG donut.
 * `value`/`total` drive the arc; the center shows the raw count so the number
 * is legible even when the arc is small.
 */
export function ProgressRing({
  value,
  total,
  size = 72,
}: {
  value: number;
  total: number;
  size?: number;
}) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? value / total : 0;
  const dash = circumference * fraction;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          className="transition-[stroke-dasharray] duration-300"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-semibold leading-none tabular-nums">
          {value}/{total}
        </span>
        <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">done</span>
      </div>
    </div>
  );
}
