"use client";

import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { StatsSummary } from "@/lib/api";
import { CATEGORY_COLORS, CHART_SURFACE } from "@/lib/chart-colors";
import { formatMoney } from "@/lib/format";

type CategoryChartProps = {
  categories: StatsSummary["by_category"];
  monthTotal: string;
  currency: string;
};

/** A doughnut of spending by category, with a legend that lists every amount. */
export default function CategoryChart({ categories, monthTotal, currency }: CategoryChartProps) {
  // Recharts needs numbers to size the slices. They are only used for
  // drawing; every amount shown as text comes from the original strings.
  const slices = categories.map((entry) => ({
    name: entry.category,
    value: Number(entry.total),
    fill: CATEGORY_COLORS[entry.category],
  }));

  return (
    // Chart beside the legend only when the card is wide enough (tablet width,
    // where the card spans the page). On phones and in the two-column desktop
    // layout the legend goes underneath.
    <div className="flex flex-col items-center gap-6 sm:flex-row lg:flex-col">
      <div
        role="img"
        aria-label="Doughnut chart of spending by category. The same numbers are in the list beside it."
        className="h-52 w-52 shrink-0"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              // A thin gap in the background colour separates the slices.
              stroke={CHART_SURFACE}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Tooltip formatter={(value) => formatMoney(String(value), currency)} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* The legend names each colour and gives its amount and share, so the
          chart never relies on colour alone. */}
      <ul className="w-full min-w-0 flex-1 space-y-2 text-sm">
        {categories.map((entry) => {
          const share = Math.round((Number(entry.total) / Number(monthTotal)) * 100);
          return (
            <li key={entry.category} className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: CATEGORY_COLORS[entry.category] }}
              />
              <span className="flex-1 text-zinc-700">{entry.category}</span>
              <span className="tabular-nums text-zinc-500">{share}%</span>
              <span className="w-24 text-right font-medium tabular-nums">
                {formatMoney(entry.total, currency)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
