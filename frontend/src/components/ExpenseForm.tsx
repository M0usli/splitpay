"use client";

import { useState, type FormEvent } from "react";

import { CATEGORIES, type Category, type ExpenseUpdate, type Share } from "@/lib/api";

// What the inputs hold while the user is typing. Inputs always produce
// strings, so amounts stay strings here and the API parses them as decimals.
export type ExpenseFormValues = {
  merchant: string;
  date: string;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  category: Category | "";
  notes: string;
  // How the expense is shared with the household. The form has no inputs
  // for these yet; it keeps what it was given so that editing an expense
  // does not undo its sharing. null shares mean "split equally".
  is_shared: boolean;
  shares: Share[] | null;
};

const EMPTY_VALUES: ExpenseFormValues = {
  merchant: "",
  date: "",
  subtotal: "",
  tax: "",
  total: "",
  currency: "CAD",
  category: "",
  notes: "",
  is_shared: false,
  shares: null,
};

type ExpenseFormProps = {
  submitLabel: string;
  /** Values to start with, e.g. what the AI read from a receipt. Missing ones start empty. */
  initialValues?: Partial<ExpenseFormValues>;
  /** Called with the cleaned-up values. Throw an Error to show its message. */
  onSubmit: (expense: ExpenseUpdate) => Promise<void>;
};

const inputClass =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm " +
  "focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500";
const labelClass = "block text-sm font-medium text-zinc-700";

/** Optional text inputs: send null to the API when the user left them empty. */
function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export default function ExpenseForm({
  submitLabel,
  initialValues,
  onSubmit,
}: ExpenseFormProps) {
  // The starting values are only read once, when the form first appears.
  const [values, setValues] = useState<ExpenseFormValues>({
    ...EMPTY_VALUES,
    ...initialValues,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(field: keyof ExpenseFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Stop the browser's default behaviour of reloading the page.
    event.preventDefault();
    if (values.category === "") {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        merchant: values.merchant.trim(),
        date: values.date,
        subtotal: emptyToNull(values.subtotal),
        tax: emptyToNull(values.tax),
        total: values.total,
        currency: values.currency,
        category: values.category,
        notes: emptyToNull(values.notes),
        is_shared: values.is_shared,
        // The saved parts only fit the saved total. If the total was
        // changed, let the backend split the new one equally.
        shares: values.total === initialValues?.total ? values.shares : null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="merchant" className={labelClass}>
          Merchant
        </label>
        <input
          id="merchant"
          type="text"
          required
          maxLength={200}
          value={values.merchant}
          onChange={(event) => setField("merchant", event.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="date" className={labelClass}>
            Date
          </label>
          <input
            id="date"
            type="date"
            required
            value={values.date}
            onChange={(event) => setField("date", event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="category" className={labelClass}>
            Category
          </label>
          <select
            id="category"
            required
            value={values.category}
            onChange={(event) => setField("category", event.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              Select a category
            </option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="subtotal" className={labelClass}>
            Subtotal <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <input
            id="subtotal"
            type="number"
            min="0"
            step="0.01"
            value={values.subtotal}
            onChange={(event) => setField("subtotal", event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tax" className={labelClass}>
            Tax <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <input
            id="tax"
            type="number"
            min="0"
            step="0.01"
            value={values.tax}
            onChange={(event) => setField("tax", event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="total" className={labelClass}>
            Total
          </label>
          <input
            id="total"
            type="number"
            min="0"
            step="0.01"
            required
            value={values.total}
            onChange={(event) => setField("total", event.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <textarea
          id="notes"
          rows={2}
          value={values.notes}
          onChange={(event) => setField("notes", event.target.value)}
          className={inputClass}
        />
      </div>

      {error !== null && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {isSubmitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
