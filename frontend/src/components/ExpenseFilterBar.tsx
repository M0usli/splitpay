"use client";

import { useState } from "react";

import { CATEGORIES, type Category, type ExpenseFilters } from "@/lib/api";
import { statementMonth } from "@/lib/statement";

type ExpenseFilterBarProps = {
  filters: ExpenseFilters;
  /** Called with the new filters whenever the user changes one. */
  onChange: (filters: ExpenseFilters) => void;
};

/** Which month button is chosen. "pick" shows a box to choose any month. */
type MonthChoice = "all" | "this" | "last" | "pick";

const MONTH_CHOICES: { choice: MonthChoice; label: string }[] = [
  { choice: "all", label: "All time" },
  { choice: "this", label: "This month" },
  { choice: "last", label: "Last month" },
  { choice: "pick", label: "Pick a month" },
];

const chipClass = "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors";
const chosenClass = " border-emerald-600 bg-emerald-600 text-white";
const notChosenClass = " border-zinc-300 bg-white hover:border-emerald-400";

/**
 * The month and category filters, as buttons. The parent owns the filters
 * and is told about changes; this component only remembers which month
 * button was pressed, because "This month" and a picked month can be the
 * same month.
 */
export default function ExpenseFilterBar({ filters, onChange }: ExpenseFilterBarProps) {
  const [monthChoice, setMonthChoice] = useState<MonthChoice>(
    filters.month === "" ? "all" : "pick",
  );
  const hasFilters = filters.month !== "" || filters.category !== "";

  function chooseMonth(choice: MonthChoice) {
    setMonthChoice(choice);
    // The date is read when the button is pressed, not while the page is drawn.
    const month =
      choice === "this"
        ? statementMonth(new Date(), 0)
        : choice === "last"
          ? statementMonth(new Date(), 1)
          : choice === "pick"
            ? filters.month
            : "";
    onChange({ ...filters, month });
  }

  function chooseCategory(category: Category | "") {
    onChange({ ...filters, category });
  }

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Month" className="flex flex-wrap items-center gap-2">
        {MONTH_CHOICES.map(({ choice, label }) => (
          <button
            key={choice}
            type="button"
            aria-pressed={monthChoice === choice}
            onClick={() => chooseMonth(choice)}
            className={chipClass + (monthChoice === choice ? chosenClass : notChosenClass)}
          >
            {label}
          </button>
        ))}
        {monthChoice === "pick" && (
          <>
            <label htmlFor="filter-month" className="sr-only">
              Which month
            </label>
            <input
              id="filter-month"
              type="month"
              value={filters.month}
              onChange={(event) => onChange({ ...filters, month: event.target.value })}
              className="rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </>
        )}
      </div>

      {/* overflow-x-auto: on a phone the categories scroll sideways instead of taking many rows. */}
      <div role="group" aria-label="Category" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {[{ value: "" as const, label: "All" }, ...CATEGORIES.map((value) => ({ value, label: value }))].map(
          ({ value, label }) => (
            <button
              key={label}
              type="button"
              aria-pressed={filters.category === value}
              onClick={() => chooseCategory(value)}
              className={
                "shrink-0 " + chipClass + (filters.category === value ? chosenClass : notChosenClass)
              }
            >
              {label}
            </button>
          ),
        )}
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setMonthChoice("all");
            onChange({ month: "", category: "" });
          }}
          className="text-sm font-medium text-zinc-600 underline hover:text-zinc-900"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
