import { CATEGORIES, type Category, type ExpenseFilters } from "@/lib/api";

type ExpenseFilterBarProps = {
  filters: ExpenseFilters;
  /** Called with the new filters whenever the user changes one. */
  onChange: (filters: ExpenseFilters) => void;
};

const controlClass =
  "mt-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm " +
  "focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500";

/**
 * The month and category filters. This component holds no state of its own:
 * the parent owns the filters and passes them in, and is told about changes.
 */
export default function ExpenseFilterBar({ filters, onChange }: ExpenseFilterBarProps) {
  const hasFilters = filters.month !== "" || filters.category !== "";

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label htmlFor="filter-month" className="block text-sm font-medium text-zinc-700">
          Month
        </label>
        <input
          id="filter-month"
          type="month"
          value={filters.month}
          onChange={(event) => onChange({ ...filters, month: event.target.value })}
          className={controlClass}
        />
      </div>

      <div>
        <label htmlFor="filter-category" className="block text-sm font-medium text-zinc-700">
          Category
        </label>
        <select
          id="filter-category"
          value={filters.category}
          onChange={(event) =>
            onChange({ ...filters, category: event.target.value as Category | "" })
          }
          className={controlClass}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => onChange({ month: "", category: "" })}
          className="rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
