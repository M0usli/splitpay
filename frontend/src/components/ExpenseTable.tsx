import Link from "next/link";

import type { Expense } from "@/lib/api";
import { formatMoney } from "@/lib/format";

type ExpenseTableProps = {
  expenses: Expense[];
  /** The id of the expense being deleted right now, if any, so its buttons can be disabled. */
  deletingId: number | null;
  onDelete: (expense: Expense) => void;
};

/**
 * The table of expenses. It only displays what it is given.
 *
 * On a phone there is no room for every column, so the Date and Category
 * columns are hidden and shown under the merchant name instead. Classes
 * starting with "sm:" apply only from tablet width upwards.
 */
export default function ExpenseTable({ expenses, deletingId, onDelete }: ExpenseTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="hidden px-4 py-3 font-semibold sm:table-cell">Date</th>
            <th className="px-3 py-3 font-semibold sm:px-4">Merchant</th>
            <th className="hidden px-4 py-3 font-semibold sm:table-cell">Category</th>
            <th className="px-3 py-3 text-right font-semibold sm:px-4">Total</th>
            <th aria-label="Actions" className="px-3 py-3 sm:px-4" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {expenses.map((expense) => (
            <tr key={expense.id}>
              <td className="hidden whitespace-nowrap px-4 py-3 text-zinc-600 sm:table-cell">
                {expense.date}
              </td>
              <td className="px-3 py-3 sm:px-4">
                <span className="font-medium">{expense.merchant}</span>
                {expense.receipt_id !== null && (
                  <Link
                    href={`/receipts/${expense.receipt_id}`}
                    className="ml-2 text-xs text-zinc-500 underline hover:text-zinc-900"
                  >
                    receipt
                  </Link>
                )}
                <p className="mt-0.5 text-xs text-zinc-500 sm:hidden">
                  {expense.date} · {expense.category}
                </p>
                {expense.notes && (
                  <p className="mt-0.5 text-xs text-zinc-500">{expense.notes}</p>
                )}
              </td>
              <td className="hidden px-4 py-3 text-zinc-600 sm:table-cell">
                {expense.category}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums sm:px-4">
                {formatMoney(expense.total, expense.currency)}
              </td>
              <td className="px-3 py-3 sm:px-4">
                <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                  <Link
                    href={`/expenses/${expense.id}/edit`}
                    aria-label={`Edit ${expense.merchant}`}
                    className="rounded px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-100"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    aria-label={`Delete ${expense.merchant}`}
                    disabled={deletingId === expense.id}
                    onClick={() => onDelete(expense)}
                    className="rounded px-2 py-1 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
