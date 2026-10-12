"use client";

import { useEffect, useState } from "react";

import {
  addBankTransaction,
  CATEGORIES,
  connectBank,
  createBankLinkToken,
  getBankStatus,
  ignoreBankTransaction,
  listBankTransactions,
  removeBankConnection,
  syncBank,
  type BankStatus,
  type BankTransaction,
  type Category,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { openPlaidLink } from "@/lib/plaidLink";

type BankData = { status: BankStatus; transactions: BankTransaction[] };

type Status =
  | { state: "loading" }
  | { state: "loaded"; data: BankData }
  | { state: "error"; message: string };

const buttonClass =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50";
const smallButtonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50";
const cardClass = "rounded-lg border border-zinc-200 bg-white p-5";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

async function loadBankData(): Promise<BankData> {
  const [status, transactions] = await Promise.all([getBankStatus(), listBankTransactions()]);
  return { status, transactions };
}

/** The Bank page: connect a sandbox bank, import its transactions, and review them. */
export default function BankImport() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The category chosen for each transaction, when the user changed the suggestion.
  const [chosen, setChosen] = useState<Record<number, Category>>({});

  useEffect(() => {
    let isCurrent = true;
    loadBankData()
      .then((data) => {
        if (isCurrent) {
          setStatus({ state: "loaded", data });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setStatus({ state: "error", message: errorMessage(error) });
        }
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  /** Run a change, show what it says, then load the page's data again. */
  async function run(action: () => Promise<string | null>) {
    setIsBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const message = await action();
      setStatus({ state: "loaded", data: await loadBankData() });
      setNotice(message);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConnect(): Promise<string | null> {
    // 1. The backend asks Plaid for a token that opens its window.
    const { link_token } = await createBankLinkToken();
    // 2. The user picks a bank and signs in, inside Plaid's window.
    const result = await openPlaidLink(link_token);
    if (result === null) {
      return null;
    }
    // 3. The backend swaps the one-time token for the real one and keeps it.
    await connectBank(result.publicToken, result.institutionName);
    return `${result.institutionName} is connected. Import its transactions to review them.`;
  }

  async function handleSync(): Promise<string> {
    const summary = await syncBank();
    if (summary.imported === 0) {
      return "Nothing new to import. A bank you just connected can need a few seconds: try again.";
    }
    const count = summary.imported === 1 ? "1 transaction" : `${summary.imported} transactions`;
    return `${count} imported. Add the ones you want to your expenses.`;
  }

  if (status.state === "loading") {
    return <p className="text-zinc-500">Loading…</p>;
  }
  if (status.state === "error") {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {status.message}
      </p>
    );
  }

  const { status: bank, transactions } = status.data;

  if (!bank.configured) {
    return (
      <section className={cardClass}>
        <h2 className="text-lg font-semibold">The bank connection is not set up yet</h2>
        <p className="mt-2 text-sm text-zinc-600">
          This feature uses Plaid&apos;s sandbox: pretend banks with pretend transactions. To turn
          it on, add your free sandbox keys to the <code>.env</code> file as{" "}
          <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code>, then restart the app. The
          README has the steps.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Sandbox only. These are pretend banks and pretend transactions, never your real accounts.
        In Plaid&apos;s window, sign in with <code>user_good</code> and <code>pass_good</code>.
      </p>
      {notice !== null && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}
      {actionError !== null && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}

      <section className={cardClass} aria-labelledby="banks-heading">
        <h2 id="banks-heading" className="text-lg font-semibold">
          Connected banks
        </h2>
        {bank.connections.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No bank connected yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 text-sm">
            {bank.connections.map((connection) => (
              <li key={connection.id} className="flex items-center justify-between gap-3 py-2">
                <span>{connection.institution_name}</span>
                <button
                  type="button"
                  disabled={isBusy}
                  aria-label={`Remove ${connection.institution_name}`}
                  onClick={() =>
                    run(async () => {
                      await removeBankConnection(connection.id);
                      return `${connection.institution_name} was removed.`;
                    })
                  }
                  className={smallButtonClass}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={isBusy} onClick={() => run(handleConnect)} className={buttonClass}>
            Connect a sandbox bank
          </button>
          {bank.connections.length > 0 && (
            <button type="button" disabled={isBusy} onClick={() => run(handleSync)} className={smallButtonClass}>
              Import transactions
            </button>
          )}
        </div>
      </section>

      <section className={cardClass} aria-labelledby="review-heading">
        <h2 id="review-heading" className="text-lg font-semibold">
          To review ({transactions.length})
        </h2>
        {transactions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nothing waiting. Imported transactions appear here until you add or ignore them.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {transactions.map((transaction) => (
              <li key={transaction.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {transaction.name}{" "}
                    <span className="font-normal text-zinc-600">
                      {formatMoney(transaction.amount, transaction.currency)}
                    </span>
                  </p>
                  <p className="text-sm text-zinc-500">{transaction.date}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Category for ${transaction.name}`}
                    value={chosen[transaction.id] ?? transaction.category}
                    onChange={(event) =>
                      setChosen({ ...chosen, [transaction.id]: event.target.value as Category })
                    }
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={isBusy}
                    aria-label={`Add ${transaction.name} to expenses`}
                    onClick={() =>
                      run(async () => {
                        await addBankTransaction(
                          transaction.id,
                          chosen[transaction.id] ?? transaction.category,
                        );
                        return `${transaction.name} was added to your expenses.`;
                      })
                    }
                    className={smallButtonClass}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    aria-label={`Ignore ${transaction.name}`}
                    onClick={() =>
                      run(async () => {
                        await ignoreBankTransaction(transaction.id);
                        return null;
                      })
                    }
                    className={smallButtonClass}
                  >
                    Ignore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
