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

/**
 * Request ids for buttons that act straight away, with no confirm step.
 *
 * Two quick taps on the same button must send the same id, so the id is
 * remembered under a name for that action (for example "pay-2-13.18") until
 * the action succeeds. After `forget`, the next tap is a new action.
 */
export class RequestIds {
  private readonly ids = new Map<string, string>();

  idFor(action: string): string {
    const existing = this.ids.get(action);
    if (existing !== undefined) {
      return existing;
    }
    const created = newRequestId();
    this.ids.set(action, created);
    return created;
  }

  forget(action: string): void {
    this.ids.delete(action);
  }
}
