import type { Category } from "@/lib/api";

/**
 * One fixed colour per category.
 *
 * The colour belongs to the category, not to its position in a chart, so
 * Groceries is the same blue every month no matter how it ranks. The hues
 * are from a palette checked for colour-blind readers; "Other" is a neutral
 * grey because it is a leftover bucket, not a real group.
 */
export const CATEGORY_COLORS: Record<Category, string> = {
  Groceries: "#2a78d6",
  Dining: "#eb6834",
  Transport: "#1baf7a",
  Shopping: "#eda100",
  Entertainment: "#e87ba4",
  "Bills & Utilities": "#008300",
  Health: "#6250d6",
  Other: "#898781",
};

/** The single colour for charts that show one series, such as monthly totals: the app's green. */
export const SERIES_COLOR = "#059669";

/** Quiet greys for the parts of a chart that are not data. */
export const CHART_GRID = "#e4e4e7";
export const CHART_AXIS = "#d4d4d8";
export const CHART_TEXT = "#71717a";
export const CHART_SURFACE = "#ffffff";
