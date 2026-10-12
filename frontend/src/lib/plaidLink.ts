// Opening Plaid Link, the window where the user picks a bank and signs in.
//
// Plaid's own script draws that window. It has to be loaded from Plaid's
// address (not copied into this project), so the bank login never passes
// through this app's code.

const PLAID_SCRIPT_URL = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

/** What Plaid tells us when the user has finished connecting a bank. */
export type LinkResult = {
  /** A one-time token for the backend to swap for the real access token. */
  publicToken: string;
  institutionName: string;
};

// The small part of Plaid's script that this app uses.
type PlaidHandler = { open: () => void };
type PlaidGlobal = {
  create: (options: {
    token: string;
    onSuccess: (
      publicToken: string,
      metadata: { institution: { name: string } | null },
    ) => void;
    onExit: (error: { display_message?: string | null; error_message?: string } | null) => void;
  }) => PlaidHandler;
};

declare global {
  interface Window {
    Plaid?: PlaidGlobal;
  }
}

/** Add Plaid's script to the page once, and wait until it has loaded. */
function loadPlaidScript(): Promise<PlaidGlobal> {
  return new Promise((resolve, reject) => {
    if (window.Plaid !== undefined) {
      resolve(window.Plaid);
      return;
    }
    const script = document.createElement("script");
    script.src = PLAID_SCRIPT_URL;
    script.onload = () => {
      if (window.Plaid !== undefined) {
        resolve(window.Plaid);
      } else {
        reject(new Error("The bank connection window could not be loaded."));
      }
    };
    script.onerror = () =>
      reject(new Error("The bank connection window could not be loaded. Are you online?"));
    document.head.append(script);
  });
}

/**
 * Open Plaid Link and wait for the user. Resolves with the result when they
 * connect a bank, or with null when they close the window without connecting.
 */
export async function openPlaidLink(linkToken: string): Promise<LinkResult | null> {
  const plaid = await loadPlaidScript();
  return new Promise((resolve, reject) => {
    plaid
      .create({
        token: linkToken,
        onSuccess: (publicToken, metadata) =>
          resolve({
            publicToken,
            institutionName: metadata.institution?.name ?? "Bank",
          }),
        onExit: (error) => {
          if (error === null) {
            resolve(null);
          } else {
            reject(new Error(error.display_message ?? error.error_message ?? "The bank connection failed."));
          }
        },
      })
      .open();
  });
}
