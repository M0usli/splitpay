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
import { categoryStyle } from "@/lib/categoryStyle";
import { formatMoney, sumAmounts } from "@/lib/format";
import { buildShares, sharingFromExpense, type SharingValues } from "@/lib/split";

type Status =
  | { state: "loading" }
  | { state: "loaded"; costs: Recurring[] }
  | { state: "error"; message: string };

// The latest day that exists in every month.
const LAST_DAY = 28;

// One tap fills in the name and the category of the most common monthly costs.
const COMMON_COSTS: { merchant: string; category: Category }[] = [
  { merchant: "Rent", category: "Bills & Utilities" },
  { merchant: "Internet", category: "Bills & Utilities" },
  { merchant: "Phone", category: "Bills & Utilities" },
  { merchant: "Hydro", category: "Bills & Utilities" },
  { merchant: "Gym", category: "Health" },
  { merchant: "Streaming", category: "Entertainment" },
];
// The days most bills fall on, as buttons; any other day is in the list beside them.
const COMMON_DAYS = [1, 15, 28];

// The same look as the Wallet page: rounded cards, green main buttons.
const inputClass =
  "mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm " +
  "focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
const labelClass = "block text-sm font-medium text-zinc-700";
const buttonClass =
  "rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 " +
  "disabled:bg-zinc-300";
const smallButtonClass =
  "rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 " +
  "disabled:opacity-50";
const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";
const chipClass = "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors";
const chosenClass = " border-emerald-600 bg-emerald-600 text-white";
const notChosenClass = " border-zinc-300 bg-white hover:border-emerald-400";

/** What the running costs add up to each month, or null if they use different currencies. */
function monthlyTotal(costs: Recurring[]): string | null {
  const running = costs.filter((cost) => cost.is_active);
  const currencies = new Set(running.map((cost) => cost.currency));
  if (running.length === 0) {
    return formatMoney("0", "CAD");
  }
  if (currencies.size !== 1) {
    return null;
  }
  return formatMoney(sumAmounts(running.map((cost) => cost.total)), running[0].currency);
}

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

  const runningCount = status.costs.filter((cost) => cost.is_active).length;

  return (
    <div className="space-y-6">
      {/* The same green card as the Wallet: what all running costs add up to. */}
      <section
        aria-label="Every month"
        className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white shadow-lg"
      >
        <p className="text-sm font-medium text-emerald-100">Every month</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">
          {monthlyTotal(status.costs) ?? "—"}
        </p>
        <p className="mt-1 text-sm text-emerald-100">
          {runningCount} running {runningCount === 1 ? "cost" : "costs"}
        </p>
      </section>

      {notice !== null && (
        <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          ✓ {notice}
        </p>
      )}
      {actionError !== null && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      <section className={cardClass} aria-labelledby="costs-heading">
        <h2 id="costs-heading" className="text-sm font-semibold text-zinc-700">
          Your recurring costs
        </h2>
        {status.costs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            None yet. Add one below and the app will add it to your expenses every month.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {status.costs.map((cost) => (
              <li key={cost.id} className="flex flex-wrap items-center gap-3 py-3">
                <span
                  aria-hidden
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-semibold ${categoryStyle(cost.category)}`}
                >
                  {cost.category[0]}
                </span>
                <div className={`min-w-0 flex-1 ${cost.is_active ? "" : "opacity-60"}`}>
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
                {/* On a phone the buttons get their own row, so the text keeps its width. */}
                <div className="flex w-full gap-2 pl-[3.25rem] sm:w-auto sm:pl-0">
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
        <h2 id="form-heading" className="text-sm font-semibold text-zinc-700">
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
      setError("Choose a category.");
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
      {editing === null && (
        <div role="group" aria-label="Common costs" className="flex flex-wrap gap-2">
          {COMMON_COSTS.map((common) => (
            <button
              key={common.merchant}
              type="button"
              aria-pressed={merchant === common.merchant}
              onClick={() => {
                setMerchant(common.merchant);
                setCategory(common.category);
              }}
              className={chipClass + (merchant === common.merchant ? chosenClass : notChosenClass)}
            >
              {common.merchant}
            </button>
          ))}
        </div>
      )}

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
        {/* Buttons instead of a list to open: every category is one tap away. */}
        <div role="group" aria-label="Category" className="sm:col-span-2">
          <p className={labelClass}>Category</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {CATEGORIES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={category === option}
                onClick={() => setCategory(option)}
                className={chipClass + (category === option ? chosenClass : notChosenClass)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="recurring-day" className={labelClass}>
            Day of the month
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            {COMMON_DAYS.map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={dayOfMonth === String(day)}
                onClick={() => setDayOfMonth(String(day))}
                className={chipClass + (dayOfMonth === String(day) ? chosenClass : notChosenClass)}
              >
                {ordinal(day)}
              </button>
            ))}
          </div>
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
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
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
