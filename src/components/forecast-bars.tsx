"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
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
    <div className="h-40 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={1} />
          <Tooltip
            formatter={(value) => [formatForecastTooltip(Number(value), currency), "Total"]}
            labelFormatter={(label) => String(label)}
          />
          <Bar dataKey="totalMinor" fill="currentColor" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
