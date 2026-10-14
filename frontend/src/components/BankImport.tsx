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
import Avatar from "@/components/Avatar";
import CategoryBadge from "@/components/CategoryBadge";
import { formatMoney } from "@/lib/format";
import { openPlaidLink } from "@/lib/plaidLink";

type BankData = { status: BankStatus; transactions: BankTransaction[] };

type Status =
  | { state: "loading" }
  | { state: "loaded"; data: BankData }
  | { state: "error"; message: string };

// The same look as the Wallet page: rounded cards, green main buttons.
const buttonClass =
  "rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 " +
  "disabled:bg-zinc-300";
const smallButtonClass =
  "rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 " +
  "disabled:opacity-50";
const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";
const headingClass = "text-sm font-semibold text-zinc-700";

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
        <h2 className={headingClass}>The bank connection is not set up yet</h2>
        <p className="mt-2 text-sm text-zinc-600">
          This feature uses Plaid&apos;s sandbox: pretend banks with pretend transactions. To turn
          it on, add your free sandbox keys to the <code>.env</code> file as{" "}
          <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code>, then restart the app. The
          README has the steps.
        </p>
      </section>
    );
  }

  const bankCount = bank.connections.length;

  return (
    <div className="space-y-6">
      {/* The same green card as the Wallet: what is waiting for a decision. */}
      <section
        aria-label="Waiting for review"
        className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white shadow-lg"
      >
        <p className="text-sm font-medium text-emerald-100">Waiting for review</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">{transactions.length}</p>
        <p className="mt-1 text-sm text-emerald-100">
          {transactions.length === 1 ? "transaction" : "transactions"} from {bankCount}{" "}
          connected {bankCount === 1 ? "bank" : "banks"}
        </p>
      </section>

      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Sandbox only. These are pretend banks and pretend transactions, never your real accounts.
        In Plaid&apos;s window, sign in with <code>user_good</code> and <code>pass_good</code>.
      </p>
      {notice !== null && (
        <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          ✓ {notice}
        </p>
      )}
      {actionError !== null && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      <section className={cardClass} aria-labelledby="banks-heading">
        <h2 id="banks-heading" className={headingClass}>
          Connected banks
        </h2>
        {bank.connections.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No bank connected yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 text-sm">
            {bank.connections.map((connection) => (
              <li key={connection.id} className="flex items-center gap-3 py-3">
                <Avatar email={connection.institution_name} size="h-9 w-9 text-sm" />
                <span className="min-w-0 flex-1 truncate font-medium">{connection.institution_name}</span>
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
          {/* The main action until a bank is connected; after that, importing is. */}
          <button
            type="button"
            disabled={isBusy}
            onClick={() => run(handleConnect)}
            className={bankCount === 0 ? buttonClass : smallButtonClass}
          >
            Connect a sandbox bank
          </button>
          {bank.connections.length > 0 && (
            <button type="button" disabled={isBusy} onClick={() => run(handleSync)} className={buttonClass}>
              Import transactions
            </button>
          )}
        </div>
      </section>

      <section className={cardClass} aria-labelledby="review-heading">
        <h2 id="review-heading" className={headingClass}>
          To review ({transactions.length})
        </h2>
        {transactions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nothing waiting. Imported transactions appear here until you add or ignore them.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {transactions.map((transaction) => (
              <li key={transaction.id} className="flex flex-wrap items-center gap-3 py-3">
                {/* The colour follows the category currently chosen. */}
                <CategoryBadge category={chosen[transaction.id] ?? transaction.category} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{transaction.name}</p>
                  <p className="text-xs text-zinc-500">{transaction.date}</p>
                </div>
                <p className="whitespace-nowrap text-sm font-semibold tabular-nums">
                  {formatMoney(transaction.amount, transaction.currency)}
                </p>
                {/* On a phone the choices get their own row under the transaction. */}
                <div className="flex w-full flex-wrap items-center gap-2 pl-[3.25rem]">
                  <select
                    aria-label={`Category for ${transaction.name}`}
                    value={chosen[transaction.id] ?? transaction.category}
                    onChange={(event) =>
                      setChosen({ ...chosen, [transaction.id]: event.target.value as Category })
                    }
                    className="rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                    className={buttonClass}
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
