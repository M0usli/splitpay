import type { Category } from "@/lib/api";

/** A colour for each category, so the list can be scanned at a glance. */
const STYLES: Record<Category, string> = {
  Groceries: "bg-emerald-100 text-emerald-700",
  Dining: "bg-orange-100 text-orange-700",
  Transport: "bg-sky-100 text-sky-700",
  Shopping: "bg-pink-100 text-pink-700",
  Entertainment: "bg-violet-100 text-violet-700",
  "Bills & Utilities": "bg-amber-100 text-amber-800",
  Health: "bg-rose-100 text-rose-700",
  Other: "bg-zinc-100 text-zinc-700",
};

export function categoryStyle(category: Category): string {
  return STYLES[category];
}
