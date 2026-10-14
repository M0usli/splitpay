"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import CategoryChart from "@/components/CategoryChart";
import MonthlyChart from "@/components/MonthlyChart";
import TopMerchants from "@/components/TopMerchants";
import { getStatsSummary, type StatsSummary } from "@/lib/api";
import { currentMonth, formatMoney, formatMonth } from "@/lib/format";

type Status =
  | { state: "loading" }
  | { state: "loaded"; summary: StatsSummary }
  | { state: "error"; message: string };

/** A titled white box. `children` is whatever is placed between its tags. */
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-zinc-700">{title}</h2>
      {children}
    </section>
  );
}

/** "$12.40 more than September 2026", comparing the last two bars of the trend. */
function describeChange(summary: StatsSummary): string {
  const months = summary.monthly_totals;
  const previous = months[months.length - 2];
  const differenceCents =
    Math.round(Number(summary.month_total) * 100) - Math.round(Number(previous.total) * 100);
  if (differenceCents === 0) {
    return `Same as ${formatMonth(previous.month)}`;
  }
  const amount = formatMoney((Math.abs(differenceCents) / 100).toFixed(2), summary.currency);
  return `${amount} ${differenceCents > 0 ? "more" : "less"} than ${formatMonth(previous.month)}`;
}

/** The month `step` months after "YYYY-MM": shiftMonth("2026-01", -1) is "2025-12". */
export function shiftMonth(month: string, step: number): string {
  const [year, number] = month.split("-").map(Number);
  // Months counted from year 0 make carrying over the year simple arithmetic.
  const total = year * 12 + (number - 1) + step;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

const stepButtonClass =
  "flex h-10 w-10 items-center justify-center rounded-full border border-zinc-300 bg-white " +
  "text-lg hover:bg-zinc-100 disabled:opacity-40";

export default function Dashboard() {
  // null means "the current month". It is only worked out in the browser,
  // inside the effect, because the server does not know the user's time zone.
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    let isCurrent = true;

    getStatsSummary(selectedMonth ?? currentMonth())
      .then((summary) => {
        if (isCurrent) {
          setStatus({ state: "loaded", summary });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          const message = error instanceof Error ? error.message : "Something went wrong";
          setStatus({ state: "error", message });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedMonth]);

  if (status.state === "loading") {
    return <p className="text-zinc-500">Loading dashboard…</p>;
  }

  if (status.state === "error") {
    return (
      <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
        {status.message}
      </p>
    );
  }

  const { summary } = status;
  const monthName = formatMonth(summary.month);
  const hasSpendingThisMonth = summary.expense_count > 0;
  const hasAnySpending = summary.top_merchants.length > 0;
  // Worked out here, in the browser: this part only shows after the data has loaded.
  const thisMonth = currentMonth();
  const isThisMonth = summary.month === thisMonth;

  return (
    <div className="space-y-6">
      {/* Arrows step one month at a time, so no date has to be typed. */}
      <div role="group" aria-label="Month" className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setSelectedMonth(shiftMonth(summary.month, -1))}
          className={stepButtonClass}
        >
          ‹
        </button>
        <p className="min-w-36 text-center font-semibold">{monthName}</p>
        <button
          type="button"
          aria-label="Next month"
          disabled={isThisMonth}
          onClick={() => setSelectedMonth(shiftMonth(summary.month, 1))}
          className={stepButtonClass}
        >
          ›
        </button>
        {!isThisMonth && (
          <button
            type="button"
            onClick={() => setSelectedMonth(null)}
            className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium hover:border-emerald-400"
          >
            This month
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* The same green card as the Wallet: the one number this page is about. */}
        <section className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white shadow-lg sm:col-span-2">
          <h2 className="text-sm font-medium text-emerald-100">Spent in {monthName}</h2>
          <p className="mt-1 text-5xl font-semibold tracking-tight">
            {formatMoney(summary.month_total, summary.currency)}
          </p>
          <p className="mt-2 text-sm text-emerald-100">{describeChange(summary)}</p>
        </section>
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm text-zinc-600">Expenses in {monthName}</h2>
          <p className="mt-1 text-3xl font-semibold tracking-tight">{summary.expense_count}</p>
          <Link
            href="/expenses"
            className="mt-2 inline-block text-sm text-zinc-500 underline hover:text-zinc-900"
          >
            View all expenses
          </Link>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Spending by category, ${monthName}`}>
          {hasSpendingThisMonth ? (
            <CategoryChart
              categories={summary.by_category}
              monthTotal={summary.month_total}
              currency={summary.currency}
            />
          ) : (
            <p className="text-sm text-zinc-600">No expenses in {monthName}.</p>
          )}
        </Card>

        <Card title="Total per month, last 6 months">
          {hasAnySpending ? (
            <MonthlyChart months={summary.monthly_totals} currency={summary.currency} />
          ) : (
            <p className="text-sm text-zinc-600">No expenses in the last 6 months.</p>
          )}
        </Card>
      </div>

      <Card title="Top merchants, last 6 months">
        {hasAnySpending ? (
          <TopMerchants merchants={summary.top_merchants} currency={summary.currency} />
        ) : (
          <p className="text-sm text-zinc-600">
            No expenses in the last 6 months.{" "}
            <Link href="/upload" className="font-medium underline">
              Upload a receipt
            </Link>{" "}
            to get started.
          </p>
        )}
      </Card>
    </div>
  );
}
