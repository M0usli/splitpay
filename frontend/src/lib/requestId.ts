/**
 * A random id for one action the user starts, such as one "send money".
 *
 * The backend uses it as an idempotency key: if the same request arrives
 * twice (a double tap, a retry on a slow network), it sees the same id and
 * moves the money only once. A new action gets a new id.
 *
 * crypto.randomUUID() would do this in one line, but browsers only offer it
 * on https pages. This app is also opened over plain http from a phone on
 * Wi-Fi, where crypto.getRandomValues() still works.
 */
export function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Each byte becomes two hexadecimal characters: 32 characters in total.
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
