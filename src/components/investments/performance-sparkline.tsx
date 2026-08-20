"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

export function PerformanceSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const rising = values.at(-1)! >= values[0];
  const data = values.map((value, index) => ({ index, value }));

  return (
    <div className="h-8 w-20" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={rising ? "#059669" : "#e11d48"}
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
