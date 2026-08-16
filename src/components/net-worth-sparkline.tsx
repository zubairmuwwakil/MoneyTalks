"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { formatMinorUnits, type Currency } from "@/engine/money";

export function formatNetWorthTooltip(totalMinor: number, currency: Currency): string {
  return formatMinorUnits(totalMinor, currency);
}

export function NetWorthSparkline({
  data,
  currency,
}: {
  data: Array<{ date: string; totalMinor: number }>;
  currency: Currency;
}) {
  if (data.length === 0) return null;

  return (
    <div className="mt-4 h-28 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="currentColor" stopOpacity={0.25} />
              <stop offset="95%" stopColor="currentColor" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin - 100", "dataMax + 100"]} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="rounded-lg border border-border/80 bg-background/95 p-2 shadow-md backdrop-blur-xs text-xs">
                    <p className="font-medium text-muted-foreground">{String(label)}</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                      {formatNetWorthTooltip(Number(payload[0].value), currency)}
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Area
            type="monotone"
            dataKey="totalMinor"
            stroke="currentColor"
            strokeWidth={2.2}
            fill="url(#netWorthGradient)"
            dot={false}
            activeDot={{ r: 4, fill: "currentColor", stroke: "var(--background)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
