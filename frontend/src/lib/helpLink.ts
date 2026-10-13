// Some refusals from the backend have an obvious next step. This turns the
// message into a link to the page where the user can fix it.

export type HelpLink = { href: string; label: string };

export function helpLinkFor(message: string | null): HelpLink | null {
  if (message === null) {
    return null;
  }
  if (message.includes("Verify your identity")) {
    return { href: "/verify", label: "Verify your identity" };
  }
  if (message.includes("enough money")) {
    return { href: "/", label: "Add money to your wallet" };
  }
  return null;
}
