// Working out each person's part of a shared expense in the browser.
//
// All the arithmetic is done in whole cents (integers). JavaScript numbers
// cannot hold decimals like 0.1 exactly, but they hold integers exactly, so
// counting cents never loses or invents a cent.

import type { Share } from "./api";

/** How the user chose to split an expense. */
export type SplitMode = "equal" | "percent" | "amount";

/** What the sharing inputs hold while the user is filling them in. */
export type SharingValues = {
  isShared: boolean;
  mode: SplitMode;
  /** The ids of the members who take part in this expense. */
  included: number[];
  /** What was typed for each member (a percent or an amount), by member id. */
  inputs: Record<number, string>;
};

export const NOT_SHARED: SharingValues = {
  isShared: false,
  mode: "equal",
  included: [],
  inputs: {},
};

/** Turn "12.5" into 1250. Returns null for anything that is not a valid amount. */
export function toCents(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const [, dollars, cents = ""] = match;
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
}

/** Turn 1250 into "12.50". */
export function fromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * Split a total into equal parts that add up to exactly the total.
 * The leftover cents go to the first people, one each: 1000 among 3 is
 * [334, 333, 333]. (The backend uses the same rule in split_equally.)
 */
export function splitEqually(totalCents: number, people: number): number[] {
  const base = Math.floor(totalCents / people);
  const leftover = totalCents - base * people;
  return Array.from({ length: people }, (_, position) => (position < leftover ? base + 1 : base));
}

/**
 * Split a total by percentages that add up to 100. Percents are given in
 * hundredths ("33.33" is 3333) so they are integers too.
 *
 * Everyone first gets their part rounded down. The cents still missing go to
 * the people who lost the largest fraction of a cent to the rounding.
 */
export function splitByPercent(totalCents: number, hundredths: number[]): number[] {
  const exact = hundredths.map((percent) => totalCents * percent);
  const parts = exact.map((value) => Math.floor(value / 10000));
  let missing = totalCents - parts.reduce((sum, part) => sum + part, 0);

  const byLargestLoss = exact
    .map((value, position) => ({ position, lost: value % 10000 }))
    .sort((a, b) => b.lost - a.lost || a.position - b.position);
  for (const { position } of byLargestLoss) {
    if (missing === 0) {
      break;
    }
    parts[position] += 1;
    missing -= 1;
  }
  return parts;
}

export type SharesResult =
  // `shares: null` asks the backend to split equally among everyone.
  { ok: true; isShared: boolean; shares: Share[] | null } | { ok: false; message: string };

/**
 * Turn what the user chose into the shares the API expects, or a message
 * saying what needs fixing.
 *
 * `payerId` is the logged-in user. In an equal split they are put first, so
 * a cent that cannot be divided lands on the person who paid.
 */
export function buildShares(
  sharing: SharingValues,
  total: string,
  memberIds: number[],
  payerId: number,
): SharesResult {
  if (!sharing.isShared) {
    return { ok: true, isShared: false, shares: null };
  }
  const totalCents = toCents(total);
  if (totalCents === null) {
    return { ok: false, message: "Enter the total before choosing how to split it." };
  }
  const people = memberIds.filter((id) => sharing.included.includes(id));
  if (people.length === 0) {
    return { ok: false, message: "Choose at least one person to share this expense with." };
  }

  const toShares = (ids: number[], cents: number[]): Share[] =>
    ids.map((id, position) => ({ user_id: id, amount: fromCents(cents[position]) }));

  if (sharing.mode === "equal") {
    if (people.length === memberIds.length) {
      return { ok: true, isShared: true, shares: null };
    }
    const ordered = [...people].sort((a, b) => Number(b === payerId) - Number(a === payerId));
    return { ok: true, isShared: true, shares: toShares(ordered, splitEqually(totalCents, ordered.length)) };
  }

  const typed = people.map((id) => toCents(sharing.inputs[id] ?? ""));
  if (typed.some((value) => value === null)) {
    const what = sharing.mode === "percent" ? "a percent" : "an amount";
    return { ok: false, message: `Enter ${what} for every person you chose.` };
  }
  const values = typed as number[];
  const sum = values.reduce((total, value) => total + value, 0);

  if (sharing.mode === "percent") {
    if (sum !== 10000) {
      return { ok: false, message: `The percents add up to ${fromCents(sum)}%, not 100%.` };
    }
    return { ok: true, isShared: true, shares: toShares(people, splitByPercent(totalCents, values)) };
  }

  if (sum !== totalCents) {
    return {
      ok: false,
      message: `The amounts add up to ${fromCents(sum)}, but the total is ${fromCents(totalCents)}.`,
    };
  }
  return { ok: true, isShared: true, shares: toShares(people, values) };
}

/** The sharing inputs for an expense that is already saved. */
export function sharingFromExpense(isShared: boolean, shares: Share[]): SharingValues {
  if (!isShared) {
    return NOT_SHARED;
  }
  // Saved parts are shown as exact amounts: that is what is stored, so
  // nothing changes unless the user changes it.
  return {
    isShared: true,
    mode: "amount",
    included: shares.map((share) => share.user_id),
    inputs: Object.fromEntries(shares.map((share) => [share.user_id, share.amount])),
  };
}
