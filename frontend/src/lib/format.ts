/** Format an amount from the API (a string like "45.20") as "$45.20". */
export function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    Number(amount),
  );
}

/**
 * Add up amounts from the API and return the sum as a string like "52.55".
 *
 * The amounts are converted to whole cents first, because adding decimals
 * directly in JavaScript gives rounding errors (0.1 + 0.2 is not 0.3).
 */
export function sumAmounts(amounts: string[]): string {
  const totalCents = amounts.reduce(
    (cents, amount) => cents + Math.round(Number(amount) * 100),
    0,
  );
  return (totalCents / 100).toFixed(2);
}

/**
 * Turn "2026-10" into "October 2026" (or "Oct" with style "short").
 *
 * The date is built and formatted in UTC so the result never shifts to the
 * previous month in time zones behind UTC.
 */
export function formatMonth(month: string, style: "long" | "short" = "long"): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));
  return new Intl.DateTimeFormat("en-CA", {
    month: style,
    year: style === "long" ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(date);
}

/** The current month in the user's own time zone, as "YYYY-MM". */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
