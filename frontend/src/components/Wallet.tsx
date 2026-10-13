"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  getWallet,
  listWalletTransactions,
  sendMoney,
  topUpWallet,
  type Wallet as WalletInfo,
  type WalletTransaction,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { newRequestId } from "@/lib/requestId";
import { toCents } from "@/lib/split";

type WalletData = { wallet: WalletInfo; transactions: WalletTransaction[] };

type Status =
  | { state: "loading" }
  | { state: "loaded"; data: WalletData }
  | { state: "error"; message: string };

/** A send the user has filled in and is asked to confirm. */
type PendingSend = {
  toEmail: string;
  amount: string;
  note: string | null;
  /** Made once, when the confirm step opens, and reused if Confirm is pressed twice. */
  requestId: string;
};

const QUICK_AMOUNTS = ["20", "50", "100"];

const inputClass =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm " +
  "focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500";
const labelClass = "block text-sm font-medium text-zinc-700";
const buttonClass =
  "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50";
const smallButtonClass =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50";
const cardClass = "rounded-lg border border-zinc-200 bg-white p-5";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

async function loadWalletData(): Promise<WalletData> {
  const [wallet, transactions] = await Promise.all([getWallet(), listWalletTransactions()]);
  return { wallet, transactions };
}

/** "Sent to alex@example.com", "Received from sam@example.com" or "Top-up". */
function describe(transaction: WalletTransaction): string {
  if (transaction.kind === "top_up") {
    return "Top-up";
  }
  const who = transaction.counterparty ?? "someone";
  return transaction.direction === "out" ? `Sent to ${who}` : `Received from ${who}`;
}

/** The Wallet page: the balance, topping up, sending money, and the history. */
export default function Wallet() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [topUpAmount, setTopUpAmount] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [note, setNote] = useState("");
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);

  useEffect(() => {
    let isCurrent = true;
    loadWalletData()
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

  /** Run a change, then load the balance and history again. Returns whether it worked. */
  async function run(action: () => Promise<string>): Promise<boolean> {
    setIsBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const message = await action();
      setStatus({ state: "loaded", data: await loadWalletData() });
      setNotice(message);
      return true;
    } catch (error) {
      setActionError(errorMessage(error));
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function handleTopUp(amount: string) {
    if (toCents(amount) === null || toCents(amount) === 0) {
      setActionError("Enter an amount to add, like 20 or 12.50.");
      return;
    }
    const requestId = newRequestId();
    const worked = await run(async () => {
      await topUpWallet(amount, requestId);
      return `${formatMoney(amount, "CAD")} was added to your wallet.`;
    });
    if (worked) {
      setTopUpAmount("");
    }
  }

  /** Step 1 of sending: check what was typed and show it back for confirmation. */
  function handleReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    if (toCents(sendAmount) === null || toCents(sendAmount) === 0) {
      setActionError("Enter an amount to send, like 20 or 12.50.");
      return;
    }
    setActionError(null);
    setPendingSend({
      toEmail: toEmail.trim(),
      amount: sendAmount.trim(),
      note: note.trim() === "" ? null : note.trim(),
      requestId: newRequestId(),
    });
  }

  /** Step 2: the user confirmed, so the money moves. */
  async function handleConfirm() {
    if (pendingSend === null) {
      return;
    }
    const send = pendingSend;
    const worked = await run(async () => {
      await sendMoney(send, send.requestId);
      return `${formatMoney(send.amount, "CAD")} was sent to ${send.toEmail}.`;
    });
    setPendingSend(null);
    if (worked) {
      setToEmail("");
      setSendAmount("");
      setNote("");
    }
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

  const { wallet, transactions } = status.data;

  return (
    <div className="space-y-6">
      <section className={cardClass} aria-labelledby="balance-heading">
        <h2 id="balance-heading" className="text-sm font-medium text-zinc-600">
          Balance
        </h2>
        <p className="mt-1 text-4xl font-semibold tracking-tight">
          {formatMoney(wallet.balance, wallet.currency)}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Pretend money, for demonstration. Nothing here is connected to a real bank.
        </p>
      </section>

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

      <div className="grid gap-6 md:grid-cols-2">
        <section className={cardClass} aria-labelledby="top-up-heading">
          <h2 id="top-up-heading" className="text-lg font-semibold">
            Add money
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                disabled={isBusy}
                onClick={() => handleTopUp(amount)}
                className={smallButtonClass}
              >
                + {formatMoney(amount, wallet.currency)}
              </button>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleTopUp(topUpAmount.trim());
            }}
            className="mt-4"
          >
            <label htmlFor="top-up-amount" className={labelClass}>
              Another amount
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="top-up-amount"
                type="text"
                inputMode="decimal"
                value={topUpAmount}
                onChange={(event) => setTopUpAmount(event.target.value)}
                className={`${inputClass} mt-0`}
              />
              <button type="submit" disabled={isBusy} className={buttonClass}>
                Add
              </button>
            </div>
          </form>
        </section>

        <section className={cardClass} aria-labelledby="send-heading">
          <h2 id="send-heading" className="text-lg font-semibold">
            Send money
          </h2>
          {pendingSend === null ? (
            <form onSubmit={handleReview} className="mt-3 space-y-3">
              <div>
                <label htmlFor="send-email" className={labelClass}>
                  To (their email)
                </label>
                <input
                  id="send-email"
                  type="email"
                  required
                  autoComplete="off"
                  value={toEmail}
                  onChange={(event) => setToEmail(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="send-amount" className={labelClass}>
                  Amount
                </label>
                <input
                  id="send-amount"
                  type="text"
                  inputMode="decimal"
                  required
                  value={sendAmount}
                  onChange={(event) => setSendAmount(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="send-note" className={labelClass}>
                  Note <span className="font-normal text-zinc-400">(optional)</span>
                </label>
                <input
                  id="send-note"
                  type="text"
                  maxLength={200}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className={inputClass}
                />
              </div>
              <button type="submit" disabled={isBusy} className={buttonClass}>
                Review
              </button>
            </form>
          ) : (
            // A confirm step, so money is never sent by one accidental tap.
            <div className="mt-3 space-y-3">
              <p className="text-sm">
                Send{" "}
                <strong>{formatMoney(pendingSend.amount, wallet.currency)}</strong> to{" "}
                <strong className="break-all">{pendingSend.toEmail}</strong>?
              </p>
              {pendingSend.note !== null && (
                <p className="text-sm text-zinc-600">Note: {pendingSend.note}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleConfirm}
                  className={buttonClass}
                >
                  {isBusy ? "Sending…" : "Confirm and send"}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setPendingSend(null)}
                  className={smallButtonClass}
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className={cardClass} aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        {transactions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nothing yet. Add some money to get started.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {transactions.map((transaction) => (
              <li key={transaction.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium">{describe(transaction)}</p>
                  <p className="text-xs text-zinc-500">
                    {transaction.created_at.slice(0, 10)}
                    {transaction.note !== null ? ` · ${transaction.note}` : ""}
                  </p>
                </div>
                <p
                  className={
                    "whitespace-nowrap text-sm font-semibold " +
                    (transaction.direction === "in" ? "text-green-700" : "text-zinc-900")
                  }
                >
                  {transaction.direction === "in" ? "+" : "−"}
                  {formatMoney(transaction.amount, wallet.currency)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
