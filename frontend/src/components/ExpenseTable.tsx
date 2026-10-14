import Link from "next/link";

import type { Expense } from "@/lib/api";
import { categoryStyle } from "@/lib/categoryStyle";
import { formatMoney } from "@/lib/format";

type ExpenseTableProps = {
  expenses: Expense[];
  /** The id of the expense being deleted right now, if any, so its buttons can be disabled. */
  deletingId: number | null;
  onDelete: (expense: Expense) => void;
};

/**
 * The list of expenses. It only displays what it is given.
 *
 * It is a list of cards rather than a table, so it reads the same on a
 * phone as on a laptop: no columns to hide or scroll sideways.
 */
export default function ExpenseTable({ expenses, deletingId, onDelete }: ExpenseTableProps) {
  return (
    <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white px-4 shadow-sm">
      {expenses.map((expense) => (
        <li key={expense.id} className="flex flex-wrap items-start gap-3 py-3">
          {/* The category's first letter in its colour. */}
          <span
            aria-hidden
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-semibold ${categoryStyle(expense.category)}`}
          >
            {expense.category[0]}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium">{expense.merchant}</span>
              {expense.receipt_id !== null && (
                <Link
                  href={`/receipts/${expense.receipt_id}`}
                  className="ml-2 text-xs text-zinc-500 underline hover:text-zinc-900"
                >
                  receipt
                </Link>
              )}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {expense.date} · {expense.category}
              {expense.is_shared ? " · shared" : ""}
            </p>
            {expense.notes && <p className="mt-0.5 break-words text-xs text-zinc-500">{expense.notes}</p>}
          </div>

          <div className="flex flex-col items-end gap-1">
            <p className="whitespace-nowrap text-sm font-semibold tabular-nums">
              {formatMoney(expense.total, expense.currency)}
            </p>
            <div className="flex gap-1 text-xs">
              <Link
                href={`/expenses/${expense.id}/edit`}
                aria-label={`Edit ${expense.merchant}`}
                className="rounded-lg px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Edit
              </Link>
              <button
                type="button"
                aria-label={`Delete ${expense.merchant}`}
                disabled={deletingId === expense.id}
                onClick={() => onDelete(expense)}
                className="rounded-lg px-2 py-1 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
