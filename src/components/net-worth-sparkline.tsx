"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";

export function NetWorthSparkline({ data }: { data: Array<{ date: string; totalMinor: number }> }) {
  if (data.length === 0) return null;
  return (
    <div className="h-24 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            formatter={(value) => [`$${(Number(value) / 100).toLocaleString("en-CA")}`, "Net worth"]}
            labelFormatter={(label) => String(label)}
          />
          <Line type="monotone" dataKey="totalMinor" dot={false} strokeWidth={2} stroke="currentColor" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
