// The rules for building an amount one key at a time, as on a number pad.
// The amount stays text ("12.5") the whole way, so it never becomes a
// decimal number that could lose a cent.

/** The keys on the pad: the digits, the decimal point, and "back" to erase one character. */
export type PadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

export const PAD_KEYS: PadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

// Up to 99999.99, which is above anything the wallet accepts.
const MAX_WHOLE_DIGITS = 5;

/** What the amount becomes after one key is pressed. A key that makes no sense changes nothing. */
export function pressKey(amount: string, key: PadKey): string {
  if (key === "back") {
    return amount.slice(0, -1);
  }
  const [whole, cents] = amount.split(".");
  if (key === ".") {
    // Only one decimal point; "." on an empty amount starts "0.".
    return amount.includes(".") ? amount : `${amount === "" ? "0" : amount}.`;
  }
  if (cents !== undefined) {
    // After the point: at most two digits, the cents.
    return cents.length < 2 ? amount + key : amount;
  }
  if (whole === "0") {
    // No leading zeros: "0" then "5" is "5".
    return key;
  }
  return whole.length < MAX_WHOLE_DIGITS ? amount + key : amount;
}

/** "12.5" shown as "12.50" is wrong while typing, so the pad shows exactly what was pressed. */
export function displayAmount(amount: string): string {
  return amount === "" ? "0" : amount;
}

/** True when the amount is something that can be sent: more than zero. */
export function isPositiveAmount(amount: string): boolean {
  return /^\d+(\.\d{0,2})?$/.test(amount) && Number(amount.replace(".", "")) > 0;
}

/** Remove a trailing point so "12." is sent as "12". */
export function finishAmount(amount: string): string {
  return amount.endsWith(".") ? amount.slice(0, -1) : amount;
}
