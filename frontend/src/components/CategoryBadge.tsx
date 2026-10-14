import type { Category } from "@/lib/api";
import { CATEGORY_COLORS } from "@/lib/chart-colors";

/**
 * A rounded square with the category's first letter, in the category's
 * colour. It uses the same colours as the Dashboard charts, so Groceries
 * looks the same in a list as in a chart.
 */
export default function CategoryBadge({ category }: { category: Category }) {
  const colour = CATEGORY_COLORS[category];
  return (
    <span
      aria-hidden
      // "1f" at the end of a hex colour is about 12% opacity: a light tint of the same colour.
      style={{ backgroundColor: `${colour}1f`, color: colour }}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-semibold"
    >
      {category[0]}
    </span>
  );
}
