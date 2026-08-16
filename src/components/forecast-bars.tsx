"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMinorUnits, type Currency } from "@/engine/money";

export function formatForecastTooltip(totalMinor: number, currency: Currency): string {
  return formatMinorUnits(totalMinor, currency);
}

export function ForecastBars({
  data,
  currency,
}: {
  data: Array<{ month: string; totalMinor: number }>;
  currency: Currency;
}) {
  if (data.length === 0) return null;

  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis hide domain={[0, "auto"]} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="rounded-lg border border-border/80 bg-background/95 p-2.5 shadow-md backdrop-blur-xs text-xs">
                    <p className="font-medium text-muted-foreground">{String(label)}</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                      {formatForecastTooltip(Number(payload[0].value), currency)}
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar
            dataKey="totalMinor"
            fill="currentColor"
            radius={[6, 6, 0, 0]}
            maxBarSize={40}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
