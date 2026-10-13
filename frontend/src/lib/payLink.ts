// A pay link is the address inside a "pay me" QR code, for example
// http://192.168.1.20:3000/?pay=sam@example.com&amount=12.50
// Opening it shows the send screen filled in. It never moves money by
// itself: the person who opens it still has to confirm.

export type PayLink = {
  toEmail: string;
  /** null when the person paying chooses the amount. */
  amount: string | null;
};

// Up to 99999.99 with at most two decimals; the backend has its own limit.
const AMOUNT_PATTERN = /^\d{1,5}(\.\d{1,2})?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

/** The address to put in the QR code. */
export function buildPayLink(origin: string, toEmail: string, amount: string | null): string {
  // URLSearchParams escapes characters such as "+" and "&" in the email.
  const params = new URLSearchParams({ pay: toEmail });
  if (amount !== null) {
    params.set("amount", amount);
  }
  return `${origin}/?${params.toString()}`;
}

/**
 * Read a pay link from the page's query string. Returns null when there is
 * none. Anyone can type anything into an address, so both values are checked:
 * a bad email means no link, and a bad amount is dropped.
 */
export function parsePayLink(params: { get(name: string): string | null }): PayLink | null {
  const toEmail = (params.get("pay") ?? "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(toEmail)) {
    return null;
  }
  const amount = params.get("amount") ?? "";
  const isUsable = AMOUNT_PATTERN.test(amount) && Number(amount.replace(".", "")) > 0;
  return { toEmail, amount: isUsable ? amount : null };
}

/**
 * Which address the QR code should point to.
 *
 * On the computer the page is open at http://localhost:3000, and "localhost"
 * on a phone means the phone itself. So when PHONE_ORIGIN is set, the code
 * uses that address, which the phone can reach over Wi-Fi.
 */
export function payLinkOrigin(pageOrigin: string, phoneOrigin: string): string {
  const isLocal = new URL(pageOrigin).hostname === "localhost";
  return isLocal && phoneOrigin !== "" ? phoneOrigin.replace(/\/$/, "") : pageOrigin;
}

/** True when a phone could not open this address. */
export function isLocalOnly(origin: string): boolean {
  return new URL(origin).hostname === "localhost";
}
