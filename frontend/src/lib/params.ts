/**
 * Read a database id from a URL segment such as the "7" in /receipts/7.
 *
 * Returns null for anything that is not a positive whole number ("abc",
 * "1.5", "-2"), so the page can show "not found" instead of asking the API
 * for a receipt that cannot exist.
 */
export function parseId(segment: string): number | null {
  return /^[1-9]\d*$/.test(segment) ? Number(segment) : null;
}
