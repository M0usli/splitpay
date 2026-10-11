import type { StatsSummary } from "@/lib/api";
import { SERIES_COLOR } from "@/lib/chart-colors";
import { formatMoney } from "@/lib/format";

type TopMerchantsProps = {
  merchants: StatsSummary["top_merchants"];
  currency: string;
};

/** A ranked list. Each bar's length is that merchant's total compared with the biggest one. */
export default function TopMerchants({ merchants, currency }: TopMerchantsProps) {
  const largest = Math.max(...merchants.map((merchant) => Number(merchant.total)));

  return (
    <ol className="space-y-3">
      {merchants.map((merchant) => (
        <li key={merchant.merchant}>
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="font-medium">
              {merchant.merchant.trim()}
              <span className="ml-2 font-normal text-zinc-500">
                {merchant.expense_count} {merchant.expense_count === 1 ? "expense" : "expenses"}
              </span>
            </span>
            <span className="tabular-nums">{formatMoney(merchant.total, currency)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-zinc-100">
            <div
              className="h-2 rounded-full"
              style={{
                width: `${(Number(merchant.total) / largest) * 100}%`,
                backgroundColor: SERIES_COLOR,
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
