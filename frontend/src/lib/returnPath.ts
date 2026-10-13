// Remembering which page a signed-out visitor wanted, so that logging in
// brings them back to it: /login?next=%2Fexpenses

/** The log-in address that remembers `path`. The home page needs no reminder. */
export function loginPathFor(path: string): string {
  return path === "/" ? "/login" : `/login?next=${encodeURIComponent(path)}`;
}

/**
 * Where to go after logging in.
 *
 * `next` comes from the address bar, so anyone can put anything there. Only
 * a path inside this app is accepted. "//evil.example" and "/\evil.example"
 * look like paths but browsers read them as other websites, and a log-in
 * page that forwards people to another website helps phishing.
 */
export function safeReturnPath(next: string | null): string {
  if (next === null || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/";
  }
  return next;
}
