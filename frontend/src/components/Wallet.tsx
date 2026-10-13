"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import AmountPad from "@/components/AmountPad";
import { useAuth } from "@/components/AuthProvider";
import {
  getHousehold,
  getWallet,
  listWalletTransactions,
  sendMoney,
  topUpWallet,
  type Wallet as WalletInfo,
  type WalletTransaction,
} from "@/lib/api";
import { finishAmount, isPositiveAmount } from "@/lib/amountInput";
import { formatMoney } from "@/lib/format";
import { newRequestId } from "@/lib/requestId";

type WalletData = {
  wallet: WalletInfo;
  transactions: WalletTransaction[];
  /** Emails of the people in the user's household, without the user. */
  housemates: string[];
};

type Status =
  | { state: "loading" }
  | { state: "loaded"; data: WalletData }
  | { state: "error"; message: string };

/** Which screen of the page is showing. Sending goes through three steps. */
type View =
  | { name: "home" }
  | { name: "add" }
  | { name: "send-who" }
  | { name: "send-amount"; toEmail: string }
  // The request id is made when this step opens and reused if Confirm is tapped twice.
  | { name: "send-confirm"; toEmail: string; amount: string; note: string | null; requestId: string };

const TOP_UP_AMOUNTS = ["20", "50", "100", "200"];
const SEND_AMOUNTS = ["5", "10", "20", "50"];
const QUICK_NOTES = ["Rent", "Groceries", "Food", "Bills", "Thanks"];
const MAX_PEOPLE_SHOWN = 6;

const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";
const primaryButtonClass =
  "w-full rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white " +
  "hover:bg-indigo-500 disabled:bg-zinc-300";
const chipClass = "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

async function loadWalletData(myEmail: string): Promise<WalletData> {
  const [wallet, transactions, household] = await Promise.all([
    getWallet(),
    listWalletTransactions(),
    // The household only offers shortcuts. If it cannot be loaded, the wallet still works.
    getHousehold().catch(() => null),
  ]);
  const housemates = (household?.members ?? [])
    .map((member) => member.email)
    .filter((email) => email !== myEmail);
  return { wallet, transactions, housemates };
}

/** People to offer as one-tap choices: housemates first, then people from the history. */
function suggestPeople(data: WalletData): string[] {
  const fromHistory = data.transactions
    .map((transaction) => transaction.counterparty)
    .filter((email): email is string => email !== null);
  // A Set keeps the first time each email appears and drops repeats.
  return [...new Set([...data.housemates, ...fromHistory])].slice(0, MAX_PEOPLE_SHOWN);
}

/** "alex" from "alex@example.com", to keep the buttons short. */
function shortName(email: string): string {
  return email.split("@")[0];
}

/** "Sent to alex", "Received from sam" or "Added money". */
function describe(transaction: WalletTransaction): string {
  if (transaction.kind === "top_up") {
    return "Added money";
  }
  const who = transaction.counterparty === null ? "someone" : shortName(transaction.counterparty);
  return transaction.direction === "out" ? `Sent to ${who}` : `Received from ${who}`;
}

/** A coloured circle with the person's first letter. */
function Avatar({ email, size = "h-11 w-11 text-base" }: { email: string; size?: string }) {
  // The same email always gets the same colour.
  const colours = ["bg-indigo-100 text-indigo-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-700", "bg-rose-100 text-rose-700", "bg-sky-100 text-sky-700"];
  const index = [...email].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % colours.length;
  return (
    <span
      aria-hidden
      className={`flex ${size} shrink-0 items-center justify-center rounded-full font-semibold uppercase ${colours[index]}`}
    >
      {email[0]}
    </span>
  );
}

/** The heading of a step, with a Back button. */
function StepHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-lg hover:bg-zinc-200"
      >
        ←
      </button>
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}

/** A round button with a label under it, like the actions in a payment app. */
function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="group flex flex-col items-center gap-1.5">
      {/* aria-hidden: the symbol is decoration, so the button is read as its label only. */}
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-2xl text-white ring-1 ring-white/25 group-hover:bg-white/25"
      >
        {children}
      </span>
      <span className="text-sm font-medium text-white">{label}</span>
    </button>
  );
}

/** The Wallet page: the balance, adding money, sending money, and the history. */
export default function Wallet() {
  const { auth } = useAuth();
  const myEmail = auth.state === "signedIn" ? auth.user.email : "";

  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [view, setView] = useState<View>({ name: "home" });
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // What is being entered in the current step.
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [otherEmail, setOtherEmail] = useState("");
  const [isTypingEmail, setIsTypingEmail] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    loadWalletData(myEmail)
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
  }, [myEmail]);

  /** Open a screen with its inputs empty and old messages cleared. */
  function open(next: View) {
    setAmount("");
    setNote("");
    setOtherEmail("");
    setIsTypingEmail(false);
    setActionError(null);
    if (next.name !== "home") {
      setNotice(null);
    }
    setView(next);
  }

  /** Run a change, then load the balance and history again and go back to the start. */
  async function run(action: () => Promise<string>) {
    setIsBusy(true);
    setActionError(null);
    try {
      const message = await action();
      setStatus({ state: "loaded", data: await loadWalletData(myEmail) });
      open({ name: "home" });
      setNotice(message);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  function handleAdd() {
    const value = finishAmount(amount);
    const requestId = newRequestId();
    void run(async () => {
      await topUpWallet(value, requestId);
      return `${formatMoney(value, "CAD")} was added to your wallet.`;
    });
  }

  function handleOtherEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    open({ name: "send-amount", toEmail: otherEmail.trim().toLowerCase() });
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
  const people = suggestPeople(status.data);

  const alert = actionError !== null && (
    <p role="alert" className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
      {actionError}
    </p>
  );

  if (view.name === "add") {
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="Add money">
        <StepHeader title="Add money" onBack={() => open({ name: "home" })} />
        {alert}
        <AmountPad value={amount} onChange={setAmount} quickAmounts={TOP_UP_AMOUNTS} label="Amount to add" />
        <button
          type="button"
          disabled={isBusy || !isPositiveAmount(amount)}
          onClick={handleAdd}
          className={`${primaryButtonClass} mt-5`}
        >
          {isPositiveAmount(amount) ? `Add ${formatMoney(finishAmount(amount), wallet.currency)}` : "Add money"}
        </button>
      </section>
    );
  }

  if (view.name === "send-who") {
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="Send money">
        <StepHeader title="Who are you sending to?" onBack={() => open({ name: "home" })} />
        {people.length > 0 && (
          <ul className="grid grid-cols-3 gap-3">
            {people.map((email) => (
              <li key={email}>
                <button
                  type="button"
                  onClick={() => open({ name: "send-amount", toEmail: email })}
                  aria-label={`Send to ${email}`}
                  className="flex w-full flex-col items-center gap-1.5 rounded-xl p-2 hover:bg-zinc-100"
                >
                  <Avatar email={email} />
                  <span className="w-full truncate text-center text-sm">{shortName(email)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {people.length === 0 && (
          <p className="text-sm text-zinc-500">
            People you send to, and the people in your household, will appear here as buttons.
          </p>
        )}

        {isTypingEmail ? (
          <form onSubmit={handleOtherEmail} className="mt-4">
            <label htmlFor="other-email" className="block text-sm font-medium text-zinc-700">
              Their email
            </label>
            <input
              id="other-email"
              type="email"
              required
              autoFocus
              autoComplete="off"
              value={otherEmail}
              onChange={(event) => setOtherEmail(event.target.value)}
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button type="submit" className={`${primaryButtonClass} mt-3`}>
              Continue
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsTypingEmail(true)}
            className="mt-4 w-full rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 hover:border-indigo-400"
          >
            + Someone else
          </button>
        )}
      </section>
    );
  }

  if (view.name === "send-amount") {
    const { toEmail } = view;
    return (
      <section className={`${cardClass} mx-auto max-w-md`} aria-label="Send money">
        <StepHeader title="How much?" onBack={() => open({ name: "send-who" })} />
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-zinc-50 p-3">
          <Avatar email={toEmail} size="h-9 w-9 text-sm" />
          <p className="min-w-0 truncate text-sm">
            To <strong>{toEmail}</strong>
          </p>
        </div>
        <AmountPad value={amount} onChange={setAmount} quickAmounts={SEND_AMOUNTS} label="Amount to send" />

        <p className="mt-5 text-sm font-medium text-zinc-700">What is it for? (optional)</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {QUICK_NOTES.map((quickNote) => (
            <button
              key={quickNote}
              type="button"
              aria-pressed={note === quickNote}
              // Tapping the chosen one again clears it.
              onClick={() => setNote(note === quickNote ? "" : quickNote)}
              className={
                chipClass +
                (note === quickNote
                  ? " border-indigo-600 bg-indigo-600 text-white"
                  : " border-zinc-300 bg-white hover:border-indigo-400")
              }
            >
              {quickNote}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={!isPositiveAmount(amount)}
          onClick={() =>
            setView({
              name: "send-confirm",
              toEmail,
              amount: finishAmount(amount),
              note: note === "" ? null : note,
              requestId: newRequestId(),
            })
          }
          className={`${primaryButtonClass} mt-5`}
        >
          Review
        </button>
      </section>
    );
  }

  if (view.name === "send-confirm") {
    const send = view;
    return (
      <section className={`${cardClass} mx-auto max-w-md text-center`} aria-label="Confirm">
        <StepHeader title="Check and confirm" onBack={() => setView({ name: "send-amount", toEmail: send.toEmail })} />
        {alert}
        <div className="flex justify-center">
          <Avatar email={send.toEmail} size="h-16 w-16 text-2xl" />
        </div>
        <p className="mt-3 text-sm text-zinc-600">You are sending</p>
        <p className="text-4xl font-semibold tracking-tight">{formatMoney(send.amount, wallet.currency)}</p>
        <p className="mt-1 break-all text-sm">
          to <strong>{send.toEmail}</strong>
        </p>
        {send.note !== null && <p className="mt-1 text-sm text-zinc-600">For: {send.note}</p>}
        <button
          type="button"
          disabled={isBusy}
          onClick={() =>
            void run(async () => {
              await sendMoney(send, send.requestId);
              return `${formatMoney(send.amount, "CAD")} was sent to ${send.toEmail}.`;
            })
          }
          className={`${primaryButtonClass} mt-6`}
        >
          {isBusy ? "Sending…" : "Confirm and send"}
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="balance-heading"
        className="rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-700 p-6 text-white shadow-lg"
      >
        <h2 id="balance-heading" className="text-sm font-medium text-indigo-100">
          Balance
        </h2>
        <p className="mt-1 text-5xl font-semibold tracking-tight">
          {formatMoney(wallet.balance, wallet.currency)}
        </p>
        <p className="mt-2 text-xs text-indigo-100">
          Pretend money, for demonstration. Nothing here is connected to a real bank.
        </p>
        <div className="mt-6 flex gap-8">
          <ActionButton label="Add money" onClick={() => open({ name: "add" })}>
            +
          </ActionButton>
          <ActionButton label="Send" onClick={() => open({ name: "send-who" })}>
            ↗
          </ActionButton>
        </div>
      </section>

      {notice !== null && (
        <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          ✓ {notice}
        </p>
      )}

      {people.length > 0 && (
        <section className={cardClass} aria-labelledby="quick-heading">
          <h2 id="quick-heading" className="text-sm font-semibold text-zinc-700">
            Send again
          </h2>
          <ul className="mt-3 flex gap-2 overflow-x-auto">
            {people.map((email) => (
              <li key={email}>
                <button
                  type="button"
                  onClick={() => open({ name: "send-amount", toEmail: email })}
                  aria-label={`Send to ${email}`}
                  className="flex w-20 flex-col items-center gap-1.5 rounded-xl p-2 hover:bg-zinc-100"
                >
                  <Avatar email={email} />
                  <span className="w-full truncate text-center text-xs">{shortName(email)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={cardClass} aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-sm font-semibold text-zinc-700">
          History
        </h2>
        {transactions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Nothing yet. Add some money to get started.</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-100">
            {transactions.map((transaction) => (
              <li key={transaction.id} className="flex items-center gap-3 py-3">
                {transaction.counterparty === null ? (
                  <span
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xl text-zinc-600"
                  >
                    +
                  </span>
                ) : (
                  <Avatar email={transaction.counterparty} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={transaction.counterparty ?? undefined}>
                    {describe(transaction)}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
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
