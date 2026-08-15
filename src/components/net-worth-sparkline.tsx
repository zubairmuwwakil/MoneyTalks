"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
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
    <div className="h-24 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            formatter={(value) => [formatNetWorthTooltip(Number(value), currency), "Net worth"]}
            labelFormatter={(label) => String(label)}
          />
          <Line type="monotone" dataKey="totalMinor" dot={false} strokeWidth={2} stroke="currentColor" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
