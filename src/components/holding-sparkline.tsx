import { useId } from "react";

interface HoldingSparklineProps {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function HoldingSparkline({
  points,
  width = 64,
  height = 20,
  className = "",
}: HoldingSparklineProps) {
  const gradientId = useId();
  if (!points || points.length < 2) {
    return null;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const padding = 2;
  const innerHeight = height - padding * 2;
  const innerWidth = width - padding * 2;

  const coords = points.map((val, idx) => {
    const x = padding + (idx / (points.length - 1)) * innerWidth;
    const y = padding + innerHeight - ((val - min) / range) * innerHeight;
    return [x, y] as [number, number];
  });

  const polylinePoints = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const isUp = points[points.length - 1] >= points[0];
  const strokeColor = isUp ? "#10b981" : "#ef4444"; // emerald-500 or red-500

  // Area path for gradient fill under the curve
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPath = `M ${first[0]},${height - padding} L ${coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L ")} L ${last[0]},${height - padding} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`overflow-visible inline-block shrink-0 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity={0.0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polylinePoints}
      />
    </svg>
  );
}
