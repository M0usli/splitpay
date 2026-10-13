"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import AmountPad from "@/components/AmountPad";
import { useAuth } from "@/components/AuthProvider";
import {
  cancelMoneyRequest,
  declineMoneyRequest,
  getBalance,
  getHousehold,
  getWallet,
  listMoneyRequests,
  listWalletTransactions,
  payFromWallet,
  payMoneyRequest,
  requestMoney,
  sendMoney,
  topUpWallet,
  type MoneyRequest,
  type Wallet as WalletInfo,
  type WalletTransaction,
} from "@/lib/api";
import { finishAmount, isPositiveAmount } from "@/lib/amountInput";
import { formatMoney } from "@/lib/format";
import { newRequestId, RequestIds } from "@/lib/requestId";

type WalletData = {
  wallet: WalletInfo;
  transactions: WalletTransaction[];
  /** Emails of the people in the user's household, without the user. */
  housemates: string[];
  /** What the user owes housemates from split bills, worked out by the backend. */
  debts: Debt[];
  /** Requests for money that are still waiting for an answer. */
  requests: MoneyRequest[];
};

type Debt = { toId: number; toEmail: string; amount: string };

type Status =
  | { state: "loading" }
  | { state: "loaded"; data: WalletData }
  | { state: "error"; message: string };

/** Sending and requesting share the "who" and "how much" steps. */
type Mode = "send" | "request";

/** Which screen of the page is showing. Sending goes through three steps, requesting through two. */
type View =
  | { name: "home" }
  | { name: "add" }
  | { name: "who"; mode: Mode }
  | { name: "amount"; mode: Mode; toEmail: string }
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
  const [wallet, transactions, allRequests, household] = await Promise.all([
    getWallet(),
    listWalletTransactions(),
    listMoneyRequests(),
    // The household only offers shortcuts. If it cannot be loaded, the wallet still works.
    getHousehold().catch(() => null),
  ]);
  const housemates = (household?.members ?? [])
    .map((member) => member.email)
    .filter((email) => email !== myEmail);
  // The split-bill balance says exactly who should pay whom.
  const balance = household === null ? null : await getBalance().catch(() => null);
  const debts = (balance?.payments ?? [])
    .filter((payment) => payment.owed_by.email === myEmail)
    .map((payment) => ({
      toId: payment.owed_to.id,
      toEmail: payment.owed_to.email,
      amount: payment.amount,
    }));
  // Paid ones are in the history; declined and cancelled ones are finished.
  const requests = allRequests.filter((request) => request.status === "pending");
  return { wallet, transactions, housemates, debts, requests };
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
  if (transaction.kind === "settlement") {
    return transaction.direction === "out" ? `Paid ${who} for split bill` : `${who} paid you for split bill`;
  }
  if (transaction.kind === "request") {
    return transaction.direction === "out" ? `Paid ${who}'s request` : `${who} paid your request`;
  }
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
  // Remembers the request id of each Pay button until its payment succeeds.
  const payIds = useRef(new RequestIds());

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

  /** One tap: pay a housemate exactly what the split bill says is owed. */
  function handlePayDebt(debt: Debt) {
    const action = `pay-${debt.toId}-${debt.amount}`;
    void run(async () => {
      await payFromWallet(debt.toId, debt.amount, payIds.current.idFor(action));
      payIds.current.forget(action);
      return `You paid ${debt.toEmail} ${formatMoney(debt.amount, "CAD")} for your split bill.`;
    });
  }

  /** Ask someone for money. Nothing moves, so there is no confirm step. */
  function handleRequest(toEmail: string) {
    const value = finishAmount(amount);
    const chosenNote = note === "" ? null : note;
    void run(async () => {
      await requestMoney({ toEmail, amount: value, note: chosenNote });
      return `You asked ${toEmail} for ${formatMoney(value, "CAD")}.`;
    });
  }

  /** One tap: pay a request someone sent. */
  function handlePayRequest(request: MoneyRequest) {
    const action = `request-${request.id}`;
    void run(async () => {
      await payMoneyRequest(request.id, payIds.current.idFor(action));
      payIds.current.forget(action);
      return `You paid ${request.counterparty} ${formatMoney(request.amount, "CAD")}.`;
    });
  }

  function handleDecline(request: MoneyRequest) {
    void run(async () => {
      await declineMoneyRequest(request.id);
      return `You declined the request from ${request.counterparty}.`;
    });
  }

  function handleCancel(request: MoneyRequest) {
    void run(async () => {
      await cancelMoneyRequest(request.id);
      return `Your request to ${request.counterparty} was cancelled.`;
    });
  }

  function handleOtherEmail(event: FormEvent<HTMLFormElement>, mode: Mode) {
    event.preventDefault();
    open({ name: "amount", mode, toEmail: otherEmail.trim().toLowerCase() });
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

  const { wallet, transactions, debts, requests } = status.data;
  const incoming = requests.filter((request) => request.direction === "incoming");
  const outgoing = requests.filter((request) => request.direction === "outgoing");
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

  if (view.name === "who") {
    const { mode } = view;
    return (
      <section
        className={`${cardClass} mx-auto max-w-md`}
        aria-label={mode === "send" ? "Send money" : "Request money"}
      >
        <StepHeader
          title={mode === "send" ? "Who are you sending to?" : "Who are you asking?"}
          onBack={() => open({ name: "home" })}
        />
        {people.length > 0 && (
          <ul className="grid grid-cols-3 gap-3">
            {people.map((email) => (
              <li key={email}>
                <button
                  type="button"
                  onClick={() => open({ name: "amount", mode, toEmail: email })}
                  aria-label={mode === "send" ? `Send to ${email}` : `Request from ${email}`}
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
            People you send money to, and the people in your household, will appear here as buttons.
          </p>
        )}

        {isTypingEmail ? (
          <form onSubmit={(event) => handleOtherEmail(event, mode)} className="mt-4">
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

  if (view.name === "amount") {
    const { toEmail, mode } = view;
    return (
      <section
        className={`${cardClass} mx-auto max-w-md`}
        aria-label={mode === "send" ? "Send money" : "Request money"}
      >
        <StepHeader title="How much?" onBack={() => open({ name: "who", mode })} />
        {alert}
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-zinc-50 p-3">
          <Avatar email={toEmail} size="h-9 w-9 text-sm" />
          <p className="min-w-0 truncate text-sm">
            {mode === "send" ? "To" : "From"} <strong>{toEmail}</strong>
          </p>
        </div>
        <AmountPad value={amount} onChange={setAmount} quickAmounts={SEND_AMOUNTS}
          label={mode === "send" ? "Amount to send" : "Amount to request"}
        />

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

        {mode === "send" ? (
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
        ) : (
          <button
            type="button"
            disabled={isBusy || !isPositiveAmount(amount)}
            onClick={() => handleRequest(toEmail)}
            className={`${primaryButtonClass} mt-5`}
          >
            {isPositiveAmount(amount)
              ? `Request ${formatMoney(finishAmount(amount), wallet.currency)}`
              : "Request"}
          </button>
        )}
      </section>
    );
  }

  if (view.name === "send-confirm") {
    const send = view;
    return (
      <section className={`${cardClass} mx-auto max-w-md text-center`} aria-label="Confirm">
        <StepHeader title="Check and confirm" onBack={() => setView({ name: "amount", mode: "send", toEmail: send.toEmail })} />
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
          <ActionButton label="Send" onClick={() => open({ name: "who", mode: "send" })}>
            ↗
          </ActionButton>
          <ActionButton label="Request" onClick={() => open({ name: "who", mode: "request" })}>
            ↙
          </ActionButton>
        </div>
      </section>

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

      {debts.length > 0 && (
        <section className={cardClass} aria-labelledby="owe-heading">
          <h2 id="owe-heading" className="text-sm font-semibold text-zinc-700">
            You owe, from split bills
          </h2>
          <ul className="mt-2 divide-y divide-zinc-100">
            {debts.map((debt) => (
              <li key={debt.toId} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar email={debt.toEmail} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{shortName(debt.toEmail)}</p>
                  <p className="truncate text-xs text-zinc-500">{debt.toEmail}</p>
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handlePayDebt(debt)}
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:bg-zinc-300"
                >
                  Pay {formatMoney(debt.amount, wallet.currency)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {incoming.length > 0 && (
        <section className={cardClass} aria-labelledby="incoming-heading">
          <h2 id="incoming-heading" className="text-sm font-semibold text-zinc-700">
            Requests for you
          </h2>
          <ul className="mt-2 divide-y divide-zinc-100">
            {incoming.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar email={request.counterparty} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={request.counterparty}>
                    {shortName(request.counterparty)} asks for{" "}
                    {formatMoney(request.amount, wallet.currency)}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {request.created_at.slice(0, 10)}
                    {request.note !== null ? ` · ${request.note}` : ""}
                  </p>
                </div>
                {/* Two buttons do not fit beside the name on a phone, so they get their own row. */}
                <span className="flex w-full gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handlePayRequest(request)}
                    className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:bg-zinc-300"
                  >
                    Pay {formatMoney(request.amount, wallet.currency)}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleDecline(request)}
                    aria-label={`Decline the request from ${request.counterparty}`}
                    className="flex-1 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className={cardClass} aria-labelledby="outgoing-heading">
          <h2 id="outgoing-heading" className="text-sm font-semibold text-zinc-700">
            You asked for
          </h2>
          <ul className="mt-2 divide-y divide-zinc-100">
            {outgoing.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar email={request.counterparty} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={request.counterparty}>
                    {formatMoney(request.amount, wallet.currency)} from {shortName(request.counterparty)}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    Waiting · {request.created_at.slice(0, 10)}
                    {request.note !== null ? ` · ${request.note}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleCancel(request)}
                  aria-label={`Cancel the request to ${request.counterparty}`}
                  className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
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
                  onClick={() => open({ name: "amount", mode: "send", toEmail: email })}
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
