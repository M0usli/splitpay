"use client";

import { useEffect, useState, type FormEvent } from "react";

import SharingFields from "@/components/SharingFields";
import { useHousehold } from "@/components/useHousehold";
import {
  CATEGORIES,
  createRecurring,
  deleteRecurring,
  listRecurring,
  runRecurring,
  updateRecurring,
  type Category,
  type Recurring,
  type RecurringWrite,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { buildShares, sharingFromExpense, type SharingValues } from "@/lib/split";

type Status =
  | { state: "loading" }
  | { state: "loaded"; costs: Recurring[] }
  | { state: "error"; message: string };

// The latest day that exists in every month.
const LAST_DAY = 28;

const inputClass =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm " +
  "focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500";
const labelClass = "block text-sm font-medium text-zinc-700";
const buttonClass =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50";
const smallButtonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50";
const cardClass = "rounded-lg border border-zinc-200 bg-white p-5";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

/** "1st", "2nd", "3rd", "4th" ... "28th". */
function ordinal(day: number): string {
  const lastTwo = day % 100;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
  return `${day}${suffix}`;
}

/** Everything about a recurring cost except whether it is running. */
function toWrite(cost: Recurring): RecurringWrite {
  return {
    merchant: cost.merchant,
    total: cost.total,
    currency: cost.currency,
    category: cost.category,
    notes: cost.notes,
    day_of_month: cost.day_of_month,
    is_active: cost.is_active,
    is_shared: cost.is_shared,
    shares: cost.shares,
  };
}

/** The Recurring page: monthly costs such as rent, and a form to add or change one. */
export default function RecurringCosts() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    listRecurring()
      .then((costs) => {
        if (isCurrent) {
          setStatus({ state: "loaded", costs });
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
  }, []);

  /** Run a change, make any expense that became due, then load the list again. */
  async function run(action: () => Promise<unknown>) {
    setIsBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await action();
      const made = await runRecurring();
      if (made.length > 0) {
        const count = made.length === 1 ? "1 expense was" : `${made.length} expenses were`;
        setNotice(`${count} added to your expenses.`);
      }
      setStatus({ state: "loaded", costs: await listRecurring() });
      setEditing(null);
      // A new number makes the form below start again, empty.
      setFormVersion((version) => version + 1);
    } catch (error) {
      setActionError(errorMessage(error));
      // Let the form know it did not work, so it stays open with its values.
      throw error;
    } finally {
      setIsBusy(false);
    }
  }

  /** Buttons in the list: a failure is shown above the list, nothing more. */
  function runFromList(action: () => Promise<unknown>) {
    run(action).catch(() => {});
  }

  function handleDelete(cost: Recurring) {
    const confirmed = window.confirm(
      `Delete "${cost.merchant}"? The expenses it already made are kept.`,
    );
    if (confirmed) {
      runFromList(() => deleteRecurring(cost.id));
    }
  }

  if (status.state === "loading") {
    return <p className="text-zinc-500">Loading…</p>;
  }
  if (status.state === "error") {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {status.message}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {notice !== null && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}
      {actionError !== null && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}

      <section className={cardClass} aria-labelledby="costs-heading">
        <h2 id="costs-heading" className="text-lg font-semibold">
          Your recurring costs
        </h2>
        {status.costs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            None yet. Add one below and the app will add it to your expenses every month.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {status.costs.map((cost) => (
              <li key={cost.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {cost.merchant}{" "}
                    <span className="font-normal text-zinc-600">
                      {formatMoney(cost.total, cost.currency)}
                    </span>
                  </p>
                  <p className="text-sm text-zinc-600">
                    On the {ordinal(cost.day_of_month)} of each month
                    {cost.is_shared ? ", shared with your household" : ""}.{" "}
                    {cost.next_date !== null ? `Next: ${cost.next_date}.` : "Stopped."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setEditing(cost)}
                    className={smallButtonClass}
                    aria-label={`Edit ${cost.merchant}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      runFromList(() =>
                        updateRecurring(cost.id, { ...toWrite(cost), is_active: !cost.is_active }),
                      )
                    }
                    className={smallButtonClass}
                    aria-label={`${cost.is_active ? "Stop" : "Resume"} ${cost.merchant}`}
                  >
                    {cost.is_active ? "Stop" : "Resume"}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleDelete(cost)}
                    className={smallButtonClass}
                    aria-label={`Delete ${cost.merchant}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardClass} aria-labelledby="form-heading">
        <h2 id="form-heading" className="text-lg font-semibold">
          {editing === null ? "Add a recurring cost" : `Edit ${editing.merchant}`}
        </h2>
        {/* A changed key makes React build a fresh form, so its inputs start
            from the cost being edited, or empty for a new one. */}
        <RecurringForm
          key={`${editing?.id ?? "new"}-${formVersion}`}
          editing={editing}
          isBusy={isBusy}
          onCancel={() => setEditing(null)}
          onSave={(values) =>
            run(() =>
              editing === null ? createRecurring(values) : updateRecurring(editing.id, values),
            )
          }
        />
      </section>
    </div>
  );
}

type RecurringFormProps = {
  /** The cost being changed, or null to add a new one. */
  editing: Recurring | null;
  isBusy: boolean;
  onCancel: () => void;
  /** Rejects if saving failed; the page shows why. */
  onSave: (values: RecurringWrite) => Promise<void>;
};

function RecurringForm({ editing, isBusy, onCancel, onSave }: RecurringFormProps) {
  const [merchant, setMerchant] = useState(editing?.merchant ?? "");
  const [total, setTotal] = useState(editing?.total ?? "");
  const [category, setCategory] = useState<Category | "">(editing?.category ?? "");
  const [dayOfMonth, setDayOfMonth] = useState(String(editing?.day_of_month ?? 1));
  const [sharing, setSharing] = useState<SharingValues>(() =>
    sharingFromExpense(editing?.is_shared ?? false, editing?.shares ?? []),
  );
  const [error, setError] = useState<string | null>(null);

  const householdInfo = useHousehold();
  const members = householdInfo?.household.members ?? [];
  const canShare = householdInfo !== null && members.length > 1;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (category === "") {
      return;
    }

    // Without a household the saved sharing is passed on unchanged.
    let isShared = editing?.is_shared ?? false;
    let shares = editing?.shares ?? null;
    if (canShare) {
      const memberIds = members.map((member) => member.id);
      const result = buildShares(sharing, total, memberIds, householdInfo.myId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      isShared = result.isShared;
      shares = result.shares;
    }

    setError(null);
    try {
      await onSave({
        merchant: merchant.trim(),
        total,
        currency: editing?.currency ?? "CAD",
        category,
        notes: editing?.notes ?? null,
        day_of_month: Number(dayOfMonth),
        is_active: editing?.is_active ?? true,
        is_shared: isShared,
        shares,
      });
    } catch {
      // The page shows the reason; the form keeps what was typed.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="recurring-merchant" className={labelClass}>
            What is it for?
          </label>
          <input
            id="recurring-merchant"
            type="text"
            required
            maxLength={200}
            placeholder="Rent"
            value={merchant}
            onChange={(event) => setMerchant(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="recurring-total" className={labelClass}>
            Amount each month
          </label>
          <input
            id="recurring-total"
            type="number"
            min="0"
            step="0.01"
            required
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="recurring-category" className={labelClass}>
            Category
          </label>
          <select
            id="recurring-category"
            required
            value={category}
            onChange={(event) => setCategory(event.target.value as Category)}
            className={inputClass}
          >
            <option value="" disabled>
              Select a category
            </option>
            {CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="recurring-day" className={labelClass}>
            Day of the month
          </label>
          <select
            id="recurring-day"
            value={dayOfMonth}
            onChange={(event) => setDayOfMonth(event.target.value)}
            className={inputClass}
          >
            {Array.from({ length: LAST_DAY }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {ordinal(day)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">
            Up to the 28th, so the day exists in every month.
          </p>
        </div>
      </div>

      {canShare && (
        <SharingFields
          members={members}
          myId={householdInfo.myId}
          value={sharing}
          onChange={setSharing}
          allowByItem={false}
        />
      )}

      {error !== null && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={isBusy} className={buttonClass}>
          {editing === null ? "Add recurring cost" : "Save changes"}
        </button>
        {editing !== null && (
          <button type="button" onClick={onCancel} className={smallButtonClass}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
