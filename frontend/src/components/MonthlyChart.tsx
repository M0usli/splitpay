"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { StatsSummary } from "@/lib/api";
import { CHART_AXIS, CHART_GRID, CHART_TEXT, SERIES_COLOR } from "@/lib/chart-colors";
import { formatMoney, formatMonth } from "@/lib/format";

type MonthlyChartProps = {
  months: StatsSummary["monthly_totals"];
  currency: string;
};

/** "$1,250" for axis ticks and bar labels: whole dollars keep them short. */
function formatWholeDollars(value: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

/** A bar for each of the last six months. */
export default function MonthlyChart({ months, currency }: MonthlyChartProps) {
  const bars = months.map((entry) => ({
    month: entry.month,
    label: formatMonth(entry.month, "short"),
    total: Number(entry.total),
  }));

  return (
    <div
      role="img"
      aria-label={
        "Bar chart of total spending per month: " +
        months
          .map((entry) => `${formatMonth(entry.month)} ${formatMoney(entry.total, currency)}`)
          .join(", ")
      }
      className="h-64 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_GRID} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: CHART_AXIS }}
            tick={{ fill: CHART_TEXT, fontSize: 12 }}
          />
          <YAxis
            width={56}
            tickLine={false}
            axisLine={false}
            tick={{ fill: CHART_TEXT, fontSize: 12 }}
            tickFormatter={(value: number) => formatWholeDollars(value, currency)}
          />
          <Tooltip
            cursor={{ fill: "#f4f4f5" }}
            formatter={(value) => [formatMoney(String(value), currency), "Total"]}
          />
          <Bar
            dataKey="total"
            fill={SERIES_COLOR}
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="total"
              position="top"
              fontSize={12}
              fill="#3f3f46"
              formatter={(value) => (Number(value) > 0 ? formatWholeDollars(Number(value), currency) : "")}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
