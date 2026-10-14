"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import ExpenseFilterBar from "@/components/ExpenseFilterBar";
import ExpenseTable from "@/components/ExpenseTable";
import {
  deleteExpense,
  expensesExportUrl,
  listExpenses,
  type Expense,
  type ExpenseFilters,
} from "@/lib/api";
import { formatMoney, sumAmounts } from "@/lib/format";

type Status =
  | { state: "loading" }
  | { state: "loaded"; expenses: Expense[] }
  | { state: "error"; message: string };

const NO_FILTERS: ExpenseFilters = { month: "", category: "" };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

/** The total of the listed expenses, or null if they use different currencies. */
function totalOf(expenses: Expense[]): string | null {
  const currencies = new Set(expenses.map((expense) => expense.currency));
  if (expenses.length === 0 || currencies.size !== 1) {
    return null;
  }
  return formatMoney(sumAmounts(expenses.map((expense) => expense.total)), expenses[0].currency);
}

/** "3 expenses · $52.55", or just the count if the expenses use different currencies. */
function summarize(expenses: Expense[]): string {
  const count = `${expenses.length} ${expenses.length === 1 ? "expense" : "expenses"}`;
  const currencies = new Set(expenses.map((expense) => expense.currency));
  if (currencies.size !== 1) {
    return count;
  }
  const total = sumAmounts(expenses.map((expense) => expense.total));
  return `${count} · ${formatMoney(total, expenses[0].currency)}`;
}

/** The Expenses page: filters, the table, delete, and CSV export. */
export default function ExpenseList() {
  const [filters, setFilters] = useState<ExpenseFilters>(NO_FILTERS);
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Load the list at the start and again every time the filters change.
  useEffect(() => {
    // If the filters change again before this request finishes, its answer
    // is out of date. The clean-up function below marks it to be ignored.
    let isCurrent = true;

    listExpenses(filters)
      .then((expenses) => {
        if (isCurrent) {
          setStatus({ state: "loaded", expenses });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setStatus({ state: "error", message: errorMessage(error) });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [filters]);

  async function handleDelete(expense: Expense) {
    const confirmed = window.confirm(
      `Delete the ${expense.merchant} expense from ${expense.date}? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingId(expense.id);
    setDeleteError(null);
    try {
      await deleteExpense(expense.id);
      // Remove the row from what is on screen, without reloading the whole list.
      setStatus((current) =>
        current.state === "loaded"
          ? {
              state: "loaded",
              expenses: current.expenses.filter((item) => item.id !== expense.id),
            }
          : current,
      );
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

  const hasFilters = filters.month !== "" || filters.category !== "";

  const total = status.state === "loaded" ? totalOf(status.expenses) : null;

  return (
    <div className="space-y-5">
      {/* The same green card as the Wallet: the one number this page is about. */}
      <section
        aria-label="Total"
        className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white shadow-lg"
      >
        <p className="text-sm font-medium text-emerald-100">
          {hasFilters ? "Total for these filters" : "Total spent"}
        </p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">{total ?? "—"}</p>
        {status.state === "loaded" && status.expenses.length > 0 && (
          <p className="mt-1 text-sm text-emerald-100">{summarize(status.expenses)}</p>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm" aria-label="Filters">
        <ExpenseFilterBar filters={filters} onChange={setFilters} />
      </section>

      <div className="flex justify-end">
        {/* A normal link: the backend marks the response as a download. */}
        <a
          href={expensesExportUrl(filters)}
          className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-100"
        >
          Export CSV
        </a>
      </div>

      {deleteError !== null && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {deleteError}
        </p>
      )}

      {status.state === "loading" && <p className="text-zinc-500">Loading expenses…</p>}

      {status.state === "error" && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {status.message}
        </p>
      )}

      {status.state === "loaded" && status.expenses.length === 0 && (
        <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm">
          {hasFilters ? (
            "No expenses match these filters."
          ) : (
            <>
              No expenses yet.{" "}
              <Link href="/upload" className="font-medium underline">
                Upload a receipt
              </Link>{" "}
              or{" "}
              <Link href="/expenses/new" className="font-medium underline">
                add one by hand
              </Link>
              .
            </>
          )}
        </p>
      )}

      {status.state === "loaded" && status.expenses.length > 0 && (
        <>
          <ExpenseTable
            expenses={status.expenses}
            deletingId={deletingId}
            onDelete={handleDelete}
          />
        </>
      )}
    </div>
  );
}
